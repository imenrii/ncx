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

## Usage & Viewer Options

### URL Parameters

- **Clean Embeds**: Append `chrome=none` to the viewer URL to hide the header, status bar, dataset switcher, and source controls. The host owns source order; variable navigation stays available.
- **Embedded Mode**: Use `embedded=1` for clean iframe integrations.

### Sources and embedded API

Field and Curve share the same plot implementation for one or several datasets.
Curve supports eight sources, with at most six open datasets. Field supports
one through four panes. Unavailable sources keep their place and error; ncx
never promotes a secondary source silently. Cross-dataset selections require
compatible quantities, units, and explicit location or coordinate mappings.

Same-origin hosts call `window.ncx = {version: 1, getState, setSources}`.
The API is also present in standalone viewers, before React mounts. ncx sends
no messages or requests to the host. The host must poll; it must not inspect
the iframe DOM. Start even a single hosted dataset with `--dataset id=path`
to keep its dataset ID stable.

`getState()` returns a detached plain object:

```ts
{
  revision: string,
  selection: {
    dataset: string, path: string, view: string,
    location_id?: string, quantity?: string, units?: string,
    start_ms?: number, end_ms?: number
  } | null,
  sources: {
    id: string, label: string, color: string, dash: string,
    primary: boolean, locked: boolean
  }[]
}
```

The selection uses source metadata, including session unit selections, not
converted display units. Curve extents are the raw UTC
union of participating NetCDF extents, without supplied samples or display
offsets. The extent is absent until reads finish. A scientific selection,
dataset identity, or raw extent change changes the revision and immediately
makes old inline data unavailable. Style and offset changes do not change it.

`setSources({revision, sources})` validates synchronously, then accepts the
whole list or throws `Error`. A stale revision is an error. Each source is
exactly one of:

```ts
{ id: string, dataset: string, label?: string,
  attributes?: { locked?: boolean } }
{ id: string, series: {
    label: string, quantity: string, location_id: string,
    x_units: "milliseconds since 1970-01-01T00:00:00Z", x: number[],
    y_units: string, y: (number | null)[], vertical_datum?: string
  }, attributes?: { locked?: boolean } }
```

Dataset names must identify open datasets, not paths. IDs must be unique.
Arrays must have equal non-zero lengths, with at most 100,000 supplied samples
in total. Times must be ordered safe epoch-ms integers within the date range;
values must be finite float32-range numbers or null for missing values.
Unknown fields, including offset inputs, are rejected. Source order controls
palette and participation; the first dataset is primary. Default source IDs
are dataset IDs. The getter includes unavailable sources and reports ncx's
actual palette. Inline series use generic location, quantity, and unit matching;
a locked series has no provider-specific behavior.

One shared **Y offset** in the toolbar sets the absolute offset of every
unlocked series, including new sources. New locked sources start at zero.
Locking retains the current offset; unlocking adopts the toolbar value.
Updates with the same source ID keep offset state. Enter zero in Y offset to
clear offsets on unlocked sources. An edit that would overflow any loaded
unlocked curve is rejected before offset state changes. A variable, quantity,
or extraction change resets the unlocked offsets. Representation changes and
raw-extent arrival preserve compatible offsets. Display-unit changes convert
offset deltas; locked physical offsets survive them. There are no X offsets. Legends contain
only names and line swatches; axes, crosshairs, and export retain scientific
metadata. Scale, Range, Min, Max, Colour, and Map appear directly in the
toolbar alongside view, selection, units, Y offset, and Save PNG. Curve Wind is
a toolbar control; the field overlays have their own plot legend.
Controls wrap when needed; there is no Display menu. The Time control and its
zone-switching state are removed. The validated `display_zone` URL value fixes
the display zone for the viewer; without it, the viewer uses UTC.

The icon-only dataset-browser hamburger is in the topbar. When `chrome=none`
hides the topbar, the same hamburger is in the toolbar. There is no separate
text-labelled Variables button.

Standalone dataset navigation and source participation stay available.
`sessionStorage` keeps dataset/path/view by dataset ID and restores them before
defaults on reload. Storage failures use normal defaults. Rebuild the web assets
and then Rust after UI changes: Rust embeds `web/dist` at compile time.

### Display Units and Wind

Field and Curve have a **Unit** selector in the toolbar. Supported quantities include
pressure, wind, temperature, water-equivalent depth, height, fractions, wave
periods and directions, radiation, heat flux, and specific energy. The source
unit is the default. Conversions change the plot, labels, readouts, offsets,
and PNG output, not the file or source samples. Field colour ranges remain
independent. Unit changes do not read another data slice.

