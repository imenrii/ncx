use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddrV4;
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
use tokio::time::{Instant, sleep, timeout};

use crate::NcxResult;
use crate::dataset::Dataset;
use crate::server::{self, Limits};

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

#[derive(Debug, PartialEq, Eq)]
struct LocalTarget {
    path: PathBuf,
}

fn resolve_local_target(path: &Path, roots: &[PathBuf]) -> Result<LocalTarget, HubError> {
    let path = path.canonicalize().map_err(|error| HubError {
        status: 404,
        code: "target_not_found",
        message: format!("cannot find {}: {error}", path.display()),
    })?;
    let allowed = roots.iter().any(|root| {
        root.canonicalize()
            .is_ok_and(|canonical_root| path.starts_with(canonical_root))
    });
    if !allowed {
        return Err(HubError {
            status: 403,
            code: "path_not_allowed",
            message: "the target is outside the configured local roots".to_owned(),
        });
    }
    if !path.is_file() {
        return Err(HubError {
            status: 422,
            code: "target_not_file",
            message: "the target must be a regular file".to_owned(),
        });
    }
    Dataset::open(&path).map_err(|_| HubError {
        status: 422,
        code: "invalid_dataset",
        message: "the target is not a readable NetCDF dataset".to_owned(),
    })?;
    Ok(LocalTarget { path })
}

type LaunchFuture<'a> =
    Pin<Box<dyn Future<Output = Result<LaunchedSession, HubError>> + Send + 'a>>;
type StopFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

trait SessionLauncher: Send + Sync {
    fn launch<'a>(&'a self, target: LocalTarget, timeout: Duration) -> LaunchFuture<'a>;
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

    async fn open(&self, target: LocalTarget) -> Result<SessionId, HubError> {
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

        let launched = self.launcher.launch(target, self.startup_timeout).await;
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

struct LocalLauncher {
    executable: PathBuf,
    limits: Limits,
}

impl SessionLauncher for LocalLauncher {
    fn launch<'a>(&'a self, target: LocalTarget, startup_timeout: Duration) -> LaunchFuture<'a> {
        let executable = self.executable.clone();
        let limits = self.limits;
        Box::pin(async move {
            let mut last_error = String::new();
            for attempt in 1..=3 {
                let port = candidate_loopback_port()?;
                let mut child = Command::new(&executable)
                    .arg("serve")
                    .arg("--exit-on-stdin-eof")
                    .arg("--port")
                    .arg(port.to_string())
                    .arg("--max-response-bytes")
                    .arg(limits.max_response_bytes.to_string())
                    .arg("--ugrid-warn-faces")
                    .arg(limits.ugrid_warn_faces.to_string())
                    .arg("--")
                    .arg(&target.path)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::inherit())
                    .kill_on_drop(true)
                    .spawn()
                    .map_err(|error| HubError {
                        status: 500,
                        code: "session_start_failed",
                        message: format!("cannot start ncx serve: {error}"),
                    })?;
                match wait_for_server(&mut child, port, startup_timeout).await {
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

async fn wait_for_server(
    child: &mut Child,
    port: u16,
    startup_timeout: Duration,
) -> Result<(), HubError> {
    let deadline = Instant::now() + startup_timeout;
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
        if server_is_ready(port).await {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(HubError {
                status: 504,
                code: "session_start_timeout",
                message: format!(
                    "ncx serve did not start within {} seconds",
                    startup_timeout.as_secs()
                ),
            });
        }
        sleep(Duration::from_millis(100)).await;
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
}

impl HubConfig {
    pub fn validate(mut self) -> NcxResult<Self> {
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
        if self.session_limit == 0 || self.startup_timeout.is_zero() || self.idle_ttl.is_zero() {
            return Err("hub limits and timeouts must be greater than zero".to_owned());
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

pub(crate) async fn serve<F>(listener: TcpListener, config: HubConfig, shutdown: F) -> NcxResult<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let executable = std::env::current_exe()
        .map_err(|error| format!("cannot find the ncx executable: {error}"))?;
    let manager = Arc::new(SessionManager::new(
        Arc::new(LocalLauncher {
            executable,
            limits: config.limits,
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
        .route("/session", post(create_session).delete(close_session))
        .route("/session/heartbeat", post(heartbeat_session))
        .route("/datasets", get(relay_datasets))
        .route("/meta", get(relay_metadata))
        .route("/data", get(relay_data))
        .fallback(hub_api_not_found);
    let scoped = server::viewer_routes()
        .route("/health", get(health))
        .nest("/api", api)
        .with_state(state);
    let base = base_path.to_owned();
    let redirect_to = format!("{base_path}/");
    Ok(Router::new()
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

async fn create_session(
    State(state): State<Arc<HubState>>,
    Json(request): Json<CreateSession>,
) -> Result<(StatusCode, Json<CreatedSession>), HubError> {
    let path = PathBuf::from(request.address);
    if !path.is_absolute() {
        return Err(HubError {
            status: 400,
            code: "local_path_not_absolute",
            message: "local hub paths must be absolute".to_owned(),
        });
    }
    let roots = state.local_roots.clone();
    let target = tokio::task::spawn_blocking(move || resolve_local_target(&path, &roots))
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
        fn launch<'a>(&'a self, _target: LocalTarget, _timeout: Duration) -> LaunchFuture<'a> {
            let upstream = self.upstream;
            let stopped = self.stopped.clone();
            let started = self.started.clone();
            let release = self.release.clone();
            Box::pin(async move {
                if let Some(started) = started {
                    started.notify_one();
                }
                if let Some(release) = release {
                    release.notified().await;
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

    fn fake_target() -> LocalTarget {
        LocalTarget {
            path: PathBuf::from("/test.nc"),
        }
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

        assert_eq!(resolved.path, target.canonicalize().unwrap());
    }

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
