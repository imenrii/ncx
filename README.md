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
```

When pointing to a directory, `ncx` discovers and sorts all direct regular
`.nc` files before it opens any dataset. It opens a file when you select it and
keeps one collection file open between requests. An invalid `.nc` file stays in
the list and is marked as unavailable. Do not change collection files while one
`ncx` session is running; file changes during a session are not supported.
Remote files opened via `host:/path` automatically configure an SSH local port
forward.

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

### Frontend Development

To work on the web UI with live hot-reloading:

```bash
# Terminal 1: run backend server
ncx serve --port 8765 path/to/dataset.nc

# Terminal 2: run Vite dev server (proxies /api to port 8765)
cd web
npm run dev
```

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
node tests/ui-smoke.mjs comparison
node tests/ui-smoke.mjs collection
```

Set `NCX_BENCHMARK=1` to include the latest browser and server timing values in
the smoke-test JSON. This command is opt-in and is not a CI performance gate:

```bash
NCX_BENCHMARK=1 node tests/ui-smoke.mjs rectilinear
```

