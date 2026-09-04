use std::collections::HashMap;
use std::fs::File;
use std::future::Future;
use std::net::SocketAddrV4;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{CONNECTION, HOST};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use hyper::client::conn::http1;
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{Instant, sleep, sleep_until, timeout, timeout_at};

use crate::NcxResult;
use crate::dataset::Dataset;
use crate::server::{self, Limits};

pub(crate) const MAX_HUB_SESSIONS: usize = 10;

#[derive(Debug)]
struct HubError {
    status: u16,
    code: &'static str,
    message: String,
}

impl IntoResponse for HubError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        (
            status,
            Json(HubErrorBody {
                error: HubErrorDetail {
                    code: self.code,
                    message: self.message,
                },
            }),
        )
            .into_response()
    }
}

#[derive(Serialize)]
struct HubErrorBody {
    error: HubErrorDetail,
}

#[derive(Serialize)]
struct HubErrorDetail {
    code: &'static str,
    message: String,
}

#[derive(Debug)]
enum Target {
    Local(LocalTarget),
    Remote(RemoteTarget),
}

#[derive(Debug)]
struct LocalTarget {
    file: File,
}

#[derive(Debug, PartialEq, Eq)]
struct RemoteTarget {
    destination: String,
    path: String,
}

fn resolve_target(address: &str, roots: &[PathBuf]) -> Result<Target, HubError> {
    if let Some(separator) = address.rfind(":/") {
        let destination = &address[..separator];
        let path = &address[separator + 1..];
        let valid_destination = (1..=255).contains(&destination.len())
            && !destination.starts_with('-')
            && destination.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'@' | b'.' | b'_' | b'-')
            });
        if !valid_destination || !path.starts_with('/') || path.chars().any(char::is_control) {
            return Err(HubError {
                status: 400,
                code: "invalid_remote_target",
                message: "remote targets must use safe-destination:/absolute/path".to_owned(),
            });
        }
        return Ok(Target::Remote(RemoteTarget {
            destination: destination.to_owned(),
            path: path.to_owned(),
        }));
    }
    let path = Path::new(address);
    if !path.is_absolute() {
        return Err(HubError {
            status: 400,
            code: "local_path_not_absolute",
            message: "local hub paths must be absolute".to_owned(),
        });
    }
    resolve_local_target(path, roots).map(Target::Local)
}

#[cfg(target_os = "linux")]
fn resolve_local_target(path: &Path, roots: &[PathBuf]) -> Result<LocalTarget, HubError> {
    use std::os::unix::fs::FileExt;

    let file = File::open(path).map_err(|error| HubError {
        status: 404,
        code: "target_not_found",
        message: format!("cannot open {}: {error}", path.display()),
    })?;
    if !file.metadata().is_ok_and(|metadata| metadata.is_file()) {
        return Err(HubError {
            status: 422,
            code: "target_not_file",
            message: "the target must be a regular file".to_owned(),
        });
    }
    let capability = PathBuf::from(format!("/proc/self/fd/{}", file.as_raw_fd()));
    let opened_path = capability.canonicalize().map_err(|error| HubError {
        status: 422,
        code: "target_unreadable",
        message: format!("cannot inspect the opened target: {error}"),
    })?;
    let allowed = roots.iter().any(|root| {
        root.canonicalize()
            .is_ok_and(|canonical_root| opened_path.starts_with(canonical_root))
    });
    if !allowed {
        return Err(HubError {
            status: 403,
            code: "path_not_allowed",
            message: "the target is outside the configured local roots".to_owned(),
        });
    }
    let mut bytes = [0_u8; 8];
    let length = file.read_at(&mut bytes, 0).map_err(|error| HubError {
        status: 422,
        code: "target_unreadable",
        message: format!("cannot read the target: {error}"),
    })?;
    if !matches!(
        &bytes[..length],
        [b'C', b'D', b'F', 1 | 2 | 5, ..] | [0x89, b'H', b'D', b'F', b'\r', b'\n', 0x1a, b'\n', ..]
    ) {
        return Err(HubError {
            status: 422,
            code: "invalid_dataset",
            message: "the target is not a NetCDF file".to_owned(),
        });
    }
    Dataset::open(&capability).map_err(|_| HubError {
        status: 422,
        code: "invalid_dataset",
        message: "the target is not a readable NetCDF dataset".to_owned(),
    })?;
    Ok(LocalTarget { file })
}

#[cfg(not(target_os = "linux"))]
fn resolve_local_target(_path: &Path, _roots: &[PathBuf]) -> Result<LocalTarget, HubError> {
    Err(HubError {
        status: 501,
        code: "local_hub_unsupported",
        message: "local hub sessions require Linux file capabilities".to_owned(),
    })
}

type LaunchFuture<'a> =
    Pin<Box<dyn Future<Output = Result<LaunchedSession, HubError>> + Send + 'a>>;
type StopFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

trait SessionLauncher: Send + Sync {
    /// Stop and reap launched processes when this absolute deadline expires.
    fn launch<'a>(&'a self, target: Target, deadline: Instant) -> LaunchFuture<'a>;
}

trait SessionProcess: Send {
    fn stop(&mut self) -> StopFuture<'_>;
}

struct LaunchedSession {
    upstream: SocketAddrV4,
    process: Box<dyn SessionProcess>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SessionId(String);

struct Session {
    upstream: SocketAddrV4,
    process: Box<dyn SessionProcess>,
    last_seen: Instant,
}

#[derive(Default)]
struct SessionState {
    starting: usize,
    active: HashMap<SessionId, Session>,
}

struct SessionManager {
    launcher: Arc<dyn SessionLauncher>,
    state: Mutex<SessionState>,
    limit: usize,
    startup_timeout: Duration,
    idle_ttl: Duration,
}

impl SessionManager {
    fn new(
        launcher: Arc<dyn SessionLauncher>,
        limit: usize,
        startup_timeout: Duration,
        idle_ttl: Duration,
    ) -> Self {
        Self {
            launcher,
            state: Mutex::new(SessionState::default()),
            limit,
            startup_timeout,
            idle_ttl,
        }
    }

