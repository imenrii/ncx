# Plot style contract

`web/src/plots/plotStyle.ts` owns browser plot fonts, sizes, strokes, colours,
series order, and shared layout ratios. `npm run style:sync` in `web/` generates
`web/src/generated/plot-style.css`. Tests and builds check freshness. Do not
edit generated CSS or duplicate plot values in another stylesheet.

`web/src/style.css` owns application layout, control states, and selectors.
Root tokens own common control sizes; coarse pointers raise the common `--hit`
target to 44 px. The persistent resizable sidebar, toolbar wrapping, Settings,
and secondary panel retain their current structure. UI and text are frozen
unless a demonstrated defect requires a change. No parallel specimen or token
system is part of this contract.

`plotgeom.ts` owns layout formulas. Geometry reads resolved CSS font sizes,
not `parseFloat` of a `clamp()` token. Text masks and collision boxes use those
same sizes. Pressure algorithms own contour smoothing and label placement;
every retained contour must have a label. Export reads the same plot profile
and active font-face rules as screen rendering.

Host comparison curves can share horizontal bounds, cursor time, and interaction.
Steering panels keep separate probe, range, and interaction state; all use the
global selected-time marker. Each curve has its own Y range and label. Minimum plot heights can cause vertical
scrolling in narrow layouts. Browser sizes and series colours intentionally
differ from Python print profiles in `Style/plotstyle/`.

The [archived style decisions](Progress/plot-style.md#decision-record) explain
existing visual choices. They are history, not a second set of style constants.
[Checks](checks.md) cover generated style, browser geometry, exports, and the
fixed-font visual baseline.

PNG export draws every figure at its final size from `plots/exportSettings.ts`.
Its Standard preset derives from `PLOT_STYLE` (print tick size and ratios, the
stroke ladder converted from CSS px to pt, `exportDpi`, `panels.aspect` and
`printGap`), so the print profile has one source. The export sets the plot's own
custom properties (`--plot-*-size`, `--plot-tick-length`, `--stroke-*`,
`--stroke-data-scale`, `--plot-face`) on the figure while it captures; tick marks
use `--stroke-tick`, and explicit data widths go through `dataStroke()`. Journal
presets carry only the values they set (Style/design.md § Figure widths). Maps fit
their height to the coordinate aspect; curve frames take the chosen ratio.

Pressure and wind follow one weight order: standard isobar > isobar > wind
glyph >> coastline (`PLOT_STYLE.pressure`, `wind`, `stroke.coast`). The standard
isobar is the drawn level nearest 1013.25 hPa. Wind glyphs are never removed:
contour labels are placed after the lattice and keep off the glyphs' sampled
ink. Glyph spacing follows the pane area, held between two and 2.4 barb lengths.
Contours are traced from a display-only smoothed copy of the pressure mesh
(sigma a fraction of the glyph spacing); the source values, extrema, and probes
are untouched. Small closed loops and short ends are dropped unless they hold a
centre, and an unlabelled closed loop is dropped on the same terms. A label
must sit on a straight run, name one line (no other isobar within its
clearance), and keep its spread from other labels; the line break follows the
label's own glyphs. The interval doubles while the median gap between
neighbouring isobars is below `minContourGap`.

Steering frames use equal field cells and stacked curves. Field panels without
overlays omit the unused overlay reservation; ordinary viewer/comparison fields
retain their existing annotation strip. `PLOT_STYLE.panels` records the web gap
and print profile from `Style/plotstyle/grid.py` and `rc.py`: two tick-height
gutter units, the 8 pt journal tick size, and the canonical type ratios. Multi-panel
PNG capture reflows at the requested physical width, adds panel letters, and
restores the screen layout in a `finally` block. It captures native data at export
resolution through the existing renderer hooks.
