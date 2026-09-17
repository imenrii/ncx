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

Linked curve panels share horizontal frame bounds, cursor time, and interaction.
Each has its own Y range and label. Minimum plot heights can cause vertical
scrolling in narrow layouts. Browser sizes and series colours intentionally
differ from Python print profiles in `Style/plotstyle/`.

The [archived style decisions](Progress/plot-style.md#decision-record) explain
existing visual choices. They are history, not a second set of style constants.
[Checks](checks.md) cover generated style, browser geometry, exports, and the
fixed-font visual baseline.
