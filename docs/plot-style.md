# Browser plot style

The source of truth for ncx plotting is
[`web/src/plots/plotStyle.ts`](../web/src/plots/plotStyle.ts). It defines the
browser profile: fonts, responsive type roles, stroke weights, colours, series
order, legend spacing, and geometry parameters shared by drawing and layout.

Run `npm run style:sync` in `web/` after editing it. This writes
`web/src/generated/plot-style.css`. Both `npm test` and `npm run build` check
that this generated file is current. Do not edit it directly.

`style.css` owns selectors and application layout, not duplicate plot values.
`plotgeom.ts` owns geometry formulas. Pressure algorithms own pressure-system
detection, smoothing, and the rule that every drawn line must have a label.
Font sizes pass through a real CSS `font-size` property before geometry reads
them. Layout must not parse a custom property containing `clamp()`.

## Decision record

| Decision | Classification | Resolution |
| --- | --- | --- |
| Browser series palette differs from Python | Intentional, confirmed by the user | Preserve the seven colours and current order as the web profile. |
| Browser uses responsive rem/container sizes; Python uses print sizes | Intentional, documented in both style systems | Preserve separate medium profiles. |
| Plot lettering uses Hershey/CM Math, while controls use Commit Mono Web | Intentional, documented font roles | Keep the two font systems distinct. |
| Pressure lines are 1.8 px, with labels at 0.78 of tick size | Intentional, documented in the current implementation | Preserve the heavier isobar and smaller contour lettering. |
| Pressure legend was lighter than the isobars | Resolved by the user | Use the same canonical line weight as the plotted isobars. |
| README and smoke test still require 1.15 px | Stale contract | Read the canonical width in browser checks; document the policy rather than repeat the number. |
| Layout parses `clamp()` and silently falls back to 14/16 px | Malfunction, reproduced in Firefox | Resolve actual CSS font sizes before calculating geometry. |
| Centre values use the full tick size | Resolved by the user | Use the contour label scale for centre values and their spacing, masks, and collision boxes. Keep the independent H/L mark size. |
| Centre text changes size but masks and collision boxes are fixed | Malfunction | Derive one box from both text rows; use it for masking and collision avoidance. |
| Export repeats font declarations | Drift risk | Embed the active stylesheet's font-face rules, including coverage and weights. |
| Export repeats title colour and comparison borders | Drift risk | Use canonical title values and computed pane styles. |
| Time axes and field axes use separate renderers | Intentional behaviour difference | Keep time/numeric tick generation separate; both consume shared geometry and CSS. |
| Legend spacing matches Python | Intentional visual convention | Preserve the existing ratios in the explicit browser profile. |
| Continuous colormaps have generated copies | Already shared | Keep the existing colormap generator and source tables. |

## Ownership outside ncx

`Style/plotstyle/` remains authoritative for Python figures. Its design
principles are references for this browser profile; its physical print sizes
are not browser pixel sizes. There is no implicit cross-language override.

`Style/Fonts/Commit_Mono/build.py` remains authoritative for Commit Mono Web
cuts and shaping CSS. This change does not hand-edit those generated assets.
Plot font definitions are generated from `PLOT_FONTS`. The server's font routes
remain asset transport; export reads the same CSS declarations as the screen.

## Verification

- Generated CSS must match the style source.
- Layout tick lengths must follow the rendered font size at small and large
  frame sizes and when the browser's base font size changes.
- Centre masks and reserved boxes must grow with both rows of text.
- Pressure lines, labels, and export must use the same resolved presentation.
- Every retained contour must have a label; small loops have no exemption.
- Browser export checks must find the required font families, weights, and
  CM Math coverage in the embedded stylesheet.
