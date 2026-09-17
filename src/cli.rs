use std::env;
use std::ffi::OsStr;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use std::time::Instant as StdInstant;

use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::process::{Child, Command as TokioCommand};
use tokio::signal;
use tokio::time::{Instant, sleep};

use crate::NcxResult;
use crate::dataset::Dataset;
use crate::hub::{self, HubConfig, MAX_HUB_SESSIONS};
use crate::policy::HubPolicy;
use crate::server::{self, Limits};

const USAGE: &str = "\
ncx — a thin, remote-first NetCDF viewer

Usage:
  ncx open [OPTIONS] FILE_OR_DIRECTORY
  ncx open [OPTIONS] SSH_DESTINATION:/absolute/path
  ncx serve [OPTIONS] FILE_OR_DIRECTORY
  ncx serve [OPTIONS] --dataset ID=FILE [--dataset ID=FILE ...]
  ncx hub [OPTIONS] --local-root DIRECTORY [--local-root DIRECTORY ...]

Options:
  --port PORT                       Loopback port for `serve` (default: 0)
  --listen ADDRESS                  IPv4 hub listener (default: 127.0.0.1:8765)
  --mode local|HTTP|HTTPS            Hub deployment mode (default: local)
  --ssh-auth key|password            Hub SSH authentication (default: key)
  --host-key-policy POLICY           strict, accept-new, or insecure
  --known-hosts FILE                SSH known-hosts file
  --trusted-proxy IPv4              HTTPS reverse-proxy peer
  --public-origin HTTPS_ORIGIN      HTTPS external origin
  --base-path PATH                  Hub URL path (default: /ncx)
  --local-root DIRECTORY            Allow hub files below this directory
  --remote-ncx FILE                 Standalone ncx binary for SSH sessions
  --session-limit COUNT             Hub sessions, including starts (1-10; default: 10)
  --startup-timeout-seconds SECONDS Child startup timeout (default: 30)
  --session-ttl-seconds SECONDS     Hub idle timeout (default: 90)
  --max-response-bytes BYTES        Maximum binary response (default: 67108864)
  --ugrid-warn-faces FACES          UGRID confirmation threshold (default: 2000000)
  --dataset ID=FILE                 Add one named read-only dataset to `serve`
  --exit-on-stdin-eof               Stop `serve` when its owner pipe closes
  -h, --help                        Show this help
";

enum ParsedCommand {
    Help,
    Open {
        target: String,
        limits: Limits,
    },
    Serve {
        sources: Vec<ServeSource>,
        port: u16,
        limits: Limits,
        exit_on_stdin_eof: bool,
    },
    Hub {
        listen: SocketAddrV4,
        config: HubConfig,
    },
}

struct ServeSource {
    id: String,
    label: String,
    path: PathBuf,
    expand_directory: bool,
}

enum OpenTarget {
    Local(PathBuf),
    Remote { destination: String, path: String },
}