If a variable has no unit and its name matches a supported ECMWF quantity,
**Metadata → Units** assigns the default ECMWF source unit. For example, `msl`
uses Pa, `t2m` uses K, and `u10`/`v10` use m/s. Use the same control to override
or clear the assignment. Unknown names and conflicting CF quantities have no
automatic assignment. You can assign their source unit manually in the same control.
This labels the source numbers without rescaling them. Field and Curve initially use
this unit, replacing any previous display-unit choice. Use the toolbar
to convert the display: for example, assign Pa in Metadata, then select hPa in
the toolbar. The source-unit choice applies to detection, plot labels, conversion,
comparisons, and export. Selecting a unit for `u10` or `v10` also sets its missing-unit twin in
the same group. File-provided units remain unchanged. **Not specified** clears
both missing-unit twins. Manual choices stay with their dataset and variable while
the viewer is open; reload or viewer replacement restores ECMWF defaults. The file and
raw Attributes table never change. Source-unit changes clear range locks and
Y offsets, including locked offsets. A unit alone does not identify an unknown
quantity or enable Beaufort.

The appendable rules are in `web/src/data/units.ts`, with aliases from the
[ERA5 variable list](https://ecmwf-models.readthedocs.io/en/latest/variables_era5.html).
Default source units follow the [ECMWF ERA5 documentation](https://confluence.ecmwf.int/pages/viewpage.action?pageId=239340673).
A known name does not override file-provided units. Accumulations
are not converted to rates. Pressure vertical velocity is not wind speed.

Beaufort is available for recognized 10 m speed variables, not signed
components or gusts. It uses discrete force categories; it does not establish
a standard averaging period. Selecting Bft suppresses Y display offsets
without changing locked physical offsets and starts an automatic linear range.
Area probes use paired vector means before calculating wind speed and direction.

**Wind vector** in the field plot legend, or **Wind → On** in the Curve
toolbar, adds equal-length direction arrows to Field and a wind-barb row
to time curves. The annotation strip is always reserved in field and curve
layout, including when Wind is off or unavailable. Field arrows point toward
motion. Curve barbs use the Style convention: half/full/pennant increments of
2.5/5/25 m/s, or 5/10/50 knots when the curve unit is `kt`. Hover over the curve or focus a barb
for the shared tooltip with time, speed, and direction of origin. This tooltip
follows the data track. It shows one timestamp, then aligned variable and wind
rows with three decimal places. The increment key is in the curve header and
uses the barb colour. PNG output includes the marks and their unit key. No weather font is required.

Field arrow spacing is a screen distance, between 34 and 56 px, so a small pane
thins the arrows out instead of stacking them. Arrow length follows that
spacing. The field legend names the layer. Field exports contain direction
arrows without a speed key; Curve exports retain the barb increment key.

Unavailable Wind controls are grey. Hover over the control for the reason.
Wind component units in metadata, or selected in Metadata, take precedence.
If a component still has no unit,
the curve uses the selected velocity unit; a field uses the selected variable's
velocity unit. Incompatible units and Beaufort are not component-unit fallbacks.

Wind is independent of the selected scalar quantity and its `coordinates`
attribute. The wind components provide their own native coordinates and must
share dimensions with each other. Curve selections need valid native wind
sample indices. There is no spatial or time interpolation. Geographic
rectilinear, curvilinear, and node/face mesh fields are supported; projected
vector rotation and native edge wind positions are not. Added Field component
reads contain at most 1,000 values each. Mesh anchors use sampled native nodes
or a representative triangle centre for each sampled face. Small faces can be
omitted at this display density. Calm and missing vectors have no Field arrow.

Wind uses the primary source for Curve and each pane's source for Field.
Model display offsets do not change the physical wind components. Wind off
makes no additional wind reads. Export
requires the selected wind data to be ready, or Wind to be off.

### Playback

Playback buttons use the same raised style as the plot view controls. The
active control is pressed down. At the first frame, First sample and Play
backward are disabled, grey, and pressed down. At the last frame, Play forward
and Last sample have the same disabled state. Playback stops at either end;
it does not wrap around.

### Field Overlay Legend

The field plot carries its own overlay legend under the view controls, at the
top left of the plot. Comparison uses one legend on an available pane, even
when the primary pane is hidden. Two rows, `Pressure` and `Wind vector`, each show a black
mark in one 36 px column so both labels start on the same x. Click a row to
turn its layer on or off. An active row is black. An off row is grey with a
line through the text, so the state does not depend on colour. An
unavailable layer is disabled and carries its reason as a title. The legend has
no border and no plate; arrows and contour labels keep out of its corner.

### Plot style

[`web/src/plots/plotStyle.ts`](web/src/plots/plotStyle.ts) is the canonical browser
plot profile. It supplies generated CSS, layout, and export. See
[the style decision record](docs/plot-style.md) for intentional differences from
Python figures, corrected mismatches, and the update procedure.

### Field Pressure Contours

**Pressure** in the field plot legend draws isobars every **4 hPa** in the Met
Office manner: one uniform line weight at every level, with no level made
heavier than another. Visible lines are sampled at 3 px spacing. Two short averaging passes remove
small wiggles, with displacement limited to 2 px, then two corner-cutting
passes round the lines. A shared point budget increases that spacing for very dense plots;
smoothing does not turn off. Small eyes keep their native shape during
smoothing, and source values do not change. While the estimated visible gap between isobars is under
13 px the drawn interval doubles, 4 → 8 → 16 → 32 hPa, so a small pane shows
fewer lines instead of a solid block.

Every drawn contour line must have a label, repeated about every 260 px along
the visible line. Placement tries nearby positions when a label is blocked.
If no label fits, the entire visible line is omitted. This includes small
closed eyes and lines crowded by neighbouring labels or L/H marks. Disconnected
lines at the same pressure level each need their own label. A label sits in
a masked break in the line, not under a halo, and avoids the plot legend, other
labels, and the frame. Negative levels are dashed.

Pressure basins must have at least 2 hPa of prominence relative to their spill
saddle. Each basin retains its strongest native extremum; a flat extremum has
one stable anchor. A closed isobar at least 2 hPa outward from that value must
surround the centre. Detection uses all 4 hPa isobars, before display thinning
or smoothing. Vertices on a data boundary or missing-data edge cannot become
centres. Stronger prominence wins when marks would be within 64 px. Marks
show **L** or **H** and the native central value; lines are masked behind them.

Pressure contours sit below reference geometry and wind. Contour labels and
centre marks are placed first. Wind arrows that overlap these marks are omitted.
The remaining arrow positions, arrow spacing, and field colour range do not
change. Toggling contours does not read wind data again. The Field tooltip still has two lines only: the selected value and
unit, then coordinates such as `33°N · 114.75°E`. It includes no overlay readout.

The selected pressure field is used when applicable. If there is one pressure
field, other scalar views use it automatically. If there are several, use
**Pressure field** to choose one. Comparison panes use the same pressure quantity
from each dataset; surface pressure never replaces mean sea-level pressure.
Missing units use **Metadata → Units**. Contours use hPa regardless of source
units, Curve display units, or display offsets.

Rectilinear and curvilinear fields use one bounded grid read, with up to 20,000
native samples over the visible area and a boundary margin. Larger windows use
strided samples. Contours use linear interpolation on triangles between those
samples; small features below this display sampling can be missed. A missing
sample masks its grid cells. Constant fields produce no arbitrary outlines.

Node mesh values use native triangles. Face values remain at area-weighted face
centres; contours use closed, convex face-centre rings around interior nodes.
Open boundary rings and rings with missing values are not extrapolated. Face
values are not converted to node values. Mesh contours are limited to 20,000
nodes/faces and 40,000 triangles. Projected and edge pressure contours are not
supported. A 50,000-segment limit bounds contour complexity.

Calculations remain in the browser and use the existing read-only API. Off
makes no pressure reads. Export includes the same contours, labels, and centre
marks, and requires each enabled layer to be ready or turned off. No gradient
arrows or pressure-gradient calculations are used.

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

PNG export retains the active X viewport, samples, offsets, and scientific axis
labels. One curve has no legend. Several curves use a compact, names-only,
unframed legend with line swatches and wrapped rows inside the plot headroom.
Export extends the displayed Y limit to keep the legend clear of data; it does
not change the live viewport or toolbar range. Legend spacing follows Style:
1.6 em handles, 0.5 em handle-to-text gaps, 1.2 em column gaps, 0.35 em row
gaps, 0.3 em axes padding, and 0.2 em internal padding.
Probe markers remain interactive in the UI and are excluded from exported
figures. Ensure hosting policies allow blob image rendering for composition.

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
NCX_ASSIGN_UNITS=1 node tests/ui-smoke.mjs wind
NCX_PRESSURE=1 node tests/ui-smoke.mjs wind
NCX_PRESSURE=1 NCX_FIXTURE=tests/data/pressure_faces.nc node tests/ui-smoke.mjs wind
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


