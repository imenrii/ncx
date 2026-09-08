# ncx

A fast, lightweight, read-only NetCDF viewer. `ncx` pairs a high-performance Rust backend with an embedded web interface, making it easy to explore, inspect, and compare scientific datasets locally or over SSH.

---

## Quick Start

### Basic Usage

```bash
# Open a single file (starts server and launches browser)
ncx open run.nc

# Browse all NetCDF files in a folder
ncx open output/

# Open a file on a remote cluster over SSH
ncx open cluster:/path/to/simulation.nc

# Run headless server on a specific port
ncx serve --port 8765 run.nc

# Compare multiple simulation runs side-by-side
ncx serve --dataset baseline=run_a.nc --dataset test=run_b.nc

# Run the persistent hub behind a host web server at /ncx/
ncx hub --listen 0.0.0.0:8765 --base-path /ncx --local-root /data
```

When pointing to a directory, `ncx` discovers and sorts all direct regular
`.nc` files before it opens any dataset. It opens a file when you select it and
keeps one collection file open between requests. An invalid `.nc` file stays in
the list and is marked as unavailable. Do not change collection files while one
`ncx` session is running; file changes during a session are not supported.
Remote files opened via `host:/path` automatically configure an SSH local port
forward.

`ncx hub` owns bounded, idle-expiring viewer sessions. The hub can listen on a
configured IPv4 container interface, but every child viewer remains on IPv4
loopback. Local session paths must be absolute and must resolve below a
configured `--local-root`. On Linux, the hub opens and authorizes the local file
before it starts a child, then gives the child that open file instead of opening
the pathname again. The hub allows 1 to 10 starting or active sessions and
streams only the existing viewer GET routes; it does not expose a general HTTP
proxy.

Set `--remote-ncx` to a standalone Linux x86-64 `ncx` executable to enable hub
targets such as `user@host:/absolute/file.nc`. A remote web session owns one
OpenSSH control connection for its `user@host` identity. The password is
required only when that connection starts. The hub passes it through a one-use
pipe, then removes it from memory. A path change on the same identity replaces
the viewer through the existing control connection without another password.
The hub uploads the standalone executable to
`~/.cache/ncx/<content-id>/ncx` on first use and reuses that version. The SSH
host must already be present in the container user's `known_hosts`.

Binary responses have a 64 MiB default limit. Use `--max-response-bytes` to
change this limit. Display fields use little-endian `f32`, coordinates and time
axes use little-endian `f64`, and connectivity keeps its integer type. The
server checks the source and wire buffer sizes before it reads data. An
allowed four-byte display response from an eight-byte source can need up to
three times its response size for the source and wire buffers. Library and HTTP
overhead can increase the process memory above this estimate.

---

## Features

- **2D Field Visualizations**: Renders rectilinear, curvilinear, and unstructured UGRID 2D meshes (nodes, edges, and faces) with GPU-accelerated WebGL.
- **1D Time Series & Profiles**: Plot curves, inspect coordinate slices, and animate through indexed dimensions.
- **Side-by-Side & Overlay Comparison**:
  - Compare up to 4 synchronized 2D spatial fields.
  - Overlay up to 6 CF-compatible 1D curves with display-only offsets.
  - Automatic matching by CF variable semantics, units, and timestamps (no regridding).
- **Interactive Inspection**:
  - Coordinate aspect ratio preservation with round-number ticks.
  - Point probes with native latitude/longitude readouts.
  - Locked color ranges, box zoom, middle-click panning, and print-size PNG export.
  - PNG export keeps the visible coordinate range and rerenders every visible plot pane at the selected width and DPI.
  - Optional OpenStreetMap reference basemap. Exports include active map tiles and attribution; export stops with an error if a tile cannot be fetched with CORS.
- **Scientific Color Scales**: Automatically selects perceptually uniform colormaps based on CF standard names and units, with classic `ncview` schemes available.

---

## Installation & Build

### Prerequisites

- **Rust** (stable toolchain)
- **NetCDF C library** (`libnetcdf-dev` on Debian/Ubuntu, `netcdf` on macOS/Homebrew)
- **Node.js & npm** (only required to compile web UI assets; not needed at runtime)

### Building the Release Binary

Web assets are embedded directly into the Rust binary at compile time.

```bash
# 1. Build frontend assets
cd web
npm ci
npm run build
cd ..

# 2. Compile release binary
cargo build --release
```

The resulting executable in `target/release/ncx` is completely self-contained.

### Persistent intranet hosting

The supplied Compose service downloads the latest published Linux x86-64 musl
executable from `cchomelon/ncx` and runs `ncx hub` on a Docker bridge. The image
contains only runtime tools, not source code, Rust, Node.js, or build tools. Docker publishes exactly `127.0.0.1:8765` on
the host, and Apache maps `/ncx/` to that port. The hub accepts up to 10
sessions and expires an idle session after 90 seconds.

