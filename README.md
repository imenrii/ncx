# ncx

A lightweight, read-only NetCDF viewer with an embedded web interface.
Open local files, inspect remote files over SSH, and compare datasets in the
browser.

## Quick start

```bash
# Open one file or browse a directory
ncx open run.nc
ncx open output/

# Open a remote file through SSH
ncx open cluster:/path/to/run.nc

# Serve without opening a browser
ncx serve --port 8765 run.nc

# Compare named datasets
ncx serve --dataset baseline=run_a.nc --dataset test=run_b.nc
```

Directories include direct regular .nc files. Invalid entries stay in the list
as unavailable. Do not change collection files during a session.

## Features

- Rectilinear, curvilinear, and UGRID field views.
- Time series, profiles, coordinate inspection, and animation.
- Side-by-side comparison of up to four fields and overlays of up to six curves.
- CF-based variable matching, with no server-side regridding.
- Scientific colour scales, point probes, zoom, pan, and fixed colour ranges.
- PNG export with visible ranges, units, legends, and embedded plot fonts.
- Optional OpenStreetMap basemap. Export requires successful map tile loading.

The default response limit is 64 MiB. Use --max-response-bytes to change it.
Process memory also includes decoded source data and library overhead.

## Installation

Download the standalone x86_64-unknown-linux-musl executable from
[GitHub releases](https://github.com/cchomelon/ncx/releases), verify the included
SHA-256 checksum, and make the file executable. The web interface is embedded;
Node.js is not needed at runtime.

### Build from source

Requirements: stable Rust, the NetCDF C library, Node.js, and npm. For example,
install libnetcdf-dev on Debian/Ubuntu or netcdf through Homebrew on macOS.
The frontend build reads colour tables from the sibling Style and lib/ushow
source trees. Do not duplicate those tables in this repository.

```bash
cd web
npm ci
npm run build
cd ..
cargo build --release
```

The executable is target/release/ncx. A normal source build needs the NetCDF
runtime library. The published musl build links NetCDF statically.

For font licences and local font setup, see [res/README.md](res/README.md).

### Container hosting

The supplied Compose service runs the released binary in one container.
See [deploy/README.md](deploy/README.md) for local settings, data mounts, updates,
and access policy. The container is not a development environment.

The hub saves successful addresses in the browser automatically. It never
saves passwords. Local paths must be inside a configured data directory.
Comparison is available in standalone viewers, not hub sessions.

### Publish a Linux release

After the tests pass, install cargo-zigbuild, Zig, and the
x86_64-unknown-linux-musl Rust target on the build host, then run:

```bash
sh deploy/package-release.sh
```

Upload both files from target/release-assets to a release for the source commit
used by the build. The executable embeds the WOFF2 subsets, including Gorton
Perfected. Packaging fails if a font is missing in viewer or hub mode. Do not
upload full font sources or separate font files. The updater uses the latest
published release, not a draft or prerelease. The checksum detects damaged
downloads; it is not a signature.

## Viewer options

Add chrome=none to the viewer URL to hide its topbar and status bar. The dataset
selector and sidebar toggle remain in the toolbar. This setting does not
change dataset access. The embedded=1 option remains separate.

PNG export preserves the visible range. Failed exports show an error in the
Save dialog and can be retried. Hosting policies must permit local blob images
for export composition.

## Development

```bash
# Backend
ncx serve --port 8765 path/to/dataset.nc

# Frontend, in another terminal
cd web
npm run dev
```

## Verification

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
cd web && npm test && npm run build && cd ..
cargo build
```

Browser checks need Firefox and temporary loopback ports. Rebuild the frontend
and Rust binary first, because the browser assets are embedded at compile time.

```bash
node tests/ui-smoke.mjs rectilinear
node tests/ui-smoke.mjs curvilinear
node tests/ui-smoke.mjs ugrid
node tests/ui-smoke.mjs ugrid_projected
node tests/ui-smoke.mjs ugrid_helpers
node tests/ui-smoke.mjs comparison
node tests/ui-smoke.mjs collection
node tests/ui-smoke.mjs station
node tests/ui-smoke.mjs hub
sh tests/hosting-smoke.sh
```

NCX_FIXTURE selects a fixture path. NCX_BINARY selects an executable.
NCX_VIEWPORT_WIDTH and NCX_VIEWPORT_HEIGHT set the browser size. For example:

```bash
NCX_VIEWPORT_WIDTH=360 NCX_VIEWPORT_HEIGHT=640 node tests/ui-smoke.mjs hub
NCX_CHROME=none node tests/ui-smoke.mjs station
NCX_CHROME=none NCX_VIEWPORT_WIDTH=640 node tests/ui-smoke.mjs rectilinear
node tests/ui-visual.mjs /tmp/ncx-visual
NCX_BENCHMARK=1 node tests/ui-smoke.mjs rectilinear
```

Visual checks save screenshots and PNG export samples. Use the same browser,
fonts, and machine when comparing them. Benchmark output is opt-in and is not
a CI performance gate.

Build after the tests pass:

```bash
cd web && npm run build && cd ..
cargo build --release
```
