[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

# ncx

> A fast, standalone NetCDF viewer for the terminal and browser.

Open local files, inspect remote simulations over SSH, and compare complex datasets across meshes—without running heavy notebook servers, bulky desktop GUIs, or server-side regridding pipelines.

---

## Quick Start

```bash
# Open a local file or browse a directory (opens default browser)
ncx open run.nc
ncx open output/

# Inspect a remote file directly across an SSH connection
ncx open cluster:/path/to/run.nc

# Serve headlessly for web access
ncx serve --port 8765 run.nc
```

---

## Highlights

- **Flexible Meshes & Grids**  
  Native support for rectilinear, curvilinear, and unstructured (UGRID) topologies. Inspect CF-compliant variables without server-side interpolation or loss of native fidelity.

- **Inspection & Analysis**  
  Point probes, vertical profiles, time series curves, animations, and coordinate metadata inspection.

- **Dataset Comparison**  
  Side-by-side field comparison for up to 4 fields and overlay plotting for up to 6 curves simultaneously.

- **Self-Contained & Publication-Ready**  
  Perceptually uniform scientific colormaps, zoom/pan with fixed color ranges, and direct PNG export with embedded vector glyphs, legible units, and clean legends.

- **Zero-Dependency Deployment**  
  Shipped as a single static binary with embedded web assets and fonts. No Node.js runtime, Python dependencies, or CDN connections required.

---

## Installation

### Pre-built Binary (Recommended)

Download the standalone `x86_64-unknown-linux-musl` executable from [GitHub Releases](https://github.com/cchomelon/ncx/releases), verify the SHA-256 checksum, and place it in your `PATH`:

```bash
chmod +x ncx-x86_64-unknown-linux-musl
mv ncx-x86_64-unknown-linux-musl ~/.local/bin/ncx
```

The musl binary statically links NetCDF and embeds the complete frontend interface and fonts.

### Building from Source

**Requirements**: Stable Rust toolchain, NetCDF C library (`libnetcdf-dev` on Debian/Ubuntu, `netcdf` on Homebrew), Node.js, and npm.

```bash
# 1. Build frontend assets
cd web
npm ci
npm run build
cd ..

# 2. Compile Rust binary
cargo build --release
```

The resulting binary is located at `target/release/ncx`.

> *Note on embedded fonts*: See [res/README.md](res/README.md) for font licensing notes and local subset configuration.

---

## Usage & Viewer Options

### URL Parameters

- **Clean Embeds**: Append `chrome=none` to the viewer URL to hide the top header and status bar while preserving essential navigation controls in the toolbar.
- **Embedded Mode**: Use `embedded=1` for clean iframe integrations.

### Exporting Figures

PNG export renders the active viewport with crisp typography and units. Probe markers remain interactive in the UI and are excluded from exported figures. Ensure hosting policies allow blob image rendering for image composition.

---

## Container Deployment

A lightweight Docker Compose setup is provided to host an `ncx hub` server for team access:

```bash
cp deploy/.env.example deploy/.env
sh deploy/compose.sh up -d --wait
```

For network configuration, data directory mounts, session policies, and update routines, see [deploy/README.md](deploy/README.md).

---

## Development & Verification

### Dev Server

Run the backend and frontend in separate terminals with hot-reload enabled:

```bash
# Backend
ncx serve --port 8765 path/to/dataset.nc

# Frontend (Vite dev server)
cd web && npm run dev
```

### Verification Suite

```bash
# Linting & Rust tests
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings

# Frontend tests & build
cd web && npm test && npm run build && cd ..
cargo build
```

### UI & Smoke Tests

UI smoke tests run against headless Firefox (or Chromium via `NCX_CHROMIUM=/path/to/chrome`):

```bash
node tests/ui-smoke.mjs rectilinear
node tests/ui-smoke.mjs curvilinear
node tests/ui-smoke.mjs ugrid
node tests/ui-smoke.mjs comparison
node tests/ui-smoke.mjs hub
sh tests/hosting-smoke.sh
```

**Test configuration environment variables**:
- `NCX_FIXTURE`: Custom NetCDF fixture path.
- `NCX_BINARY`: Target binary path under test.
- `NCX_VIEWPORT_WIDTH` / `NCX_VIEWPORT_HEIGHT`: Browser viewport dimensions (e.g. `360x640` for mobile hub testing).
- `NCX_BENCHMARK=1`: Enables opt-in benchmark timing output.
- `NCX_BROWSER_NO_SANDBOX=1`: Disables browser sandbox in constrained CI environments.

---

## Publishing Releases

Packaging statically linked musl releases with embedded font subsets requires `cargo-zigbuild`, Zig, and the `x86_64-unknown-linux-musl` target:

```bash
sh deploy/package-release.sh
```

Upload the artifacts in `target/release-assets` to the matching GitHub release tag.

---

## Typography & Credits

The UI chrome is set in [Gorton Perfected](https://shifthappens.site/store/#fonts) by Marcin Wichary. If you enjoy typography history, check out his wonderful essay on [the hardest working font in Manhattan](https://aresluna.org/the-hardest-working-font-in-manhattan/).