    async fn open(&self, target: Target) -> Result<SessionId, HubError> {
        {
            let mut state = self.state.lock().await;
            if state.starting + state.active.len() >= self.limit {
                return Err(HubError {
                    status: 429,
                    code: "session_limit_reached",
                    message: format!("the hub allows at most {} active sessions", self.limit),
                });
            }
            state.starting += 1;
        }

        let deadline = Instant::now() + self.startup_timeout;
        let launched = self.launcher.launch(target, deadline).await;
        let mut state = self.state.lock().await;
        state.starting -= 1;
        let mut launched = launched?;
        let id = loop {
            let candidate = match random_session_id() {
                Ok(candidate) => candidate,
                Err(error) => {
                    drop(state);
                    launched.process.stop().await;
                    return Err(error);
                }
            };
            if !state.active.contains_key(&candidate) {
                break candidate;
            }
        };
        state.active.insert(
            id.clone(),
            Session {
                upstream: launched.upstream,
                process: launched.process,
                last_seen: Instant::now(),
            },
        );
        Ok(id)
    }

    async fn upstream(&self, id: &SessionId) -> Result<SocketAddrV4, HubError> {
        let mut state = self.state.lock().await;
        let session = state.active.get_mut(id).ok_or_else(unknown_session)?;
        session.last_seen = Instant::now();
        Ok(session.upstream)
    }

    async fn heartbeat(&self, id: &SessionId) -> Result<(), HubError> {
        self.upstream(id).await.map(|_| ())
    }

    async fn close(&self, id: &SessionId) -> Result<(), HubError> {
        let mut session = self
            .state
            .lock()
            .await
            .active
            .remove(id)
            .ok_or_else(unknown_session)?;
        session.process.stop().await;
        Ok(())
    }

    async fn expire_idle(&self) -> usize {
        let now = Instant::now();
        let mut expired = {
            let mut state = self.state.lock().await;
            let ids = state
                .active
                .iter()
                .filter(|(_, session)| now.duration_since(session.last_seen) >= self.idle_ttl)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| state.active.remove(&id))
                .collect::<Vec<_>>()
        };
        let count = expired.len();
        for session in &mut expired {
            session.process.stop().await;
        }
        count
    }

    async fn shutdown(&self) {
        let mut sessions = {
            let mut state = self.state.lock().await;
            state
                .active
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        for session in &mut sessions {
            session.process.stop().await;
        }
    }
}

fn random_session_id() -> Result<SessionId, HubError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| HubError {
        status: 500,
        code: "session_id_failed",
        message: format!("cannot create a session ID: {error}"),
    })?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut id = String::with_capacity(32);
    for byte in bytes {
        id.push(HEX[(byte >> 4) as usize] as char);
        id.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(SessionId(id))
}

fn session_start_timeout() -> HubError {
    HubError {
        status: 504,
        code: "session_start_timeout",
        message: "the ncx session did not start before its deadline".to_owned(),
    }
}

fn unknown_session() -> HubError {
    HubError {
        status: 404,
        code: "session_not_found",
        message: "unknown ncx session".to_owned(),
    }
}

struct ChildProcess {
    child: Child,
}

impl SessionProcess for ChildProcess {
    fn stop(&mut self) -> StopFuture<'_> {
        Box::pin(async move {
            let _ = self.child.start_kill();
            let _ = self.child.wait().await;
        })
    }
}

struct ProcessLauncher {
    executable: PathBuf,
    limits: Limits,
    remote: Option<RemoteRuntime>,
}

#[cfg(target_os = "linux")]
const LOCAL_DATASET_FD: libc::c_int = 100;

#[cfg(target_os = "linux")]
fn inherit_local_dataset_fd(source_fd: libc::c_int, target_fd: libc::c_int) -> std::io::Result<()> {
    if source_fd != target_fd {
        if unsafe { libc::dup2(source_fd, target_fd) } == -1 {
            return Err(std::io::Error::last_os_error());
        }
        return Ok(());
    }

    let flags = unsafe { libc::fcntl(source_fd, libc::F_GETFD) };
    if flags == -1
        || unsafe { libc::fcntl(source_fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) } == -1
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn configure_local_dataset(command: &mut Command, target: &LocalTarget) {
    let source_fd = target.file.as_raw_fd();
    // The child opens this duplicate after exec, so a later pathname replacement
    // cannot change the already-authorized file.
    unsafe {
        command.pre_exec(move || inherit_local_dataset_fd(source_fd, LOCAL_DATASET_FD));
    }
    command
        .arg("--")
        .arg(format!("/proc/self/fd/{LOCAL_DATASET_FD}"));
}

#[derive(Clone)]
struct RemoteRuntime {
    binary: PathBuf,
    cache_key: String,
    password: String,
    ssh_program: PathBuf,
}

impl SessionLauncher for ProcessLauncher {
    fn launch<'a>(&'a self, target: Target, deadline: Instant) -> LaunchFuture<'a> {
        let executable = self.executable.clone();
        let limits = self.limits;
        let remote = self.remote.clone();
        Box::pin(async move {
            let target = match target {
                Target::Local(target) => target,
                Target::Remote(target) => {
                    let remote = remote.ok_or_else(|| HubError {
                        status: 422,
                        code: "remote_sessions_disabled",
                        message: "this hub has no remote ncx executable".to_owned(),
                    })?;
                    return launch_remote_session(&executable, limits, remote, target, deadline)
                        .await;
                }
            };
            let mut last_error = String::new();
            for attempt in 1..=3 {
                if Instant::now() >= deadline {
                    return Err(session_start_timeout());
                }
                let port = candidate_loopback_port()?;
                let mut command = Command::new(&executable);
                command
                    .arg("serve")
                    .arg("--exit-on-stdin-eof")
                    .arg("--port")
                    .arg(port.to_string())
                    .arg("--max-response-bytes")
                    .arg(limits.max_response_bytes.to_string())
                    .arg("--ugrid-warn-faces")
                    .arg(limits.ugrid_warn_faces.to_string());
                #[cfg(target_os = "linux")]
                configure_local_dataset(&mut command, &target);
                let mut child = command
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::inherit())
                    .env_remove("NCX_ASKPASS_MODE")
                    .env_remove("NCX_SSH_PASSWORD")
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|error| HubError {
                        status: 500,
                        code: "session_start_failed",
                        message: format!("cannot start ncx serve: {error}"),
                    })?;
                match wait_for_server(&mut child, port, deadline).await {
                    Ok(()) => {
                        return Ok(LaunchedSession {
                            upstream: SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, port),
                            process: Box::new(ChildProcess { child }),
                        });
                    }
                    Err(error) => {
                        last_error = error.message;
                        let _ = child.start_kill();
                        let _ = child.wait().await;
                        if attempt < 3 {
                            eprintln!(
                                "ncx: local session startup failed; retrying with another port"
                            );
                        }
                    }
                }
            }
            Err(HubError {
                status: 502,
                code: "session_start_failed",
                message: format!("local ncx did not become ready: {last_error}"),
            })
        })
    }
}

