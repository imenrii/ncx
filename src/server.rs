use std::collections::HashSet;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, LazyLock, Mutex, Weak};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Extension, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use crate::NcxResult;
use crate::dataset::{DataError, DataResponse, Dataset, DatasetMetadata, WireType};
use crate::reading::{ReadAdmission, reserved_body};
use tokio::sync::OwnedSemaphorePermit;

const INDEX_HTML: &str = include_str!("../web/dist/index.html");
static VERSIONED_INDEX_HTML: LazyLock<String> = LazyLock::new(|| {
    INDEX_HTML
        .replace(
            "./assets/app.js",
            &format!("./assets/app.js?v={:016x}", content_version(APP_JAVASCRIPT)),
        )
        .replace(
            "./assets/app.css",
            &format!("./assets/app.css?v={:016x}", content_version(APP_CSS)),
        )
});
const APP_JAVASCRIPT: &[u8] = include_bytes!("../web/dist/assets/app.js");
const APP_CSS: &[u8] = include_bytes!("../web/dist/assets/app.css");
include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));
// Fonts, embedded at compile time from `res/` so the binary is the whole
// deliverable -- it has to be, since it is usually run over SSH on a cluster
// that cannot reach a CDN.
//
// Gorton Perfected is the interface face, and it is licensed for use rather
// than redistribution: serving the shipped `.otf` would hand every reader a
// complete, installable copy. What is embedded here is a subset carrying only
// the characters the viewer can set (`web/scripts/subset-fonts.py`), which is
// 307 glyphs and 17 kB against the original's full outline set. The full font
// never enters the binary and is never served.
//
// Commit Mono Web uses pinned, hinted 400/450/600 cuts for web data roles.
// Legacy Commit Mono remains a separate plot fallback. CM Math stays first
// for Greek and operators, so mixed math text is not strictly monospaced.
// These OFL assets are committed; ordinary builds do not regenerate them.
//
// AVHershey draws plots; National Park backs it per glyph and sets chrome
// labels. Both are freely redistributable. Only Gorton's build source and
// subsets are gitignored; without that licence build.rs emits empty files, the
// @font-face fails, and style.css falls through to the platform sans.
const FONT_UI_REGULAR: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/gorton-400.woff2"));
const FONT_UI_SEMIBOLD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/gorton-600.woff2"));
const FONT_MONO_REGULAR: &[u8] = include_bytes!("../res/CommitMono/commit-400.woff2");
const FONT_MONO_BOLD: &[u8] = include_bytes!("../res/CommitMono/commit-700.woff2");
const FONT_WEB_REGULAR: &[u8] = include_bytes!("../res/CommitMono/commit-web-400.woff2");
const FONT_WEB_TEXT: &[u8] = include_bytes!("../res/CommitMono/commit-web-450.woff2");
const FONT_WEB_SEMIBOLD: &[u8] = include_bytes!("../res/CommitMono/commit-web-600.woff2");
const FONT_MATH: &[u8] = include_bytes!("../res/NewCM/NewCMMath-Regular.woff2");
const FONT_PLOT_LIGHT: &[u8] = include_bytes!("../res/AVHershey/AVHersheySimplexLight.woff2");
const FONT_PLOT_MEDIUM: &[u8] = include_bytes!("../res/AVHershey/AVHersheySimplexMedium.woff2");
const FONT_PLOT_HEAVY: &[u8] = include_bytes!("../res/AVHershey/AVHersheySimplexHeavy.woff2");
// AVHershey is a stroke font with 89 glyphs: no smart quotes, dashes,
// ellipsis, superscripts or accents. National Park backs it per glyph so a
// `long_name` with an accent or an en-dash still sets in the plot.
const FONT_PLOT_FALLBACK: &[u8] = include_bytes!("../res/AVHershey/NationalPark.woff2");

pub(crate) async fn viewer_is_ready(port: u16) -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let check = async {
        let mut stream = tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .ok()?;
        stream
            .write_all(
                b"GET /api/datasets HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            )
            .await
            .ok()?;
        // TCP can split the status line, especially through an SSH forward.
        // Keep the read bounded and require the space after the status code.
        const SUCCESS: &[u8] = b"HTTP/1.1 200 ";
        let mut response = [0_u8; SUCCESS.len()];
        stream.read_exact(&mut response).await.ok()?;
        (response == SUCCESS).then_some(())
    };
    tokio::time::timeout(Duration::from_millis(500), check)
        .await
        .ok()
        .flatten()
        .is_some()
}