pub async fn run() -> NcxResult<()> {
    if let Ok(path) = env::var("NCX_ASKPASS_PIPE") {
        use std::io::{Read, Write};

        let input = std::fs::File::open(path)
            .map_err(|error| format!("cannot open the SSH password pipe: {error}"))?;
        let mut password = Vec::new();
        input
            .take(1025)
            .read_to_end(&mut password)
            .map_err(|error| format!("cannot read the SSH password: {error}"))?;
        if password.len() > 1024 || password.contains(&b'\n') || password.contains(&b'\r') {
            password.fill(0);
            return Err("the SSH password is invalid".to_owned());
        }
        std::io::stdout()
            .write_all(&password)
            .and_then(|_| std::io::stdout().write_all(b"\n"))
            .map_err(|error| format!("cannot answer the SSH password prompt: {error}"))?;
        password.fill(0);
        return Ok(());
    }
    let arguments = env::args_os()
        .skip(1)
        .map(|argument| {
            argument
                .into_string()
                .map_err(|_| "command-line arguments must be valid UTF-8".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;

    match parse_arguments(arguments)? {
        ParsedCommand::Help => {
            print!("{USAGE}");
            Ok(())
        }
        ParsedCommand::Serve {
            sources,
            port,
            limits,
            exit_on_stdin_eof,
        } => serve_local(sources, port, limits, false, exit_on_stdin_eof).await,
        ParsedCommand::Hub { listen, config } => serve_hub(listen, config.validate()?).await,
        ParsedCommand::Open { target, limits } => match classify_target(&target)? {
            OpenTarget::Local(path) => {
                serve_local(single_source(path), 0, limits, true, false).await
            }
            OpenTarget::Remote { destination, path } => {
                open_remote(&destination, &path, limits).await
            }
        },
    }
}

fn parse_arguments(arguments: Vec<String>) -> NcxResult<ParsedCommand> {
    let Some(command) = arguments.first().map(String::as_str) else {
        return Ok(ParsedCommand::Help);
    };
    if matches!(command, "-h" | "--help") {
        return Ok(ParsedCommand::Help);
    }
    if !matches!(command, "open" | "serve" | "hub") {
        return Err(format!("unknown command {command:?}\n\n{USAGE}"));
    }

    let mut limits = Limits::default();
    let mut port = 0;
    let mut listen = SocketAddrV4::new(Ipv4Addr::LOCALHOST, 8765);
    let mut policy = HubPolicy::default();
    let mut base_path = "/ncx".to_owned();
    let mut local_roots = Vec::new();
    let mut remote_ncx = None;
    let mut session_limit = 10_usize;
    let mut startup_timeout = Duration::from_secs(30);
    let mut idle_ttl = Duration::from_secs(90);
    let mut exit_on_stdin_eof = false;
    let mut sources = Vec::new();
    let mut target = None;
    let mut index = 1;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "-h" | "--help" => return Ok(ParsedCommand::Help),
            "--port" => {
                if command != "serve" {
                    return Err("--port is only valid with `ncx serve`".to_owned());
                }
                port = parse_value(&arguments, &mut index, "--port")?;
            }
            "--listen" => {
                if command != "hub" {
                    return Err("--listen is only valid with `ncx hub`".to_owned());
                }
                listen = parse_value(&arguments, &mut index, "--listen")?;
            }
            "--mode" | "--ssh-auth" | "--host-key-policy" | "--known-hosts" | "--trusted-proxy"
            | "--public-origin" => {
                if command != "hub" {
                    return Err("hub policy options require `ncx hub`".to_owned());
                }
                let option = arguments[index].clone();
                let value: String = parse_value(&arguments, &mut index, &option)?;
                match option.as_str() {
                    "--mode" => policy.mode = value.parse()?,
                    "--ssh-auth" => policy.auth = value.parse()?,
                    "--host-key-policy" => policy.host_keys = value.parse()?,
                    "--known-hosts" => policy.known_hosts = Some(value.into()),
                    "--trusted-proxy" => {
                        policy.trusted_proxy =
                            Some(value.parse().map_err(|_| "trusted-proxy must be IPv4")?)
                    }
                    "--public-origin" => policy.public_origin = Some(value),
                    _ => unreachable!(),
                }
            }
            "--base-path" => {
                if command != "hub" {
                    return Err("--base-path is only valid with `ncx hub`".to_owned());
                }
                base_path = parse_value(&arguments, &mut index, "--base-path")?;
            }
            "--local-root" => {
                if command != "hub" {
                    return Err("--local-root is only valid with `ncx hub`".to_owned());
                }
                local_roots.push(PathBuf::from(parse_value::<String>(
                    &arguments,
                    &mut index,
                    "--local-root",
                )?));
            }
            "--remote-ncx" => {
                if command != "hub" {
                    return Err("--remote-ncx is only valid with `ncx hub`".to_owned());
                }
                remote_ncx = Some(PathBuf::from(parse_value::<String>(
                    &arguments,
                    &mut index,
                    "--remote-ncx",
                )?));
            }
            "--session-limit" => {
                if command != "hub" {
                    return Err("--session-limit is only valid with `ncx hub`".to_owned());
                }
                session_limit = parse_value(&arguments, &mut index, "--session-limit")?;
                if !(1..=MAX_HUB_SESSIONS).contains(&session_limit) {
                    return Err(format!(
                        "--session-limit must be between 1 and {MAX_HUB_SESSIONS}"
                    ));
                }
            }
            "--startup-timeout-seconds" => {
                if command != "hub" {
                    return Err("--startup-timeout-seconds is only valid with `ncx hub`".to_owned());
                }
                startup_timeout = Duration::from_secs(parse_positive(
                    &arguments,
                    &mut index,
                    "--startup-timeout-seconds",
                )?);
            }
            "--session-ttl-seconds" => {
                if command != "hub" {
                    return Err("--session-ttl-seconds is only valid with `ncx hub`".to_owned());
                }
                idle_ttl = Duration::from_secs(parse_positive(
                    &arguments,
                    &mut index,
                    "--session-ttl-seconds",
                )?);
            }
            "--max-response-bytes" => {
                limits.max_response_bytes =
                    parse_positive(&arguments, &mut index, "--max-response-bytes")?;
            }
            "--ugrid-warn-faces" => {
                limits.ugrid_warn_faces =
                    parse_positive(&arguments, &mut index, "--ugrid-warn-faces")?;
            }
            "--exit-on-stdin-eof" => {
                if command != "serve" {
                    return Err("--exit-on-stdin-eof is only valid with `ncx serve`".to_owned());
                }
                exit_on_stdin_eof = true;
            }
            "--dataset" => {
                if command != "serve" {
                    return Err("--dataset is only valid with `ncx serve`".to_owned());
                }
                let value = parse_value(&arguments, &mut index, "--dataset")?;
                let source = parse_dataset(value)?;
                if sources
                    .iter()
                    .any(|current: &ServeSource| current.id == source.id)
                {
                    return Err(format!("duplicate dataset ID {:?}", source.id));
                }
                sources.push(source);
            }
            "--" => {
                index += 1;
                if index >= arguments.len() || target.is_some() || index + 1 != arguments.len() {
                    return Err("expected exactly one NetCDF file after `--`".to_owned());
                }
                target = Some(arguments[index].clone());
            }
            option if option.starts_with('-') => {
                return Err(format!("unknown option {option:?}"));
            }
            value => {
                if command == "hub" {
                    return Err(format!("unexpected hub argument {value:?}"));
                }
                if target.replace(value.to_owned()).is_some() {
                    return Err("expected exactly one NetCDF file".to_owned());
                }
            }
        }
        index += 1;
    }

    if command == "open" {
        if !sources.is_empty() {
            return Err("--dataset is only valid with `ncx serve`".to_owned());
        }
        let target = target.ok_or_else(|| "missing NetCDF file".to_owned())?;
        Ok(ParsedCommand::Open { target, limits })
    } else if command == "hub" {
        Ok(ParsedCommand::Hub {
            listen,
            config: HubConfig {
                policy,
                base_path,
                local_roots,
                session_limit,
                startup_timeout,
                idle_ttl,
                limits,
                remote_ncx,
            },
        })
    } else {
        if !sources.is_empty() && target.is_some() {
            return Err("use either FILE or --dataset, not both".to_owned());
        }
        if sources.is_empty() {
            sources = single_source(PathBuf::from(
                target.ok_or_else(|| "missing NetCDF file or --dataset".to_owned())?,
            ));
        }
        Ok(ParsedCommand::Serve {
            sources,
            port,
            limits,
            exit_on_stdin_eof,
        })
    }
}

fn single_source(path: PathBuf) -> Vec<ServeSource> {
    vec![ServeSource {
        id: "dataset".to_owned(),
        label: "dataset".to_owned(),
        path,
        expand_directory: true,
    }]
}

fn parse_dataset(value: String) -> NcxResult<ServeSource> {
    let (id, path) = value
        .split_once('=')
        .ok_or_else(|| "--dataset must be ID=FILE".to_owned())?;
    let valid_id = (1..=64).contains(&id.len())
        && id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        });
    if !valid_id {
        return Err(format!("invalid dataset ID {id:?}"));
    }
    if path.is_empty() {
        return Err("dataset file path is empty".to_owned());
    }
    Ok(ServeSource {
        id: id.to_owned(),
        label: id.to_owned(),
        path: PathBuf::from(path),
        expand_directory: false,
    })
}