async fn launch_remote_session(
    askpass_executable: &Path,
    limits: Limits,
    remote: RemoteRuntime,
    target: RemoteTarget,
    deadline: Instant,
) -> Result<LaunchedSession, HubError> {
    ensure_remote_binary(askpass_executable, &remote, &target.destination, deadline).await?;
    let mut last_error = String::new();
    for attempt in 1..=3 {
        if Instant::now() >= deadline {
            return Err(session_start_timeout());
        }
        let port = candidate_loopback_port()?;
        let forward = format!("127.0.0.1:{port}:127.0.0.1:{port}");
        let remote_command = remote_serve_command(&remote.cache_key, &target.path, port, limits);
        let mut command = ssh_command(askpass_executable, &remote);
        let mut child = command
            .arg("-o")
            .arg("ExitOnForwardFailure=yes")
            .arg("-L")
            .arg(forward)
            .arg("--")
            .arg(&target.destination)
            .arg(remote_command)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| HubError {
                status: 500,
                code: "ssh_start_failed",
                message: format!("cannot start ssh: {error}"),
            })?;
        match wait_for_server(&mut child, port, deadline).await {
            Ok(()) => {
                return Ok(LaunchedSession {
                    upstream: SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, port),
                    process: Box::new(ChildProcess { child }),
                });
            }
            Err(error) => {
                last_error = error.message;
                let _ = child.start_kill();
                let _ = child.wait().await;
                if attempt < 3 {
                    eprintln!("ncx: SSH session startup failed; retrying with another port");
                }
            }
        }
    }
    Err(HubError {
        status: 502,
        code: "ssh_session_start_failed",
        message: format!("remote ncx did not become ready: {last_error}"),
    })
}

async fn ensure_remote_binary(
    askpass_executable: &Path,
    remote: &RemoteRuntime,
    destination: &str,
    deadline: Instant,
) -> Result<(), HubError> {
    let cache = remote_cache_path(&remote.cache_key);
    let check = format!("test -x \"{cache}\"");
    let mut command = ssh_command(askpass_executable, remote);
    command
        .arg("--")
        .arg(destination)
        .arg(check)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let status = command_status_until(
        command,
        deadline,
        "ssh_start_failed",
        "cannot check the remote ncx cache",
    )
    .await?;
    if status.success() {
        return Ok(());
    }

    let binary = std::fs::File::open(&remote.binary).map_err(|error| HubError {
        status: 500,
        code: "remote_binary_failed",
        message: format!("cannot open the remote ncx binary: {error}"),
    })?;
    let install = format!(
        "cache=\"{cache}\"; dir=${{cache%/*}}; mkdir -p \"$dir\" && \
         tmp=\"$cache.tmp.$$\" && trap 'rm -f \"$tmp\"' EXIT HUP INT TERM && \
         cat > \"$tmp\" && chmod 700 \"$tmp\" && mv -f \"$tmp\" \"$cache\""
    );
    let mut command = ssh_command(askpass_executable, remote);
    command
        .arg("--")
        .arg(destination)
        .arg(install)
        .stdin(Stdio::from(binary))
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    let status = command_status_until(
        command,
        deadline,
        "remote_binary_upload_failed",
        "cannot upload the remote ncx binary",
    )
    .await?;
    if !status.success() {
        return Err(HubError {
            status: 502,
            code: "remote_binary_upload_failed",
            message: format!("remote ncx upload failed with {status}"),
        });
    }
    Ok(())
}

async fn command_status_until(
    mut command: Command,
    deadline: Instant,
    code: &'static str,
    message: &'static str,
) -> Result<std::process::ExitStatus, HubError> {
    let mut child = command
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| HubError {
            status: 500,
            code,
            message: format!("{message}: {error}"),
        })?;
    match timeout_at(deadline, child.wait()).await {
        Ok(result) => result.map_err(|error| HubError {
            status: 500,
            code,
            message: format!("{message}: {error}"),
        }),
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(session_start_timeout())
        }
    }
}

fn ssh_command(askpass_executable: &Path, remote: &RemoteRuntime) -> Command {
    let mut command = Command::new(&remote.ssh_program);
    command
        .arg("-o")
        .arg("BatchMode=no")
        .arg("-o")
        .arg("NumberOfPasswordPrompts=1")
        .arg("-o")
        .arg("PreferredAuthentications=password,keyboard-interactive")
        .arg("-o")
        .arg("PubkeyAuthentication=no")
        .env("SSH_ASKPASS", askpass_executable)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("DISPLAY", "ncx")
        .env("NCX_ASKPASS_MODE", "1")
        .env("NCX_SSH_PASSWORD", &remote.password);
    command
}

fn remote_cache_path(cache_key: &str) -> String {
    format!("$HOME/.cache/ncx/{cache_key}/ncx")
}

fn remote_serve_command(cache_key: &str, path: &str, port: u16, limits: Limits) -> String {
    let arguments = [
        "serve".to_owned(),
        "--exit-on-stdin-eof".to_owned(),
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
    .map(|value| shell_quote(value))
    .collect::<Vec<_>>()
    .join(" ");
    format!("exec \"{}\" {arguments}", remote_cache_path(cache_key))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn binary_fingerprint(path: &Path) -> Result<String, HubError> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|error| HubError {
        status: 500,
        code: "remote_binary_failed",
        message: format!("cannot open remote ncx binary {}: {error}", path.display()),
    })?;
    let mut hash = 0xcbf29ce484222325_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let length = file.read(&mut buffer).map_err(|error| HubError {
            status: 500,
            code: "remote_binary_failed",
            message: format!("cannot read remote ncx binary {}: {error}", path.display()),
        })?;
        if length == 0 {
            break;
        }
        for byte in &buffer[..length] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    Ok(format!("{hash:016x}"))
}