#[derive(Clone, Copy, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Limits {
    pub max_response_bytes: u64,
    pub ugrid_warn_faces: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_response_bytes: 64 * 1024 * 1024,
            ugrid_warn_faces: 2_000_000,
        }
    }
}

struct AppState {
    reads: ReadAdmission,
    catalog: DatasetCatalog,
    limits: Limits,
}

pub struct ServedDataset {
    id: String,
    label: String,
    source: DatasetSource,
}

impl ServedDataset {
    pub fn eager(id: impl Into<String>, label: impl Into<String>, dataset: Dataset) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            source: DatasetSource::Eager(Arc::new(dataset)),
        }
    }

    pub fn lazy(id: impl Into<String>, label: impl Into<String>, path: PathBuf) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            source: DatasetSource::Lazy(LazyDataset {
                path,
                state: Mutex::new(LazyDatasetState {
                    inspection: DatasetInspection::Uninspected,
                    opening: false,
                    open: Weak::new(),
                }),
                opened: Condvar::new(),
            }),
        }
    }
}

enum DatasetSource {
    Eager(Arc<Dataset>),
    Lazy(LazyDataset),
}

struct LazyDataset {
    path: PathBuf,
    state: Mutex<LazyDatasetState>,
    opened: Condvar,
}

struct LazyDatasetState {
    inspection: DatasetInspection,
    opening: bool,
    open: Weak<Dataset>,
}

#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(rename = "DatasetEntry"))]
struct DatasetSummary {
    id: String,
    label: String,
    #[serde(flatten)]
    inspection: DatasetInspection,
}

#[derive(Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(tag = "state", rename_all = "snake_case")]
enum DatasetInspection {
    Uninspected,
    Ready {
        name: String,
        variables: usize,
        dimensions: usize,
        warnings: usize,
    },
    Unavailable {
        error: String,
    },
}

struct OpenedDataset {
    id: String,
    label: String,
    dataset: Arc<Dataset>,
}

struct DatasetCatalog {
    entries: Vec<ServedDataset>,
    collection: bool,
    active: Mutex<Option<Arc<Dataset>>>,
}

impl DatasetCatalog {
    fn new(entries: Vec<ServedDataset>, collection: bool) -> NcxResult<Self> {
        if entries.is_empty() {
            return Err("ncx serve needs at least one dataset".to_owned());
        }
        let mut ids = HashSet::with_capacity(entries.len());
        if entries.iter().any(|entry| !ids.insert(&entry.id)) {
            return Err("ncx serve dataset IDs must be unique".to_owned());
        }
        Ok(Self {
            entries,
            collection,
            active: Mutex::new(None),
        })
    }

    fn list(&self) -> Vec<DatasetSummary> {
        self.entries
            .iter()
            .map(|entry| DatasetSummary {
                id: entry.id.clone(),
                label: entry.label.clone(),
                inspection: match &entry.source {
                    DatasetSource::Eager(dataset) => ready(dataset.metadata()),
                    DatasetSource::Lazy(lazy) => lazy
                        .state
                        .lock()
                        .map(|state| state.inspection.clone())
                        .unwrap_or_else(|_| DatasetInspection::Unavailable {
                            error: format!("{} is unavailable", entry.label),
                        }),
                },
            })
            .collect()
    }

    fn open(&self, requested: Option<&str>) -> Result<OpenedDataset, DataError> {
        let entry = self.select(requested)?;
        let dataset = match &entry.source {
            DatasetSource::Eager(dataset) => dataset.clone(),
            DatasetSource::Lazy(lazy) => lazy.open(&entry.label)?,
        };
        if self.collection {
            let mut active = self.active.lock().map_err(|_| catalog_lock_error())?;
            *active = Some(dataset.clone());
        }
        Ok(OpenedDataset {
            id: entry.id.clone(),
            label: entry.label.clone(),
            dataset,
        })
    }

    fn select(&self, requested: Option<&str>) -> Result<&ServedDataset, DataError> {
        if let Some(id) = requested {
            return self
                .entries
                .iter()
                .find(|entry| entry.id == id)
                .ok_or_else(|| DataError {
                    status: 404,
                    code: "dataset_not_found",
                    message: format!("unknown dataset {id:?}"),
                    suggested_stride: None,
                });
        }
        if self.entries.len() == 1 {
            return Ok(&self.entries[0]);
        }
        Err(DataError {
            status: 400,
            code: "dataset_required",
            message: "dataset is required when more than one dataset is loaded".to_owned(),
            suggested_stride: None,
        })
    }