fn expand_sources(mut sources: Vec<ServeSource>) -> NcxResult<(Vec<ServeSource>, bool)> {
    if sources.len() != 1 || !sources[0].expand_directory || !sources[0].path.is_dir() {
        return Ok((sources, false));
    }

    let directory = sources.pop().unwrap().path;
    let mut paths = Vec::new();
    for entry in std::fs::read_dir(&directory)
        .map_err(|error| format!("cannot read {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| {
            format!(
                "cannot inspect an entry in {}: {error}",
                directory.display()
            )
        })?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("cannot inspect {}: {error}", entry.path().display()))?;
        let path = entry.path();
        if file_type.is_file() && path.extension() == Some(OsStr::new("nc")) {
            paths.push(path);
        }
    }
    paths.sort_by(|first, second| first.file_name().cmp(&second.file_name()));
    if paths.is_empty() {
        return Err(format!(
            "{} contains no direct regular .nc files",
            directory.display()
        ));
    }

    let sources = paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| ServeSource {
            id: format!("file-{:04}", index + 1),
            label: path
                .file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
                .into_owned(),
            path,
            expand_directory: false,
        })
        .collect();
    Ok((sources, true))
}

fn parse_value<T>(arguments: &[String], index: &mut usize, option: &str) -> NcxResult<T>
where
    T: std::str::FromStr,
{
    *index += 1;
    let value = arguments
        .get(*index)
        .ok_or_else(|| format!("{option} requires a value"))?;
    value
        .parse()
        .map_err(|_| format!("invalid value {value:?} for {option}"))
}