fn candidate_loopback_port() -> Result<u16, HubError> {
    let listener = std::net::TcpListener::bind(SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| HubError {
            status: 500,
            code: "session_port_failed",
            message: format!("cannot choose a loopback port: {error}"),
        })?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| HubError {
            status: 500,
            code: "session_port_failed",
            message: format!("cannot inspect a candidate loopback port: {error}"),
        })
}

fn next_server_probe(now: Instant, deadline: Instant) -> Result<Instant, HubError> {
    if now >= deadline {
        return Err(session_start_timeout());
    }
    Ok(std::cmp::min(now + Duration::from_millis(100), deadline))
}

async fn wait_for_server(child: &mut Child, port: u16, deadline: Instant) -> Result<(), HubError> {
    loop {
        if let Some(status) = child.try_wait().map_err(|error| HubError {
            status: 502,
            code: "session_start_failed",
            message: format!("cannot inspect ncx serve: {error}"),
        })? {
            return Err(HubError {
                status: 502,
                code: "session_start_failed",
                message: format!("ncx serve exited before it was ready ({status})"),
            });
        }
        let retry_at = next_server_probe(Instant::now(), deadline)?;
        if timeout_at(deadline, server_is_ready(port))
            .await
            .unwrap_or(false)
        {
            return Ok(());
        }
        sleep_until(retry_at).await;
    }
}

async fn server_is_ready(port: u16) -> bool {
    let check = async {
        let mut stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .ok()?;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream
            .write_all(
                b"GET /api/datasets HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            )
            .await
            .ok()?;
        let mut response = [0_u8; 64];
        let length = stream.read(&mut response).await.ok()?;
        response[..length]
            .starts_with(b"HTTP/1.1 200")
            .then_some(())
    };
    timeout(Duration::from_millis(500), check)
        .await
        .ok()
        .flatten()
        .is_some()
}

pub(crate) struct HubConfig {
    pub base_path: String,
    pub local_roots: Vec<PathBuf>,
    pub session_limit: usize,
    pub startup_timeout: Duration,
    pub idle_ttl: Duration,
    pub limits: Limits,
    pub remote_ncx: Option<PathBuf>,
    pub ssh_password: Option<String>,
}

impl HubConfig {
    pub fn validate(mut self) -> NcxResult<Self> {
        if self.remote_ncx.is_none() {
            self.remote_ncx = std::env::var_os("NCX_REMOTE_NCX").map(PathBuf::from);
        }
        if self.ssh_password.is_none() {
            self.ssh_password = std::env::var("NCX_SSH_PASSWORD").ok();
        }
        if self.base_path.is_empty()
            || !self.base_path.starts_with('/')
            || self.base_path.ends_with('/')
            || self.base_path.contains('?')
            || self.base_path.contains('#')
        {
            return Err("hub base path must start with `/` and must not end with `/`".to_owned());
        }
        if self.local_roots.is_empty() {
            return Err("ncx hub needs at least one --local-root".to_owned());
        }
        for root in &mut self.local_roots {
            *root = root
                .canonicalize()
                .map_err(|error| format!("cannot find local root {}: {error}", root.display()))?;
            if !root.is_dir() {
                return Err(format!("local root {} is not a directory", root.display()));
            }
        }
        if !(1..=MAX_HUB_SESSIONS).contains(&self.session_limit) {
            return Err(format!(
                "hub session limit must be between 1 and {MAX_HUB_SESSIONS}"
            ));
        }
        if self.startup_timeout.is_zero() || self.idle_ttl.is_zero() {
            return Err("hub timeouts must be greater than zero".to_owned());
        }
        match (&mut self.remote_ncx, &self.ssh_password) {
            (Some(binary), Some(password)) if !password.is_empty() => {
                *binary = binary.canonicalize().map_err(|error| {
                    format!(
                        "cannot find remote ncx binary {}: {error}",
                        binary.display()
                    )
                })?;
                if !binary.is_file() {
                    return Err(format!(
                        "remote ncx binary {} is not a regular file",
                        binary.display()
                    ));
                }
            }
            (None, None) => {}
            _ => {
                return Err(
                    "set both NCX_REMOTE_NCX and NCX_SSH_PASSWORD to enable SSH sessions"
                        .to_owned(),
                );
            }
        }
        Ok(self)
    }
}

struct HubState {
    manager: Arc<SessionManager>,
    local_roots: Vec<PathBuf>,
}

#[derive(Deserialize)]
struct CreateSession {
    address: String,
}

#[derive(Serialize)]
struct CreatedSession {
    session: String,
}

#[derive(Serialize)]
struct HubStatus {
    hub: bool,
    active: bool,
}

pub(crate) async fn serve<F>(listener: TcpListener, config: HubConfig, shutdown: F) -> NcxResult<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let executable = std::env::current_exe()
        .map_err(|error| format!("cannot find the ncx executable: {error}"))?;
    let manager = Arc::new(SessionManager::new(
        Arc::new(ProcessLauncher {
            executable: executable.clone(),
            limits: config.limits,
            remote: match (config.remote_ncx, config.ssh_password) {
                (Some(binary), Some(password)) => Some(RemoteRuntime {
                    cache_key: binary_fingerprint(&binary).map_err(|error| error.message)?,
                    binary,
                    password,
                    ssh_program: PathBuf::from("ssh"),
                }),
                _ => None,
            },
        }),
        config.session_limit,
        config.startup_timeout,
        config.idle_ttl,
    ));
    let state = Arc::new(HubState {
        manager: manager.clone(),
        local_roots: config.local_roots,
    });
    let app = hub_application(&config.base_path, state).map_err(|error| error.message)?;
    let cleanup_manager = manager.clone();
    let cleanup_interval = std::cmp::min(config.idle_ttl, Duration::from_secs(30));
    let cleanup = tokio::spawn(async move {
        loop {
            sleep(cleanup_interval).await;
            cleanup_manager.expire_idle().await;
        }
    });
    let result = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|error| format!("HTTP hub failed: {error}"));
    cleanup.abort();
    manager.shutdown().await;
    result
}