    fn named(&self) -> bool {
        self.entries.len() > 1
    }
}

impl LazyDataset {
    fn open(&self, label: &str) -> Result<Arc<Dataset>, DataError> {
        loop {
            let mut state = self.state.lock().map_err(|_| catalog_lock_error())?;
            if let Some(dataset) = state.open.upgrade() {
                return Ok(dataset);
            }
            if let DatasetInspection::Unavailable { error } = &state.inspection {
                return Err(dataset_unavailable(error.clone()));
            }
            if state.opening {
                drop(self.opened.wait(state).map_err(|_| catalog_lock_error())?);
                continue;
            }
            state.opening = true;
            drop(state);

            let result = Dataset::open(&self.path);
            let mut state = self.state.lock().map_err(|_| catalog_lock_error())?;
            state.opening = false;
            match result {
                Ok(dataset) => {
                    let dataset = Arc::new(dataset);
                    state.inspection = ready(dataset.metadata());
                    state.open = Arc::downgrade(&dataset);
                    self.opened.notify_all();
                    return Ok(dataset);
                }
                Err(cause) => {
                    eprintln!("ncx: cannot open {}: {cause}", self.path.display());
                    let error = format!("{label} is not a readable NetCDF dataset");
                    state.inspection = DatasetInspection::Unavailable {
                        error: error.clone(),
                    };
                    self.opened.notify_all();
                    return Err(dataset_unavailable(error));
                }
            }
        }
    }
}

fn ready(metadata: &DatasetMetadata) -> DatasetInspection {
    DatasetInspection::Ready {
        name: metadata.dataset.name.clone(),
        variables: metadata.variables.len(),
        dimensions: metadata.dimensions.len(),
        warnings: metadata.warnings.len(),
    }
}

fn catalog_lock_error() -> DataError {
    DataError {
        status: 500,
        code: "dataset_catalog_failed",
        message: "the dataset catalog lock failed".to_owned(),
        suggested_stride: None,
    }
}

fn dataset_unavailable(message: String) -> DataError {
    DataError {
        status: 422,
        code: "dataset_unavailable",
        message,
        suggested_stride: None,
    }
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
struct MetadataResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dataset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dataset_label: Option<String>,
    #[serde(flatten)]
    metadata: DatasetMetadata,
    limits: Limits,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
struct DatasetsResponse {
    protocol_version: u32,
    datasets: Vec<DatasetSummary>,
    collection: bool,
}

pub async fn serve<F>(
    listener: TcpListener,
    datasets: Vec<ServedDataset>,
    limits: Limits,
    collection: bool,
    shutdown: F,
) -> NcxResult<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let state = Arc::new(AppState {
        reads: ReadAdmission::default(),
        catalog: DatasetCatalog::new(datasets, collection)?,
        limits,
    });
    let api = Router::new()
        .route("/datasets", get(dataset_list))
        .route("/meta", get(metadata))
        .route("/data", get(data))
        .fallback(api_not_found);
    let app = viewer_routes().nest("/api", api).with_state(state);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .map_err(|error| format!("HTTP server failed: {error}"))
}

fn asset_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/assets/app.js", get(app_javascript))
        .route("/assets/app.css", get(app_css))
        .route("/assets/{*asset}", get(extra_asset))
        .route("/fonts/gorton-400.woff2", get(font_ui_regular))
        .route("/fonts/gorton-600.woff2", get(font_ui_semibold))
        .route("/fonts/commit-400.woff2", get(font_mono_regular))
        .route("/fonts/commit-700.woff2", get(font_mono_bold))
        .route("/fonts/commit-web-400.woff2", get(font_web_regular))
        .route("/fonts/commit-web-450.woff2", get(font_web_text))
        .route("/fonts/commit-web-600.woff2", get(font_web_semibold))
        .route("/fonts/cmmath.woff2", get(font_math))
        .route("/fonts/hershey-light.woff2", get(font_plot_light))
        .route("/fonts/hershey-medium.woff2", get(font_plot_medium))
        .route("/fonts/hershey-heavy.woff2", get(font_plot_heavy))
        .route("/fonts/nationalpark.woff2", get(font_plot_fallback))
}