fn parse_positive(arguments: &[String], index: &mut usize, option: &str) -> NcxResult<u64> {
    let value = parse_value(arguments, index, option)?;
    if value == 0 {
        return Err(format!("{option} must be greater than zero"));
    }
    Ok(value)
}

fn classify_target(target: &str) -> NcxResult<OpenTarget> {
    if Path::new(target).exists() {
        return Ok(OpenTarget::Local(PathBuf::from(target)));
    }
    if let Some(separator) = target.rfind(":/") {
        let destination = &target[..separator];
        let path = &target[separator + 1..];
        if destination.is_empty() {
            return Err("the SSH destination before `:/` is empty".to_owned());
        }
        return Ok(OpenTarget::Remote {
            destination: destination.to_owned(),
            path: path.to_owned(),
        });
    }
    if let Some(separator) = target.find(':')
        && !target[..separator].contains('/')
    {
        return Err("remote NetCDF paths must be absolute: use host:/path/file.nc".to_owned());
    }
    Ok(OpenTarget::Local(PathBuf::from(target)))
}

async fn serve_local(
    sources: Vec<ServeSource>,
    port: u16,
    limits: Limits,
    launch: bool,
    exit_on_stdin_eof: bool,
) -> NcxResult<()> {
    let started = StdInstant::now();
    let (sources, collection) = expand_sources(sources)?;
    let mut datasets = Vec::with_capacity(sources.len());
    let mut variable_count = 0;
    for source in sources {
        if collection {
            datasets.push(server::ServedDataset::lazy(
                source.id,
                source.label,
                source.path,
            ));
        } else {
            let dataset = Dataset::open(&source.path)?;
            variable_count += dataset.metadata().variables.len();
            datasets.push(server::ServedDataset::eager(
                source.id,
                source.label,
                dataset,
            ));
        }
    }
    if collection {
        eprintln!(
            "ncx: listed {} dataset(s) in {} ms; datasets open when selected",
            datasets.len(),
            started.elapsed().as_millis()
        );
    } else {
        eprintln!(
            "ncx: opened {} dataset(s), {} variables in {} ms",
            datasets.len(),
            variable_count,
            started.elapsed().as_millis()
        );
    }
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|error| format!("cannot bind 127.0.0.1:{port}: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("cannot inspect the loopback listener: {error}"))?;
    let url = format!("http://127.0.0.1:{}/", address.port());

    println!("NCX_READY=127.0.0.1:{}", address.port());
    if !exit_on_stdin_eof {
        println!("{url}");
    }
    if launch && !launch_browser(&url) {
        eprintln!("ncx: could not open a browser; open {url} manually");
    }

    server::serve(
        listener,
        datasets,
        limits,
        collection,
        shutdown(exit_on_stdin_eof),
    )
    .await
}

async fn serve_hub(listen: SocketAddrV4, config: HubConfig) -> NcxResult<()> {
    config.policy.validate(listen)?;
    let listener = TcpListener::bind(listen)
        .await
        .map_err(|error| format!("cannot bind {listen}: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("cannot inspect the hub listener: {error}"))?;
    println!("NCX_READY={}{}/", address, config.base_path);
    println!("http://{}{}/", address, config.base_path);
    hub::serve(listener, config, shutdown(false)).await
}

async fn shutdown(exit_on_stdin_eof: bool) {
    if !exit_on_stdin_eof {
        termination_signal().await;
        return;
    }
    let mut input = tokio::io::stdin();
    let mut byte = [0_u8; 1];
    tokio::select! {
        _ = termination_signal() => {}
        _ = async {
            loop {
                match input.read(&mut byte).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        } => {}
    }
}

async fn termination_signal() {
    #[cfg(unix)]
    {
        let mut terminate = signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("SIGTERM is available on Unix");
        tokio::select! {
            _ = signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = signal::ctrl_c().await;
    }
}

async fn open_remote(destination: &str, path: &str, limits: Limits) -> NcxResult<()> {
    let mut last_error = String::new();
    for attempt in 1..=3 {
        let port = unused_loopback_port()?;
        let remote_command = remote_serve_command(path, port, limits);
        let forward = format!("127.0.0.1:{port}:127.0.0.1:{port}");
        let mut child = TokioCommand::new("ssh")
            .arg("-o")
            .arg("ExitOnForwardFailure=yes")
            .arg("-L")
            .arg(forward)
            .arg(destination)
            .arg(remote_command)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("cannot start ssh: {error}"))?;

        match wait_until_ready(&mut child, port).await {
            Ok(()) => {
                let url = format!("http://127.0.0.1:{port}/");
                if !launch_browser(&url) {
                    eprintln!("ncx: could not open a browser; open {url} manually");
                }
                return own_ssh_session(child).await;
            }
            Err(error) => {
                last_error = error;
                stop_child(&mut child).await;
                if attempt < 3 {
                    eprintln!("ncx: remote startup failed; retrying with another port");
                }
            }
        }
    }
    Err(format!("remote ncx did not become ready: {last_error}"))
}

fn unused_loopback_port() -> NcxResult<u16> {
    let listener = StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("cannot choose a loopback port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("cannot inspect a candidate loopback port: {error}"))
}

fn remote_serve_command(path: &str, port: u16, limits: Limits) -> String {
    [
        "ncx".to_owned(),
        "serve".to_owned(),
        "--port".to_owned(),
        port.to_string(),
        "--max-response-bytes".to_owned(),
        limits.max_response_bytes.to_string(),
        "--ugrid-warn-faces".to_owned(),
        limits.ugrid_warn_faces.to_string(),
        "--".to_owned(),
        path.to_owned(),
    ]
    .iter()
    .map(|part| shell_quote(part))
    .collect::<Vec<_>>()
    .join(" ")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn wait_until_ready(child: &mut Child, port: u16) -> NcxResult<()> {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("cannot inspect ssh: {error}"))?
        {
            return Err(format!("ssh exited before ncx was ready ({status})"));
        }
        if server::viewer_is_ready(port).await {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("timed out after 30 seconds".to_owned());
        }
        sleep(Duration::from_millis(100)).await;
    }
}

async fn own_ssh_session(mut child: Child) -> NcxResult<()> {
    tokio::select! {
        signal = signal::ctrl_c() => {
            signal.map_err(|error| format!("cannot listen for Ctrl-C: {error}"))?;
            stop_child(&mut child).await;
            Ok(())
        }
        status = child.wait() => {
            let status = status.map_err(|error| format!("cannot wait for ssh: {error}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("ssh session ended with {status}"))
            }
        }
    }
}

async fn stop_child(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

fn launch_browser(url: &str) -> bool {
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", ""]);
        command
    };

    command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn directory_source_is_flat_sorted_and_excludes_symlinks() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("ncx-collection-{unique}"));
        std::fs::create_dir_all(directory.join("nested")).unwrap();
        std::fs::write(directory.join("b.nc"), []).unwrap();
        std::fs::write(directory.join("a.nc"), []).unwrap();
        std::fs::write(directory.join("notes.txt"), []).unwrap();
        std::fs::write(directory.join("nested/hidden.nc"), []).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(directory.join("a.nc"), directory.join("linked.nc")).unwrap();

        let (sources, collection) = expand_sources(single_source(directory.clone())).unwrap();

        assert!(collection);
        assert_eq!(
            sources
                .iter()
                .map(|source| source
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned())
                .collect::<Vec<_>>(),
            ["a.nc", "b.nc"],
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn parses_remote_targets_and_quotes_paths_as_data() {
        let OpenTarget::Remote { destination, path } =
            classify_target("cluster:/data/a file's.nc").unwrap()
        else {
            panic!("expected a remote target");
        };

        assert_eq!(destination, "cluster");
        assert_eq!(path, "/data/a file's.nc");
        assert_eq!(shell_quote(&path), "'/data/a file'\"'\"'s.nc'");
    }

    #[test]
    fn parses_hub_listener_roots_and_lifecycle_limits() {
        let command = parse_arguments(vec![
            "hub".into(),
            "--listen".into(),
            "0.0.0.0:8765".into(),
            "--base-path".into(),
            "/ncx".into(),
            "--local-root".into(),
            "/data".into(),
            "--remote-ncx".into(),
            "/opt/ncx-static".into(),
            "--session-limit".into(),
            "10".into(),
            "--startup-timeout-seconds".into(),
            "5".into(),
            "--session-ttl-seconds".into(),
            "90".into(),
        ])
        .unwrap();

        let ParsedCommand::Hub { listen, config } = command else {
            panic!("expected hub");
        };
        assert_eq!(listen, "0.0.0.0:8765".parse().unwrap());
        assert_eq!(config.base_path, "/ncx");
        assert_eq!(config.local_roots, [PathBuf::from("/data")]);
        assert_eq!(config.remote_ncx, Some(PathBuf::from("/opt/ncx-static")));
        assert_eq!(config.session_limit, 10);
        assert_eq!(config.startup_timeout, Duration::from_secs(5));
        assert_eq!(config.idle_ttl, Duration::from_secs(90));
    }

    #[test]
    fn rejects_hub_session_limits_above_ten() {
        let error = parse_arguments(vec![
            "hub".into(),
            "--local-root".into(),
            "/data".into(),
            "--session-limit".into(),
            "11".into(),
        ])
        .err()
        .unwrap();

        assert_eq!(error, "--session-limit must be between 1 and 10");
    }

    #[test]
    fn help_reports_the_default_response_limit() {
        assert!(USAGE.contains("default: 67108864"));
    }

    #[test]
    fn parses_serve_limits_without_a_cli_dependency() {
        let command = parse_arguments(vec![
            "serve".into(),
            "--port".into(),
            "8765".into(),
            "--max-response-bytes".into(),
            "4096".into(),
            "--exit-on-stdin-eof".into(),
            "fixture.nc".into(),
        ])
        .unwrap();

        let ParsedCommand::Serve {
            port,
            limits,
            sources,
            exit_on_stdin_eof,
        } = command
        else {
            panic!("expected serve");
        };
        assert_eq!(port, 8765);
        assert_eq!(limits.max_response_bytes, 4096);
        assert_eq!(sources[0].id, "dataset");
        assert_eq!(sources[0].path, PathBuf::from("fixture.nc"));
        assert!(exit_on_stdin_eof);
    }

    #[test]
    fn parses_repeated_named_datasets_without_a_cli_dependency() {
        let command = parse_arguments(vec![
            "serve".into(),
            "--dataset".into(),
            "case-a=/data/a.nc".into(),
            "--dataset".into(),
            "case-b=/data/b.nc".into(),
        ])
        .unwrap();

        let ParsedCommand::Serve { sources, .. } = command else {
            panic!("expected serve");
        };
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].id, "case-a");
        assert_eq!(sources[1].path, PathBuf::from("/data/b.nc"));
    }
}