fn hub_application(base_path: &str, state: Arc<HubState>) -> Result<Router, HubError> {
    if base_path == "/" || !base_path.starts_with('/') || base_path.ends_with('/') {
        return Err(HubError {
            status: 500,
            code: "invalid_base_path",
            message: "hub base path must start with `/` and must not end with `/`".to_owned(),
        });
    }
    let api = Router::new()
        .route(
            "/session",
            get(session_status)
                .post(create_session)
                .delete(close_session),
        )
        .route("/session/heartbeat", post(heartbeat_session))
        .route("/datasets", get(relay_datasets))
        .route("/meta", get(relay_metadata))
        .route("/data", get(relay_data))
        .fallback(hub_api_not_found);
    let scoped = server::viewer_routes()
        .route("/healthz", get(health))
        .nest("/api", api)
        .with_state(state);
    let base = base_path.to_owned();
    let redirect_to = format!("{base_path}/");
    Ok(Router::new()
        .route(&redirect_to, get(server::index))
        .nest(base_path, scoped)
        .layer(middleware::from_fn(move |request: Request, next: Next| {
            let base = base.clone();
            let redirect_to = redirect_to.clone();
            async move {
                if request.uri().path() == base {
                    Redirect::permanent(&redirect_to).into_response()
                } else {
                    next.run(request).await
                }
            }
        })))
}

async fn health() -> &'static str {
    "ok\n"
}

async fn session_status(State(state): State<Arc<HubState>>, headers: HeaderMap) -> Json<HubStatus> {
    let active = match session_header(&headers) {
        Ok(id) => state.manager.heartbeat(&id).await.is_ok(),
        Err(_) => false,
    };
    Json(HubStatus { hub: true, active })
}

async fn create_session(
    State(state): State<Arc<HubState>>,
    Json(request): Json<CreateSession>,
) -> Result<(StatusCode, Json<CreatedSession>), HubError> {
    let address = request.address;
    let roots = state.local_roots.clone();
    let target = tokio::task::spawn_blocking(move || resolve_target(&address, &roots))
        .await
        .map_err(|error| HubError {
            status: 500,
            code: "target_check_failed",
            message: error.to_string(),
        })??;
    let id = state.manager.open(target).await?;
    Ok((StatusCode::CREATED, Json(CreatedSession { session: id.0 })))
}