The Compose file mounts `/srv/netcdf:/data:ro`. Edit the `/srv/netcdf` source in
`compose.yaml` if the host data directory is elsewhere. Prepare
`deploy/known_hosts` with the approved SSH host keys before starting the
container. UID 10001 in the container must be able to read the data directory
and `known_hosts`.

Build and start the hub after the first GitHub release is published:

```bash
docker compose build
docker compose up -d
```

Update the installed binary from the latest GitHub release:

```bash
docker exec -it "$(docker compose ps -q ncx)" update.sh
docker compose restart ncx
```

The update checks the release SHA-256 digest and executable before it replaces
the binary. If the update fails, the installed binary stays unchanged. The
`ncx-binary` volume stores the binary across restarts and container replacement.
The rest of the container filesystem stays read-only. A new image does not
replace a binary in an existing volume; use `update.sh` to update it. Restart
immediately after an update, before opening more sessions. Restart closes all
active sessions and makes the hub and its child viewers use the same version.
Do not use `docker compose down -v` unless you intend to delete the binary volume.

Apache HTTPS is required for hosted SSH access. The browser shows a masked
password prompt for each new remote web session and sends the password once in
the session-creation POST body. After authentication, the password is not
retained. Enable Apache `mod_proxy` and `mod_proxy_http`,
include `deploy/apache-ncx.conf.example` in the active HTTPS virtual host,
verify the Apache configuration, and reload Apache. Then visit:

```text
https://hostname/ncx/
```

A deep link has the form
`https://hostname/ncx/user@host:/absolute/path.nc`. The hub decodes the path
once and rejects local or malformed targets. The target path is visible in the
browser URL and history and in Apache access logs; do not put a secret in it.
The hub index sets `no-referrer`, so the target is not sent to OpenStreetMap or
other external requests.

The Save option stores addresses only in the browser. It never stores a
password. The active tab stores only the session ID, SSH destination, and
current address in `sessionStorage`. Refreshing the same target resumes the
session without another POST or prompt. Changing only the path for the same
`user@host` identity retargets the viewer through the existing SSH ControlMaster
without another prompt. Changing the user or host prompts for a new password,
starts the replacement, and closes the old session only after the replacement
works. Cancelled or failed changes keep the old viewer. Local path changes use
the same password-free replacement. Viewer API requests pause while a viewer is
being replaced.

The browser does not close a session on `pagehide`, because that would close it
on an ordinary refresh. Explicit close and the 90-second heartbeat expiry are
cleanup paths. A closed tab can therefore hold one bounded session slot until
its 90-second expiry.

The image uses its standalone `/usr/local/bin/ncx` as the remote executable.
The hub uploads it through SSH once for each binary version to
`~/.cache/ncx/<content-id>/ncx` and reuses that exact version. The remote host
must be Linux x86-64 and must provide a writable home directory.

The hub stores session state in memory. It has no database and no file watcher.
Open a new session to read a newly created file. Stop the deployment with:

```bash
docker compose down
```

Run the deployment smoke test with `tests/hosting-smoke.sh`. The script performs
static checks everywhere and runs the container checks when Docker Compose is
available.

### Publish a Linux release

Run the repository checks first. On the build host, install `cargo-zigbuild`,
Zig, and the Rust `x86_64-unknown-linux-musl` target. Keep the sibling colour
table sources available as described in `AGENTS.md`. Then run:

```bash
sh deploy/package-release.sh
```

The script builds the embedded UI and static NetCDF executable with
`NCX_PUBLIC_RELEASE=1`. This excludes the commercial Gorton font, including
cached subsets, and uses the existing system-font fallback. It writes
`ncx-x86_64-unknown-linux-musl` and its `.sha256` file to
`target/release-assets/`. Publish both files on the same GitHub release, from
the commit used for the build. The container uses GitHub's latest published
release, not a draft or prerelease. Downloads require public release access.
The digest detects damaged or mismatched downloads; it is not a signature.

### Typography and figure export

The current browser typography uses these roles. This table and
`web/src/style.css` replace the older notes under `.tmp/`.

| Role | Face and weight | Spacing |
| --- | --- | --- |
| Interface prose, headings, brand | Gorton Perfected 400 / 600 | UI tokens |
| Uppercase structural labels | National Park 400 | caps tracking; normal features |
| Controls, paths, values, logs, code | Commit Mono 400 / 700 | normal spacing; mono features |
| Plot titles, axes, ticks, annotations | AVHershey Simplex 300 / 400 / 700 | plot tokens |
| Mathematical symbols | CM Math | per-glyph fallback |

