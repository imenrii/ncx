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

Steering frames use equal field cells and stacked curves. Field panels without
overlays omit the unused overlay reservation; ordinary viewer/comparison fields
retain their existing annotation strip. `PLOT_STYLE.panels` records the web gap
and print profile from `Style/plotstyle/grid.py` and `rc.py`: two tick-height
gutter units, the 8 pt journal tick size, and the canonical type ratios. Multi-panel
PNG capture reflows at the requested physical width, adds panel letters, and
restores the screen layout in a `finally` block. It captures native data at export
resolution through the existing renderer hooks.