async fn heartbeat_session(
    State(state): State<Arc<HubState>>,
    headers: HeaderMap,
) -> Result<StatusCode, HubError> {
    let id = session_header(&headers)?;
    state.manager.heartbeat(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn close_session(
    State(state): State<Arc<HubState>>,
    headers: HeaderMap,
) -> Result<StatusCode, HubError> {
    let id = session_header(&headers)?;
    state.manager.close(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn relay_datasets(State(state): State<Arc<HubState>>, request: Request) -> Response {
    relay_request(state, request, "/api/datasets").await
}

async fn relay_metadata(State(state): State<Arc<HubState>>, request: Request) -> Response {
    relay_request(state, request, "/api/meta").await
}

async fn relay_data(State(state): State<Arc<HubState>>, request: Request) -> Response {
    relay_request(state, request, "/api/data").await
}

async fn relay_request(state: Arc<HubState>, request: Request, path: &str) -> Response {
    match relay_request_result(state, request, path).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

async fn relay_request_result(
    state: Arc<HubState>,
    request: Request,
    path: &str,
) -> Result<Response, HubError> {
    if request.method() != Method::GET {
        return Err(HubError {
            status: 405,
            code: "relay_method_not_allowed",
            message: "viewer relay routes accept GET only".to_owned(),
        });
    }
    let id = session_header(request.headers())?;
    let upstream = state.manager.upstream(&id).await?;
    let query = request
        .uri()
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    let uri = format!("{path}{query}")
        .parse::<Uri>()
        .map_err(|error| relay_error(format!("cannot build upstream URI: {error}")))?;
    let (mut parts, body) = request.into_parts();
    parts.uri = uri;
    strip_hop_headers(&mut parts.headers);
    parts
        .headers
        .remove(HeaderName::from_static("x-ncx-session"));
    parts.headers.insert(
        HOST,
        HeaderValue::from_str(&upstream.to_string())
            .map_err(|error| relay_error(format!("cannot build upstream host: {error}")))?,
    );
    let stream = TcpStream::connect(upstream)
        .await
        .map_err(|error| relay_error(format!("cannot connect to ncx session: {error}")))?;
    let (mut sender, connection) = http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|error| relay_error(format!("cannot start ncx session request: {error}")))?;
    tokio::spawn(async move {
        if let Err(error) = connection.await {
            eprintln!("ncx: session relay connection failed: {error}");
        }
    });
    let response = sender
        .send_request(axum::http::Request::from_parts(parts, body))
        .await
        .map_err(|error| relay_error(format!("ncx session request failed: {error}")))?;
    let (mut parts, body) = response.into_parts();
    strip_hop_headers(&mut parts.headers);
    Ok(Response::from_parts(parts, Body::new(body)))
}

fn session_header(headers: &HeaderMap) -> Result<SessionId, HubError> {
    let value = headers
        .get(HeaderName::from_static("x-ncx-session"))
        .ok_or_else(|| HubError {
            status: 400,
            code: "session_required",
            message: "X-Ncx-Session is required".to_owned(),
        })?
        .to_str()
        .map_err(|_| unknown_session())?;
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(unknown_session());
    }
    Ok(SessionId(value.to_ascii_lowercase()))
}

fn strip_hop_headers(headers: &mut HeaderMap) {
    let connection_headers = headers
        .get(CONNECTION)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for name in connection_headers {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}

fn relay_error(message: String) -> HubError {
    HubError {
        status: 502,
        code: "session_relay_failed",
        message,
    }
}

async fn hub_api_not_found() -> impl IntoResponse {
    HubError {
        status: 404,
        code: "hub_api_route_not_found",
        message: "unknown ncx hub API route".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::sync::Notify;

    struct FakeLauncher {
        upstream: SocketAddrV4,
        stopped: Arc<AtomicUsize>,
        started: Option<Arc<Notify>>,
        release: Option<Arc<Notify>>,
    }

    impl SessionLauncher for FakeLauncher {
        fn launch<'a>(&'a self, _target: Target, deadline: Instant) -> LaunchFuture<'a> {
            let upstream = self.upstream;
            let stopped = self.stopped.clone();
            let started = self.started.clone();
            let release = self.release.clone();
            Box::pin(async move {
                if let Some(started) = started {
                    started.notify_one();
                }
                if let Some(release) = release
                    && timeout_at(deadline, release.notified()).await.is_err()
                {
                    return Err(session_start_timeout());
                }
                Ok(LaunchedSession {
                    upstream,
                    process: Box::new(FakeProcess { stopped }),
                })
            })
        }
    }

    struct FakeProcess {
        stopped: Arc<AtomicUsize>,
    }

    impl SessionProcess for FakeProcess {
        fn stop(&mut self) -> StopFuture<'_> {
            Box::pin(async move {
                self.stopped.fetch_add(1, Ordering::SeqCst);
            })
        }
    }

    fn fake_manager_at(
        upstream: SocketAddrV4,
        limit: usize,
        ttl: Duration,
        started: Option<Arc<Notify>>,
        release: Option<Arc<Notify>>,
    ) -> (Arc<SessionManager>, Arc<AtomicUsize>) {
        let stopped = Arc::new(AtomicUsize::new(0));
        let launcher = FakeLauncher {
            upstream,
            stopped: stopped.clone(),
            started,
            release,
        };
        (
            Arc::new(SessionManager::new(
                Arc::new(launcher),
                limit,
                Duration::from_secs(1),
                ttl,
            )),
            stopped,
        )
    }

    fn fake_manager(
        limit: usize,
        ttl: Duration,
        started: Option<Arc<Notify>>,
        release: Option<Arc<Notify>>,
    ) -> (Arc<SessionManager>, Arc<AtomicUsize>) {
        fake_manager_at(
            SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 43210),
            limit,
            ttl,
            started,
            release,
        )
    }

    fn fake_target() -> Target {
        Target::Remote(RemoteTarget {
            destination: "test".to_owned(),
            path: "/test.nc".to_owned(),
        })
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("ncx-hub-{unique}"));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn session_limit_counts_starting_sessions_and_close_stops_the_process() {
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let (manager, stopped) = fake_manager(
            1,
            Duration::from_secs(1),
            Some(started.clone()),
            Some(release.clone()),
        );
        let opening = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.open(fake_target()).await })
        };
        started.notified().await;

        let error = manager.open(fake_target()).await.unwrap_err();
        assert_eq!(error.status, 429);
        assert_eq!(error.code, "session_limit_reached");

        release.notify_one();
        let id = opening.await.unwrap().unwrap();
        assert_eq!(
            manager.upstream(&id).await.unwrap(),
            SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 43210)
        );
        manager.close(&id).await.unwrap();
        assert_eq!(stopped.load(Ordering::SeqCst), 1);
        assert_eq!(manager.upstream(&id).await.unwrap_err().status, 404);
    }

    #[test]
    fn server_probe_delay_is_capped_by_the_startup_deadline() {
        let now = Instant::now();
        assert_eq!(
            next_server_probe(now, now + Duration::from_millis(250)).unwrap(),
            now + Duration::from_millis(100)
        );
        assert_eq!(
            next_server_probe(now, now + Duration::from_millis(25)).unwrap(),
            now + Duration::from_millis(25)
        );
        let error = next_server_probe(now, now).unwrap_err();
        assert_eq!(error.status, 504);
        assert_eq!(error.code, "session_start_timeout");
    }

    #[tokio::test]
    async fn startup_deadline_releases_the_starting_session_slot() {
        let release = Arc::new(Notify::new());
        let stopped = Arc::new(AtomicUsize::new(0));
        let manager = SessionManager::new(
            Arc::new(FakeLauncher {
                upstream: SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 43210),
                stopped: stopped.clone(),
                started: None,
                release: Some(release.clone()),
            }),
            1,
            Duration::from_millis(20),
            Duration::from_secs(1),
        );

        let error = manager.open(fake_target()).await.unwrap_err();
        assert_eq!(error.status, 504);
        assert_eq!(error.code, "session_start_timeout");

        release.notify_one();
        let id = manager.open(fake_target()).await.unwrap();
        manager.close(&id).await.unwrap();
        assert_eq!(stopped.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn heartbeat_extends_idle_session_and_shutdown_stops_all_processes() {
        let (manager, stopped) = fake_manager(3, Duration::from_millis(30), None, None);
        let first = manager.open(fake_target()).await.unwrap();
        let _second = manager.open(fake_target()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        manager.heartbeat(&first).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert_eq!(manager.expire_idle().await, 1);
        assert!(manager.upstream(&first).await.is_ok());
        manager.shutdown().await;
        assert_eq!(stopped.load(Ordering::SeqCst), 2);
    }

    async fn raw_http(address: std::net::SocketAddr, request: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        String::from_utf8_lossy(&response).into_owned()
    }

    #[tokio::test]
    async fn hub_http_rejects_unknown_sessions_methods_and_routes_and_closes_sessions() {
        let (manager, stopped) = fake_manager(1, Duration::from_secs(1), None, None);
        let id = manager.open(fake_target()).await.unwrap();
        let state = Arc::new(HubState {
            manager,
            local_roots: Vec::new(),
        });
        let app = hub_application("/ncx", state).unwrap();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let redirect = raw_http(
            address,
            "GET /ncx HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(redirect.starts_with("HTTP/1.1 308"));
        assert!(redirect.to_ascii_lowercase().contains("location: /ncx/"));

        let health = raw_http(
            address,
            "GET /ncx/healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(health.starts_with("HTTP/1.1 200"));
        assert!(health.ends_with("ok\n"));

        let missing = raw_http(
            address,
            "GET /ncx/api/data HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(missing.starts_with("HTTP/1.1 400"));

        let unknown = raw_http(
            address,
            "GET /ncx/api/data HTTP/1.1\r\nHost: localhost\r\nX-Ncx-Session: 00000000000000000000000000000000\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(unknown.starts_with("HTTP/1.1 404"));

        let wrong_method = raw_http(
            address,
            &format!(
                "HEAD /ncx/api/data HTTP/1.1\r\nHost: localhost\r\nX-Ncx-Session: {}\r\nConnection: close\r\n\r\n",
                id.0
            ),
        )
        .await;
        assert!(wrong_method.starts_with("HTTP/1.1 405"));

        let wrong_route = raw_http(
            address,
            &format!(
                "GET /ncx/api/other HTTP/1.1\r\nHost: localhost\r\nX-Ncx-Session: {}\r\nConnection: close\r\n\r\n",
                id.0
            ),
        )
        .await;
        assert!(wrong_route.starts_with("HTTP/1.1 404"));

        let close = raw_http(
            address,
            &format!(
                "DELETE /ncx/api/session HTTP/1.1\r\nHost: localhost\r\nX-Ncx-Session: {}\r\nConnection: close\r\n\r\n",
                id.0
            ),
        )
        .await;
        assert!(close.starts_with("HTTP/1.1 204"));
        assert_eq!(stopped.load(Ordering::SeqCst), 1);
        server.abort();
    }

    #[tokio::test]
    async fn hub_relay_preserves_query_headers_and_streams_chunks() {
        let upstream = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let upstream_address = match upstream.local_addr().unwrap() {
            std::net::SocketAddr::V4(address) => address,
            _ => unreachable!(),
        };
        let request_seen = Arc::new(Mutex::new(String::new()));
        let request_copy = request_seen.clone();
        tokio::spawn(async move {
            let (stream, _) = upstream.accept().await.unwrap();
            let mut request = vec![0_u8; 4096];
            let length = stream
                .readable()
                .await
                .and_then(|_| stream.try_read(&mut request))
                .unwrap();
            *request_copy.lock().await = String::from_utf8_lossy(&request[..length]).into_owned();
            stream.writable().await.unwrap();
            stream.try_write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nX-Ncx-Dtype: f32\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n",
            ).unwrap();
            tokio::time::sleep(Duration::from_millis(150)).await;
            stream.writable().await.unwrap();
            stream.try_write(b"5\r\nworld\r\n0\r\n\r\n").unwrap();
        });
        let (manager, _) = fake_manager_at(upstream_address, 1, Duration::from_secs(1), None, None);
        let id = manager.open(fake_target()).await.unwrap();
        let state = Arc::new(HubState {
            manager,
            local_roots: Vec::new(),
        });
        let app = hub_application("/ncx", state).unwrap();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream
            .write_all(
                format!(
                    "GET /ncx/api/data?path=%2Ftemperature HTTP/1.1\r\nHost: localhost\r\nX-Ncx-Session: {}\r\nX-Test: kept\r\nConnection: close\r\n\r\n",
                    id.0
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut first = vec![0_u8; 4096];
        let first_length =
            tokio::time::timeout(Duration::from_millis(100), stream.read(&mut first))
                .await
                .unwrap()
                .unwrap();
        let first = String::from_utf8_lossy(&first[..first_length]);
        assert!(first.contains("200 OK"));
        assert!(first.contains("hello"));
        assert!(!first.contains("world"));
        let mut remainder = Vec::new();
        stream.read_to_end(&mut remainder).await.unwrap();
        assert!(String::from_utf8_lossy(&remainder).contains("world"));
        let seen = request_seen.lock().await;
        assert!(
            seen.starts_with("GET /api/data?path=%2Ftemperature HTTP/1.1"),
            "upstream request was {seen:?}"
        );
        assert!(seen.to_ascii_lowercase().contains("x-test: kept"));
        assert!(!seen.to_ascii_lowercase().contains("x-ncx-session"));
        server.abort();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn remote_binary_upload_is_reused_for_the_same_version() {
        use std::os::unix::fs::PermissionsExt;
        let directory = TestDirectory::new();
        let binary = directory.0.join("remote-ncx");
        let installed = directory.0.join("installed-ncx");
        let log = directory.0.join("ssh.log");
        std::fs::write(&binary, b"standalone ncx bytes").unwrap();
        let ssh = directory.0.join("fake-ssh");
        std::fs::write(
            &ssh,
            format!(
                "#!/bin/sh\ncmd=''\nfor arg in \"$@\"; do cmd=$arg; done\nprintf '%s\\n' \"$cmd\" >> {}\ncase \"$cmd\" in\n  'test -x '*) test -x {};;\n  *'cat > '*) cat > {}; chmod 700 {};;\n  *) exit 2;;\nesac\n",
                shell_quote(log.to_str().unwrap()),
                shell_quote(installed.to_str().unwrap()),
                shell_quote(installed.to_str().unwrap()),
                shell_quote(installed.to_str().unwrap()),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o700)).unwrap();
        let remote = RemoteRuntime {
            binary: binary.clone(),
            cache_key: binary_fingerprint(&binary).unwrap(),
            password: "secret".to_owned(),
            ssh_program: ssh,
        };

        ensure_remote_binary(
            Path::new("/bin/false"),
            &remote,
            "host",
            Instant::now() + Duration::from_secs(1),
        )
        .await
        .unwrap();
        ensure_remote_binary(
            Path::new("/bin/false"),
            &remote,
            "host",
            Instant::now() + Duration::from_secs(1),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(installed).unwrap(), b"standalone ncx bytes");
        assert_eq!(std::fs::read_to_string(log).unwrap().lines().count(), 3);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn remote_cache_check_stops_and_reaps_at_the_session_deadline() {
        use std::os::unix::fs::PermissionsExt;
        let directory = TestDirectory::new();
        let binary = directory.0.join("remote-ncx");
        let pid_file = directory.0.join("ssh.pid");
        std::fs::write(&binary, b"standalone ncx bytes").unwrap();
        let ssh = directory.0.join("fake-ssh");
        std::fs::write(
            &ssh,
            format!(
                "#!/bin/sh\nprintf '%s' \"$$\" > {}\nexec sleep 30\n",
                shell_quote(pid_file.to_str().unwrap()),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o700)).unwrap();
        let remote = RemoteRuntime {
            binary: binary.clone(),
            cache_key: binary_fingerprint(&binary).unwrap(),
            password: "secret".to_owned(),
            ssh_program: ssh,
        };

        let error = ensure_remote_binary(
            Path::new("/bin/false"),
            &remote,
            "host",
            Instant::now() + Duration::from_millis(50),
        )
        .await
        .unwrap_err();
        let pid = std::fs::read_to_string(pid_file).unwrap();

        assert_eq!(error.status, 504);
        assert_eq!(error.code, "session_start_timeout");
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
    }

    #[test]
    fn remote_command_quotes_the_path_and_uses_the_versioned_cache() {
        let command = remote_serve_command("abc123", "/data/a file's.nc", 8765, Limits::default());
        assert!(command.starts_with("exec \"$HOME/.cache/ncx/abc123/ncx\""));
        assert!(command.contains("'--exit-on-stdin-eof'"));
        assert!(command.ends_with("'/data/a file'\"'\"'s.nc'"));
    }

    #[test]
    fn remote_target_requires_a_safe_destination_and_absolute_path() {
        let Target::Remote(remote) =
            resolve_target("snd2@hkss11:/home/snd2/a file's.nc", &[]).unwrap()
        else {
            panic!("expected remote target");
        };
        assert_eq!(remote.destination, "snd2@hkss11");
        assert_eq!(remote.path, "/home/snd2/a file's.nc");

        for address in [
            "-oProxyCommand=bad:/data/a.nc",
            "host:relative.nc",
            "host:/data/a.nc\ncommand",
            ":/data/a.nc",
        ] {
            assert!(
                resolve_target(address, &[]).is_err(),
                "accepted {address:?}"
            );
        }
    }

    #[test]
    fn hub_config_accepts_ten_sessions_and_rejects_eleven() {
        let directory = TestDirectory::new();
        let config = |session_limit| HubConfig {
            base_path: "/ncx".to_owned(),
            local_roots: vec![directory.0.clone()],
            session_limit,
            startup_timeout: Duration::from_secs(1),
            idle_ttl: Duration::from_secs(1),
            limits: Limits::default(),
            remote_ncx: None,
            ssh_password: None,
        };

        assert_eq!(config(10).validate().unwrap().session_limit, 10);
        assert_eq!(
            config(11).validate().err().unwrap(),
            "hub session limit must be between 1 and 10"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn local_target_stays_in_an_allowed_root_and_is_netcdf() {
        let directory = TestDirectory::new();
        let root = directory.0.join("root");
        std::fs::create_dir(&root).unwrap();
        let target = root.join("classic.nc");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/classic.nc"),
            &target,
        )
        .unwrap();

        let resolved = resolve_local_target(&target, std::slice::from_ref(&root)).unwrap();
        let capability = PathBuf::from(format!("/proc/self/fd/{}", resolved.file.as_raw_fd()));
        assert_eq!(
            capability.canonicalize().unwrap(),
            target.canonicalize().unwrap()
        );
        assert_eq!(
            Dataset::open(&capability).unwrap().metadata().dataset.name,
            "classic.nc"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn equal_local_dataset_fd_clears_close_on_exec() {
        let file = File::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/classic.nc"))
            .unwrap();
        let fd = file.as_raw_fd();
        let original = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert_ne!(original, -1);
        let with_close_on_exec = original | libc::FD_CLOEXEC;
        assert_ne!(
            unsafe { libc::fcntl(fd, libc::F_SETFD, with_close_on_exec) },
            -1
        );

        inherit_local_dataset_fd(fd, fd).unwrap();

        assert_eq!(
            unsafe { libc::fcntl(fd, libc::F_GETFD) },
            with_close_on_exec & !libc::FD_CLOEXEC
        );
        assert_ne!(unsafe { libc::fcntl(fd, libc::F_SETFD, original) }, -1);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn local_child_opens_the_authorized_file_after_the_path_is_replaced() {
        let directory = TestDirectory::new();
        let root = directory.0.join("root");
        std::fs::create_dir(&root).unwrap();
        let inside = root.join("inside.nc");
        let outside = directory.0.join("outside.nc");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/classic.nc"),
            &inside,
        )
        .unwrap();
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/rectilinear.nc"),
            &outside,
        )
        .unwrap();
        let selected = root.join("selected.nc");
        std::os::unix::fs::symlink(&inside, &selected).unwrap();
        let target = resolve_local_target(&selected, std::slice::from_ref(&root)).unwrap();

        std::fs::remove_file(&selected).unwrap();
        std::os::unix::fs::symlink(&outside, &selected).unwrap();
        let mut child = Command::new("cat");
        configure_local_dataset(&mut child, &target);
        let output = child.output().await.unwrap();

        assert!(output.status.success());
        assert_eq!(output.stdout, std::fs::read(&inside).unwrap());
        assert_ne!(output.stdout, std::fs::read(&outside).unwrap());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn local_target_rejects_traversal_directory_symlink_escape_and_non_netcdf() {
        let directory = TestDirectory::new();
        let root = directory.0.join("root");
        std::fs::create_dir(&root).unwrap();
        let outside = directory.0.join("outside.nc");
        std::fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/classic.nc"),
            &outside,
        )
        .unwrap();

        let error = resolve_local_target(&outside, std::slice::from_ref(&root)).unwrap_err();
        assert_eq!(error.status, 403);
        assert_eq!(error.code, "path_not_allowed");

        let error = resolve_local_target(&root, std::slice::from_ref(&root)).unwrap_err();
        assert_eq!(error.code, "target_not_file");

        #[cfg(unix)]
        {
            let link = root.join("escape.nc");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            let error = resolve_local_target(&link, std::slice::from_ref(&root)).unwrap_err();
            assert_eq!(error.code, "path_not_allowed");
        }

        let text = root.join("text.nc");
        std::fs::write(&text, b"not netcdf").unwrap();
        let error = resolve_local_target(&text, &[root]).unwrap_err();
        assert_eq!(error.code, "invalid_dataset");
    }
}