Figure and panel titles use Heavy. Axis labels, tick labels, and legends use
Medium, as specified by `Style/plotstyle/rc.py`; secondary annotations use
Light. Uppercase labels are structural only. Commands use sentence case,
and code and variable names retain their original spelling.

The browser size ladder is 12/13/14/16/18 pixels at the default root size,
expressed in rem. Do not introduce nearby one-off sizes or apply interface
font features to monospace text. Unit and variable text keeps its case.
The [Style specification](../Style/design.md) and
[guidance](../Style/Guidance.md) govern figures; browser controls use the
roles above, not plot lettering. The console and viewer use the same roles.

Save PNG captures the visible plot data, including browser-injected comparison
series. Curve exports retain line styles and include a legend with series
names, datums, and displayed offsets. The export embeds the fonts it uses.
A failed export shows an error in the Save dialog and can be retried; it does
not depend on the status bar being visible. Hosts must permit local `blob:`
images in their content security policy for PNG composition.

### Embedded viewer chrome

Add `chrome=none` to the viewer URL to hide its topbar and status bar.
Only this exact value enables the mode. Omit it, or use another value, to
keep the standalone layout. The existing `embedded=1` option remains separate.

The host supplies case identity and status. ncx keeps its variable sidebar,
dataset selector, view controls, plots, and timeline. The dataset selector and
sidebar toggle move into the view toolbar so they remain keyboard-accessible,
including on narrow screens. Hidden bars reserve no layout space and have no
focusable controls. Plot tooltips and figure labels remain available; the
hidden status bar does not forward readouts to the host.

This option changes presentation only. It does not change dataset access,
`generation`, `display_zone`, or `comparison_host` handling. It does not add
host-specific knowledge or a new message protocol.

### Frontend Development

To work on the web UI with live hot-reloading:

```bash
# Terminal 1: run backend server
ncx serve --port 8765 path/to/dataset.nc

# Terminal 2: run Vite dev server (proxies /api to port 8765)
cd web
npm run dev
```

### Frontend source layout

`web/src` keeps the application and numerical code separate:

- `app/`: dataset selection, viewer state, browser, and controls.
- `plots/`: plot views, shared interactions, geometry, rendering, and PNG export.
- `data/`: API decoding, metadata, slice selection, comparison, and time.
- `hub/`: session UI and lifecycle.
- `generated/`: colour tables. Use `web/scripts/sync-colormaps.mjs` to update them.

Tests stay beside their modules. Variable-specific controls reset together in
`app/viewerState.ts`. Viewer preferences and remembered field bounds stay in
`app/Viewer.tsx`. Raster and mesh renderers share pointer interactions, but keep
separate data loading, coordinate conversion, and rendering paths.

---

## Verification & Testing

```bash
# Run unit & lint tests
cd web && npm test && npm run build
cd .. && cargo test && cargo clippy --all-targets -- -D warnings

# Run browser smoke tests (requires Firefox)
node tests/ui-smoke.mjs rectilinear
node tests/ui-smoke.mjs curvilinear
node tests/ui-smoke.mjs ugrid
node tests/ui-smoke.mjs ugrid_projected
node tests/ui-smoke.mjs ugrid_helpers
node tests/ui-smoke.mjs comparison
node tests/ui-smoke.mjs collection
```

The `ugrid_helpers` scenario checks a reduced cuSURGE full-grid fixture. It
keeps mesh areas, lengths, normals, masks, IDs, and coordinate-system metadata
out of the data list. To run that check against a full-grid output file with
the same variables, set `NCX_FIXTURE` to its absolute path.

For fixed Firefox screenshots and PNG export samples, rebuild both layers,
then run:

```bash
node tests/ui-visual.mjs /tmp/ncx-visual
```

This saves desktop and narrow views plus PNG exports for six plot scenarios,
with extra curve, metadata, save-dialog, and UGRID face/edge views.
Use the same Firefox version, fonts, and machine when comparing images. Set
`NCX_BINARY` to an absolute executable path to capture a reference build. These
samples supplement the interaction smoke tests; they do not cover every UI state.

Set `NCX_CHROME=none` to run a scenario with the embedding layout. The smoke
check verifies that both bars are absent and that the relocated sidebar toggle
remains reachable. Set `NCX_VIEWPORT_WIDTH=640` for a 640 by 900 CSS-pixel
window; `NCX_VIEWPORT_HEIGHT` can override that height. For example:

```bash
NCX_CHROME=none node tests/ui-smoke.mjs station
NCX_CHROME=none NCX_VIEWPORT_WIDTH=640 node tests/ui-smoke.mjs rectilinear
```

Set `NCX_BENCHMARK=1` to include the latest browser and server timing values in
the smoke-test JSON. This command is opt-in and is not a CI performance gate:

```bash
NCX_BENCHMARK=1 node tests/ui-smoke.mjs rectilinear
```

