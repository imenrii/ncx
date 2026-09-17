# Browser plot style

The source of truth for ncx plotting is
[`web/src/plots/plotStyle.ts`](../../web/src/plots/plotStyle.ts). It defines the
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
| Wind mark anchors | Corrected cell alignment | Screen bins select samples to limit density. Draw each selected glyph at its native coordinate, without snapping it to a bin centre. Refined below for regular grids and for stroke sharpness. |
| Screen bins reshuffle a regular grid on zoom and resize | Malfunction | Thin a rectilinear source in grid-index space: draw every nth grid point, chosen so the drawn spacing matches the lattice target. A grid point then keeps its place at every plot size. Curvilinear and mesh sources have no such regularity and keep the screen bins. |
| Drawn glyph anchors carry a half-pixel snap | Intentional, bounded | Round the anchor to the half-pixel grid before emitting the path. A 1 px stroke on a fractional coordinate spreads over two device columns and the lattice reads as blurred. Native coordinates hold to within 0.5 px. |
| Edge columns of a wind field were dropped | Malfunction | The sample plan ended before the last visible index and the screen lattice was centred inside the pane, so both ends kept an unequal gutter. Split the index slack between the two edges, and tile the lattice cells across the pane exactly. |
| Barbs scaled with lattice spacing | Malfunction | A barb is a symbol: keep the shaft length and feather pitch fixed in CSS pixels at every plot size, as on a station plot. Only the arrow style scales its length, and it scales with speed. |
| Barb feathers were always drawn on one side | Malfunction | Feathers sit on the low-pressure side of the shaft, so mirror them below the equator. |
| Wind yielded to isobar labels | Corrected priority | The wind lattice is the fixed scaffold and the label is the layer that can move: a label slides along its own line, a glyph cannot, and a hole in a regular lattice is more visible than the collision it avoids. Place labels around the drawn glyphs. |
| Absolute glyph avoidance removed whole contours | Malfunction | Every drawn line must carry its value, so a line that cannot be labelled is not drawn at all. The lattice is therefore a preference, not a veto: a label first looks for a slot clear of the glyphs, and takes its place among them when no such slot exists. Only the glyphs a placed label actually covers give way. |
| Glyph casing was translucent and drawn per glyph | Resolved by the user | Replace the painted casing with a transparent halo: 4 px of clearance that paints nothing and is carried in the glyph's collision box, so labels and centre marks stay off the ink. Painted casings were tested at 2.4 px and 4 px and rejected: opaque paper separates the glyph cleanly but erases the isobar at every crossing, a translucent casing reads as a grey fringe, a per-glyph casing veils its neighbour's ink, and a wide one turns the glyph white around a dark core. Keep the field glyph ink at or above 1.3 px, where a bare black stroke still holds the dark end of a colour map. |
| Field overlay settings | User-requested change | Default to wind barbs and a 2 mb base contour interval. Field renderers and PNG export share the selected settings; component choices are scoped to each dataset. |
| Curve readout is a rail above the frame | User-requested change | Keep a compact, type-relative row above the frame, with clearance for the readout and its optical gap. Remove the former multi-row barb space; field margins stay unchanged. Anchor the readout at the plot's left edge. Keep labels regular and every reading bold, including its unit and the wind bearing. Keep the plot face, because the rail is plot lettering and its digits vary by under 0.2 % of an em. |
| Curve barbs sit inside the frame | User-requested change | Draw the barb row below the plot top, clipped to the axis boundary, and reserve its space by extending the automatic Y range one labelled tick quantity. An automatic range never pads by a fraction of the data span. |
| Overlay label alignment | User-requested change | Share grid columns with the view controls and align legend text with Reset text. |
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


## Linked curve panels

Secondary curve panels use the existing curve renderer and equal frame widths.
Their shared time domain and data-space cursor align after resize and zoom.
Each panel keeps its own Y domain and exported Y label. A linked primary panel
uses the variable name and units on its Y axis; the full quantity remains in
the header so long station descriptions do not overlap a short plot frame.
The secondary header uses existing figure lettering and a thin divider. Frames
retain readable minimum heights and scroll vertically in narrow layouts.