pub(crate) fn viewer_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    asset_routes().route("/", get(index)).fallback(index)
}

pub(crate) fn hub_viewer_routes<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    asset_routes()
        .route("/", get(hub_index))
        .fallback(hub_index)
}

pub(crate) async fn index() -> Response {
    (
        [
            (
                CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        VERSIONED_INDEX_HTML.as_str(),
    )
        .into_response()
}

pub(crate) async fn hub_index(Extension(base_path): Extension<String>) -> Response {
    let base_path = html_attribute(&base_path);
    let html = VERSIONED_INDEX_HTML.replacen(
        "<head>",
        &format!(
            "<head>\n    <base href=\"{base_path}\">\n    <meta name=\"referrer\" content=\"no-referrer\" />"
        ),
        1,
    );
    (
        [
            (
                CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (CACHE_CONTROL, HeaderValue::from_static("no-cache")),
            (
                HeaderName::from_static("referrer-policy"),
                HeaderValue::from_static("no-referrer"),
            ),
        ],
        html,
    )
        .into_response()
}

fn html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

async fn dataset_list(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    (
        [(CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(DatasetsResponse {
            protocol_version: crate::dataset::PROTOCOL_VERSION,
            datasets: state.catalog.list(),
            collection: state.catalog.collection,
        }),
    )
}

#[derive(Default, Deserialize)]
struct DatasetQuery {
    dataset: Option<String>,
}

async fn metadata(
    State(state): State<Arc<AppState>>,
    query: Result<Query<DatasetQuery>, QueryRejection>,
) -> Response {
    let Query(query) = match query {
        Ok(query) => query,
        Err(error) => return invalid_query(error),
    };
    let result = async {
        let _job = state.reads.admit()?;
        let memory = state
            .reads
            .reserve(2 * crate::dataset::MAX_METADATA_BYTES)
            .await?;
        let open = state.clone();
        let body = state
            .reads
            .blocking(move || {
                let source = open.catalog.open(query.dataset.as_deref())?;
                let bytes = crate::reading::bounded_json(
                    &metadata_response(&source, open.catalog.named(), open.limits),
                    crate::dataset::MAX_METADATA_BYTES,
                )?;
                Ok(reserved_body(bytes, memory))
            })
            .await?;
        Ok::<_, DataError>(
            (
                [
                    (CONTENT_TYPE, "application/json"),
                    (CACHE_CONTROL, "no-store"),
                ],
                body,
            )
                .into_response(),
        )
    }
    .await;
    result.unwrap_or_else(error_response)
}

#[derive(Deserialize)]
struct DataQuery {
    dataset: Option<String>,
    path: String,
    selection: String,
    stride: String,
    wire: Option<String>,
}

async fn data(
    State(state): State<Arc<AppState>>,
    query: Result<Query<DataQuery>, QueryRejection>,
) -> Response {
    let Query(query) = match query {
        Ok(query) => query,
        Err(error) => return invalid_query(error),
    };
    let wire = match query
        .wire
        .as_deref()
        .map(str::parse::<WireType>)
        .transpose()
    {
        Ok(wire) => wire,
        Err(error) => return error_response(error),
    };
    let result = async {
        let _job = state.reads.admit()?;
        let started = Instant::now();
        let open = state.clone();
        let requested = query.dataset;
        let opening_memory = state
            .reads
            .reserve(4 * crate::dataset::MAX_METADATA_BYTES)
            .await?;
        let source = state
            .reads
            .blocking(move || {
                let _memory = opening_memory;
                open.catalog.open(requested.as_deref())
            })
            .await?;
        let plan = source.dataset.plan_read(
            &query.path,
            &query.selection,
            &query.stride,
            wire,
            state.limits.max_response_bytes,
        )?;
        let memory = state.reads.reserve(plan.peak_bytes).await?;
        let slot = source
            .dataset
            .read_slot
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| DataError::new(503, "reader_closed", "Reader closed"))?;
        let (data, memory) = state
            .reads
            .blocking(move || {
                let _slot = slot;
                Ok((source.dataset.read(plan)?, memory))
            })
            .await?;
        Ok::<_, DataError>(data_response(data, started.elapsed(), Some(memory)))
    }
    .await;
    result.unwrap_or_else(error_response)
}

fn metadata_response(source: &OpenedDataset, named: bool, limits: Limits) -> MetadataResponse {
    MetadataResponse {
        dataset_id: named.then(|| source.id.clone()),
        dataset_label: named.then(|| source.label.clone()),
        metadata: source.dataset.metadata().clone(),
        limits,
    }
}

fn invalid_query(error: QueryRejection) -> Response {
    error_response(DataError {
        status: 400,
        code: "invalid_query",
        message: error.body_text(),
        suggested_stride: None,
    })
}

fn data_response(
    data: DataResponse,
    read_time: Duration,
    memory: Option<OwnedSemaphorePermit>,
) -> Response {
    let shape = data
        .shape
        .iter()
        .map(usize::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let body = match memory {
        Some(permit) => reserved_body(data.body, permit),
        None => bytes::Bytes::from(data.body),
    };
    let mut response = Response::new(Body::from(body));
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-ncx-dtype"),
        HeaderValue::from_static(data.dtype),
    );
    headers.insert(
        HeaderName::from_static("x-ncx-shape"),
        HeaderValue::from_str(&shape).expect("numeric shape is a valid HTTP header"),
    );
    headers.insert(
        HeaderName::from_static("x-ncx-endian"),
        HeaderValue::from_static("little"),
    );
    headers.insert(
        HeaderName::from_static("server-timing"),
        HeaderValue::from_str(&format!(
            "read;dur={:.3}",
            read_time.as_secs_f64() * 1_000.0
        ))
        .expect("a finite duration is a valid Server-Timing header"),
    );
    response
}

#[derive(Serialize)]
struct ApiError {
    error: ErrorDetail,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    suggested_stride: Option<Vec<usize>>,
}

fn error_response(error: DataError) -> Response {
    let status = StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut response = (
        status,
        [(CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(ApiError {
            error: ErrorDetail {
                code: error.code,
                message: error.message,
                suggested_stride: error.suggested_stride,
            },
        }),
    )
        .into_response();
    if status == StatusCode::SERVICE_UNAVAILABLE {
        response
            .headers_mut()
            .insert("retry-after", HeaderValue::from_static("1"));
    }
    response
}

async fn api_not_found() -> Response {
    error_response(DataError {
        status: 404,
        code: "api_route_not_found",
        message: "unknown ncx API route".to_owned(),
        suggested_stride: None,
    })
}

fn font(bytes: &'static [u8]) -> Response {
    static_asset("font/woff2", bytes)
}

fn static_asset(content_type: &'static str, bytes: &'static [u8]) -> Response {
    (
        [
            (CONTENT_TYPE, HeaderValue::from_static(content_type)),
            (
                CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            ),
        ],
        bytes,
    )
        .into_response()
}

const fn content_version(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325;
    let mut index = 0;
    while index < bytes.len() {
        hash ^= bytes[index] as u64;
        hash = hash.wrapping_mul(0x100000001b3);
        index += 1;
    }
    hash
}

async fn app_javascript() -> Response {
    static_asset("text/javascript; charset=utf-8", APP_JAVASCRIPT)
}

async fn app_css() -> Response {
    static_asset("text/css; charset=utf-8", APP_CSS)
}

async fn extra_asset(axum::extract::Path(name): axum::extract::Path<String>) -> Response {
    match EXTRA_ASSETS.iter().find(|(asset, _)| *asset == name) {
        Some((_, bytes)) => static_asset(
            if name.ends_with(".wasm") {
                "application/wasm"
            } else if name.ends_with(".json") {
                "application/json"
            } else if name.ends_with(".zip") || name.ends_with(".whl") {
                "application/octet-stream"
            } else if name.ends_with(".txt") {
                "text/plain; charset=utf-8"
            } else {
                "text/javascript; charset=utf-8"
            },
            bytes,
        ),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn font_ui_regular() -> Response {
    font(FONT_UI_REGULAR)
}

async fn font_ui_semibold() -> Response {
    font(FONT_UI_SEMIBOLD)
}

async fn font_mono_regular() -> Response {
    font(FONT_MONO_REGULAR)
}

async fn font_mono_bold() -> Response {
    font(FONT_MONO_BOLD)
}

async fn font_web_regular() -> Response {
    font(FONT_WEB_REGULAR)
}

async fn font_web_text() -> Response {
    font(FONT_WEB_TEXT)
}

async fn font_web_semibold() -> Response {
    font(FONT_WEB_SEMIBOLD)
}

async fn font_math() -> Response {
    font(FONT_MATH)
}

async fn font_plot_light() -> Response {
    font(FONT_PLOT_LIGHT)
}

async fn font_plot_medium() -> Response {
    font(FONT_PLOT_MEDIUM)
}

async fn font_plot_heavy() -> Response {
    font(FONT_PLOT_HEAVY)
}

async fn font_plot_fallback() -> Response {
    font(FONT_PLOT_FALLBACK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_types_are_current() {
        use crate::cf::{GeographicAxis, GeographicCoordinates, TimeAxis, VariableCapabilities};
        use crate::dataset::*;
        use ts_rs::TS;
        let config = ts_rs::Config::new().with_large_int("number");
        let declarations = [
            DatasetMetadata::decl(&config),
            crate::dataset::DatasetSummary::decl(&config),
            GroupSummary::decl(&config),
            DimensionSummary::decl(&config),
            VariableDimension::decl(&config),
            VariableSummary::decl(&config),
            ViewHint::decl(&config),
            AttributeSummary::decl(&config),
            AttributeData::decl(&config),
            AttributeScalar::decl(&config),
            VariableCapabilities::decl(&config),
            TimeAxis::decl(&config),
            GeographicCoordinates::decl(&config),
            GeographicAxis::decl(&config),
            Limits::decl(&config),
            super::DatasetSummary::decl(&config),
            DatasetInspection::decl(&config),
            MetadataResponse::decl(&config),
            DatasetsResponse::decl(&config),
        ];
        let expected = format!(
            "// Generated from Rust DTOs. Run NCX_UPDATE_PROTOCOL=1 cargo test protocol_types_are_current.\nexport const PROTOCOL_VERSION = {PROTOCOL_VERSION};\n{}\n",
            declarations
                .into_iter()
                .map(|d| format!("export {d}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("web/src/generated/protocol.ts");
        if std::env::var_os("NCX_UPDATE_PROTOCOL").is_some() {
            std::fs::write(&path, &expected).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            expected,
            "stale generated protocol"
        );

        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut fixtures = std::collections::BTreeMap::new();
        for entry in std::fs::read_dir(root.join("tests/data")).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|extension| extension != "nc") {
                continue;
            }
            let name = path.file_stem().unwrap().to_str().unwrap().to_owned();
            let dataset = Dataset::open(&path).unwrap();
            let source = OpenedDataset {
                id: name.clone(),
                label: name.clone(),
                dataset: Arc::new(dataset),
            };
            fixtures.insert(name, metadata_response(&source, true, Limits::default()));
        }
        let expected = format!("{}\n", serde_json::to_string_pretty(&fixtures).unwrap());
        let path = root.join("web/src/generated/metadata-fixtures.json");
        if std::env::var_os("NCX_UPDATE_PROTOCOL").is_some() {
            std::fs::write(&path, &expected).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            expected,
            "stale canonical metadata fixtures"
        );
    }

    const READINESS_REQUEST: &[u8] =
        b"GET /api/datasets HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";

    #[tokio::test]
    async fn viewer_readiness_handles_split_status_and_rejects_invalid_responses() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for (chunks, expected) in [
            (vec!["HTTP/1.1 ", "200 OK\r\n\r\n"], true),
            (vec!["H", "TTP/1.1 200 OK\r\n\r\n"], true),
            (vec!["HTTP/1.1 503 Service Unavailable\r\n\r\n"], false),
            (vec!["HTTP/1.1 2000 Invalid\r\n\r\n"], false),
            (vec!["HTTP/1.1 20"], false),
            (vec![""], false),
        ] {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap();
            let port = listener.local_addr().unwrap().port();
            let peer = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; READINESS_REQUEST.len()];
                stream.read_exact(&mut request).await.unwrap();
                assert_eq!(request, READINESS_REQUEST);
                for chunk in chunks {
                    if stream.write_all(chunk.as_bytes()).await.is_err() {
                        break;
                    }
                    // A TCP status line can arrive in separate reads through an SSH forward.
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            });
            let ready = viewer_is_ready(port).await;
            peer.await.unwrap();
            assert_eq!(ready, expected);
        }
    }

    #[tokio::test]
    async fn viewer_readiness_bounds_a_stalled_status_line() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let peer = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; READINESS_REQUEST.len()];
            stream.read_exact(&mut request).await.unwrap();
            assert_eq!(request, READINESS_REQUEST);
            stream.write_all(b"HTTP/1.1 ").await.unwrap();
            // Keep the response open until the probe closes its connection.
            assert_eq!(stream.read(&mut request).await.unwrap(), 0);
        });
        assert!(
            !tokio::time::timeout(Duration::from_secs(2), viewer_is_ready(port))
                .await
                .unwrap()
        );
        peer.await.unwrap();
    }

    #[tokio::test]
    async fn hub_index_sets_the_base_path_and_no_referrer_policy() {
        let response = hub_index(Extension("/ncx/".to_owned())).await;
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = std::str::from_utf8(&body).unwrap();
        assert!(html.contains(r#"<base href="/ncx/">"#));
        assert!(html.contains(r#"<meta name="referrer" content="no-referrer" />"#));
    }

    #[tokio::test]
    async fn direct_index_has_no_hub_deep_link_base() {
        let response = index().await;
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = std::str::from_utf8(&body).unwrap();
        assert!(!html.contains(r#"<base href="#));
        assert!(!html.contains(r#"name="referrer"#));
    }

    #[test]
    fn application_assets_are_content_versioned_and_immutable() {
        assert!(
            VERSIONED_INDEX_HTML.contains(&format!(
                "./assets/app.js?v={:016x}",
                content_version(APP_JAVASCRIPT)
            )),
            "the HTML must bypass immutable bundles from older ncx releases"
        );

        let response = static_asset("text/plain", b"test");
        assert_eq!(
            response.headers()[CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
    }

    #[test]
    fn default_response_limit_is_64_mib() {
        assert_eq!(Limits::default().max_response_bytes, 64 * 1024 * 1024);
    }

    #[tokio::test]
    async fn data_response_reports_f64_shape_body_and_complete_read_time() {
        let reads = ReadAdmission::default();
        let memory = reads.reserve(crate::reading::MEMORY_BYTES).await.unwrap();
        let response = data_response(
            DataResponse {
                dtype: "f64",
                shape: vec![3],
                body: [1.0_f64, 1.03125, 1.0625]
                    .into_iter()
                    .flat_map(f64::to_le_bytes)
                    .collect(),
            },
            std::time::Duration::from_micros(1_250),
            Some(memory),
        );
        assert_eq!(response.headers()["x-ncx-dtype"], "f64");
        assert_eq!(response.headers()["x-ncx-shape"], "3");
        assert_eq!(response.headers()["x-ncx-endian"], "little");
        assert_eq!(response.headers()["server-timing"], "read;dur=1.250");
        let body = axum::body::to_bytes(response.into_body(), 24)
            .await
            .unwrap();
        assert_eq!(body.len(), 24);
        assert!(
            tokio::time::timeout(Duration::from_millis(10), reads.reserve(1))
                .await
                .is_err()
        );
        drop(body);
        assert!(
            tokio::time::timeout(Duration::from_secs(1), reads.reserve(1))
                .await
                .unwrap()
                .is_ok()
        );
    }

    #[test]
    fn invalid_wire_type_has_a_clear_client_error() {
        let error = "f16".parse::<WireType>().unwrap_err();
        assert_eq!(error.status, 400);
        assert_eq!(error.code, "invalid_wire_type");
        assert_eq!(error.message, "wire must be `f32` or `f64`");
    }

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/data/{name}"))
    }

    #[test]
    fn lazy_catalog_lists_before_open_and_records_first_open() {
        let catalog = DatasetCatalog::new(
            vec![ServedDataset::lazy(
                "classic",
                "classic.nc",
                fixture("classic.nc"),
            )],
            true,
        )
        .unwrap();

        assert!(matches!(
            catalog.list()[0].inspection,
            DatasetInspection::Uninspected
        ));
        let opened = catalog.open(Some("classic")).unwrap();
        assert_eq!(opened.dataset.metadata().dataset.name, "classic.nc");
        assert!(matches!(
            catalog.list()[0].inspection,
            DatasetInspection::Ready { variables, .. } if variables > 0
        ));
    }

    #[test]
    fn lazy_catalog_retains_one_active_handle_and_reuses_it() {
        let catalog = DatasetCatalog::new(
            vec![
                ServedDataset::lazy("classic", "classic.nc", fixture("classic.nc")),
                ServedDataset::lazy("rectilinear", "rectilinear.nc", fixture("rectilinear.nc")),
            ],
            true,
        )
        .unwrap();

        let first = catalog.open(Some("classic")).unwrap();
        let repeated = catalog.open(Some("classic")).unwrap();
        assert!(Arc::ptr_eq(&first.dataset, &repeated.dataset));
        let first_weak = Arc::downgrade(&first.dataset);
        drop(first);
        drop(repeated);
        assert!(first_weak.upgrade().is_some());

        let second = catalog.open(Some("rectilinear")).unwrap();
        assert_eq!(second.id, "rectilinear");
        assert!(first_weak.upgrade().is_none());
    }

    #[test]
    fn concurrent_lazy_opens_share_one_dataset() {
        let catalog = Arc::new(
            DatasetCatalog::new(
                vec![ServedDataset::lazy(
                    "classic",
                    "classic.nc",
                    fixture("classic.nc"),
                )],
                true,
            )
            .unwrap(),
        );
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let open = |catalog: Arc<DatasetCatalog>, barrier: Arc<std::sync::Barrier>| {
            std::thread::spawn(move || {
                barrier.wait();
                catalog.open(Some("classic")).unwrap().dataset
            })
        };
        let first = open(catalog.clone(), barrier.clone());
        let second = open(catalog, barrier.clone());
        barrier.wait();

        assert!(Arc::ptr_eq(&first.join().unwrap(), &second.join().unwrap()));
    }

    #[test]
    fn invalid_lazy_entry_does_not_block_valid_siblings() {
        let invalid = std::env::temp_dir().join(format!("ncx-invalid-{}.nc", std::process::id()));
        std::fs::write(&invalid, b"not netcdf").unwrap();
        let catalog = DatasetCatalog::new(
            vec![
                ServedDataset::lazy("invalid", "invalid.nc", invalid.clone()),
                ServedDataset::lazy("classic", "classic.nc", fixture("classic.nc")),
            ],
            true,
        )
        .unwrap();

        let error = catalog.open(Some("invalid")).err().unwrap();
        assert_eq!(error.code, "dataset_unavailable");
        assert!(matches!(
            catalog.list()[0].inspection,
            DatasetInspection::Unavailable { .. }
        ));
        assert_eq!(
            catalog
                .open(Some("classic"))
                .unwrap()
                .dataset
                .metadata()
                .dataset
                .name,
            "classic.nc"
        );
        std::fs::remove_file(invalid).unwrap();
    }

    #[test]
    fn eager_catalog_preserves_single_and_named_dataset_selection() {
        let source =
            |id: &str| ServedDataset::eager(id, id, Dataset::open(&fixture("classic.nc")).unwrap());
        let single = DatasetCatalog::new(vec![source("only")], false).unwrap();
        assert_eq!(single.open(None).unwrap().id, "only");

        let multiple =
            DatasetCatalog::new(vec![source("case-a"), source("case-b")], false).unwrap();
        assert_eq!(multiple.open(None).err().unwrap().code, "dataset_required");
        assert_eq!(multiple.open(Some("case-b")).unwrap().id, "case-b");
        assert_eq!(
            multiple.open(Some("missing")).err().unwrap().code,
            "dataset_not_found"
        );
    }

    #[tokio::test]
    async fn dataset_http_seams_show_lazy_state_then_metadata_transition() {
        let state = Arc::new(AppState {
            reads: ReadAdmission::default(),
            catalog: DatasetCatalog::new(
                vec![ServedDataset::lazy(
                    "classic",
                    "classic.nc",
                    fixture("classic.nc"),
                )],
                true,
            )
            .unwrap(),
            limits: Limits::default(),
        });
        let tickets: Vec<_> = (0..crate::reading::MAX_REQUESTS)
            .map(|_| state.reads.admit().unwrap())
            .collect();
        let busy = metadata(State(state.clone()), Ok(Query(DatasetQuery::default()))).await;
        assert_eq!(busy.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(busy.headers()["retry-after"], "1");
        drop(tickets);
        let before = dataset_list(State(state.clone())).await.into_response();
        let before = axum::body::to_bytes(before.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(
            std::str::from_utf8(&before)
                .unwrap()
                .contains("\"state\":\"uninspected\"")
        );

        let response = metadata(
            State(state.clone()),
            Ok(Query(DatasetQuery {
                dataset: Some("classic".to_owned()),
            })),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);

        let after = dataset_list(State(state)).await.into_response();
        let after = axum::body::to_bytes(after.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(
            std::str::from_utf8(&after)
                .unwrap()
                .contains("\"state\":\"ready\"")
        );
    }
}
