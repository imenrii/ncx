# ncx

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

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
  Side-by-side viewing for one to four fields and overlay plotting for up to eight sources (at most six datasets).

- **Self-Contained & Publication-Ready**  
  Perceptually uniform scientific colormaps, zoom/pan with fixed color ranges, and direct PNG export with embedded vector glyphs, legible units, and clean legends.

- **Zero-Dependency Deployment**  
  Shipped as a single static binary with embedded web assets and fonts. No Node.js runtime or Python dependencies required. The optional coastline layer needs an internet connection on first use.

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

## Viewer Options & Embedding

### URL Parameters

- **Clean Embeds**: Append `chrome=none` to the viewer URL to hide the header, status bar, and file list for minimal iframe integration.
- **Embedded Mode**: Use `embedded=1` for responsive embedding without standalone window chrome.
- **Display Timezone**: Use `display_zone=<zone>` to set a fixed display timezone (defaults to UTC).

### Host Integration & Documentation

For embedding contracts, internal architectures, and developer references:

- **[Embedding Contract](docs/embedding.md)**: JavaScript API (`window.ncx`), wire format, source synchronization, and secondary curve panels.
- **[Steering Console](docs/steering.md)**: In-browser Python/NumPy console, lazy expression evaluation, and WebAssembly worker limits.
- **[Data & CF Conventions](docs/data-contract.md)**: CF/UGRID resolution, metadata schemas, and slice request protocol.
- **[Plot Style](docs/plot-style.md)**: Visual standards, typography rules, and publication figure presets.

---

## Container Deployment

A lightweight Docker Compose setup is provided to host an `ncx hub` server:

```bash
cp .env.example .env
sh deploy/compose.sh up -d --wait
```

For network configuration, data directory mounts, session policies, and authentication options, see [deploy/README.md](deploy/README.md).

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

### UI Smoke Tests

Headless browser smoke tests run against Firefox or Chromium:

```bash
node tests/ui-smoke.mjs rectilinear
node tests/ui-smoke.mjs curvilinear
node tests/ui-smoke.mjs ugrid
node tests/ui-smoke.mjs comparison
node tests/ui-smoke.mjs hub
node tests/ui-smoke.mjs wind
sh tests/hosting-smoke.sh
```

**Environment Variables**:
- `NCX_FIXTURE`: Custom NetCDF fixture path.
- `NCX_BINARY`: Target binary path under test.
- `NCX_CHROMIUM`: Path to custom Chromium/Chrome binary.
- `NCX_BROWSER_NO_SANDBOX=1`: Disables browser sandbox in containerized CI.

---

## Publishing Releases

Statically linked musl releases with embedded assets can be packaged with:

```bash
sh deploy/package-release.sh
```

---

## Typography & Credits

Web controls, identifiers, and values use **Commit Mono Web** by Eigil Nikolajsen. UI lettering uses **Gorton Perfected** by Marcin Wichary and **National Park**. See [res/README.md](res/README.md) for font files, licenses, and build configurations.
