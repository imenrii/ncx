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
  Side-by-side viewing for one to four fields and overlay plotting for up to six model curves plus one hosted reference.

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

## Usage & Viewer Options

### URL Parameters

- **Clean Embeds**: Append `chrome=none` to the viewer URL to hide the top header and status bar while preserving essential navigation controls in the toolbar.
- **Embedded Mode**: Use `embedded=1` for clean iframe integrations.

### Sources, Plots, and Station References

Field and Curve use the same plot implementation for one or several model
sources. `Sources` controls participation and the primary dataset independently
of representation. Curve supports six model series plus one hosted reference
with shared drag selection, range reset, and crosshair readouts. Field supports
one through four visible panes, including three panes. Larger source sets
expose an explicit pane selection. Unavailable sources retain their error
without removing healthy plots. Selection mapping does not infer equivalent
locations from indices on unrelated meshes. A secondary fixed dimension without
an explicit mapping is unavailable rather than silently clamped or substituted.

An eligible station Curve shows a host-supplied reference by default. The host
receives explicit location identity, quantity, units, and a UTC time extent;
ncx does not infer provider identity from filenames or variable names. A
matching reference is shared across participating model sources and can be
hidden. Standalone viewing requires no reference host. Reference failures and
retry remain separate from model loading.

Model offsets never transform reference samples. Absolute-time models retain
X-minute and Y-unit offsets; numeric models expose only Y-unit offsets. A
reference-supplied primary Y-offset preset changes only the primary model,
and only after an explicit user action. Reference source timestamps and values remain unchanged. Unit conversion can
change their displayed values, but model offsets never apply to them. Axis
autoscaling can change pixel positions without changing physical values.

Dataset navigation is in the variable browser. A labelled `Variables` toggle
stays in the view toolbar in both standalone and embedded layouts. Chrome
selection hides bars without moving navigation. Screen rendering, controls,
and export use the same series metadata rather than deriving export labels
from control markup. Keyboard access and narrow layouts remain required.

### Curve Units and Wind

Curve has a **Units** selector after **Time**. Supported quantities include
pressure, wind, temperature, water-equivalent depth, height, fractions, wave
periods and directions, radiation, heat flux, and specific energy. The file's
unit is the default. Conversions change the plot, labels, readouts, offsets,
and PNG output, not the file or source samples. Field colour ranges remain
independent. Unit changes do not read another data slice.

The appendable rules are in `web/src/data/units.ts`, with aliases from the
[ERA5 variable list](https://ecmwf-models.readthedocs.io/en/latest/variables_era5.html).
A known name does not override incompatible or missing units. Accumulations
are not converted to rates. Pressure vertical velocity is not wind speed.

When compatible `u10` and `v10` exist, Curve also offers **Quantity → 10 m wind
speed — derived**. Beaufort is available for this quantity and recognized
10 m speed variables, not signed components or gusts. It uses discrete force
categories; it does not establish a standard averaging period. Selecting Bft
clears Y display offsets and starts an automatic linear range. Area probes
use paired vector means before calculating speed and direction.

**Wind → On** adds equal-length direction arrows to Field and a wind-barb row
to time curves. The annotation strip is always reserved in field and curve
layout, including when Wind is off or unavailable. Field arrows point toward
motion. Curve barbs use the Style convention: half/full/pennant increments of
2.5/5/25 m/s, or 5/10/50 knots when the curve unit is `kt`. Hover or focus a barb
for its time, speed, direction of origin, and increments. PNG output includes
the marks and their unit key. No weather font is required.

Unavailable Wind controls are grey. Hover over the control for the reason.
Wind component units in metadata take precedence. If a component has no unit,
the curve uses the selected velocity unit; a field uses the selected variable's
velocity unit. Incompatible units and Beaufort are not component-unit fallbacks.

Wind must share the selected location, coordinates, time dimension, and
native sample locations. There is no spatial or time interpolation. Geographic
rectilinear, curvilinear, and node/face mesh fields are supported; projected
vector rotation and native edge wind positions are not. Added Field component
reads contain at most 1,000 values each. Mesh anchors use sampled native nodes
or a representative triangle centre for each sampled face. Small faces can be
omitted at this display density. Calm and missing vectors have no Field arrow.

Wind uses the primary source for Curve and each pane's source for Field.
Model display offsets do not change the physical wind components. Wind off
makes no wind reads unless the selected curve is derived wind speed. Export
requires the selected wind data to be ready, or Wind to be off.

### Coastline Reference

For longitude/latitude fields, select **Map → Coastline** to draw solid coastline
lines without labels or shading. This uses public-domain [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/)
data from the version-pinned `nvkelso/natural-earth-vector` GitHub repository.
The browser downloads only the detail level needed for the view (110m, 50m, or
10m). These are map scales, not metre resolutions. The most detailed file is
about 10 MB and is not suitable for precise harbour boundaries.

Downloads and parsed geometry are shared across panes and cached for the page
lifetime. Downloads also use the browser HTTP cache. Pan, animation, and PNG
export reuse loaded data; zoom can request a different detail level. No download
starts while Map is set to none. If a download fails, the dataset remains usable.
Turn Map off and on to retry. Export requires the selected coastline to be ready,
or Map to be set to none.

### Exporting Figures

In **Save figure**, enclose LaTeX in `$...$` in the title, subtitle, and axis
labels. For example: `Wind speed ($m s^{-1}$)` or `$\theta$`. Text outside
these delimiters stays literal. Use `\$` for a literal dollar sign.

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
node tests/ui-smoke.mjs wind
NCX_FIXTURE=tests/data/wind_curvilinear.nc node tests/ui-smoke.mjs wind
NCX_FIXTURE=tests/data/wind_ugrid.nc node tests/ui-smoke.mjs wind
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

Web controls, identifiers, and values use **Commit Mono Web**, based on
[Commit Mono](https://commitmono.com/) by Eigil Nikolajsen. The local hinted
cuts use 450 for light-surface text, 600 for emphasis, and 400 for the dark
status strip. UI, literal data, and descriptive metadata have separate feature
settings. CM Math remains first for mathematical symbols. See
[res/README.md](res/README.md) for font files, licences, and build instructions.

The other UI text uses [Gorton Perfected](https://shifthappens.site/store/#fonts)
by Marcin Wichary when a licensed subset is present. National Park sets
structural labels. Existing plot lettering and non-web scientific plotting
styles are unchanged. Wichary describes the font's history in
[the hardest working font in Manhattan](https://aresluna.org/the-hardest-working-font-in-manhattan/).


