# Viewer and rendering

## State owner

`web/src/app/viewerState.ts` owns selection invariants through named events.
Its state distinguishes an empty selection from a selected variable and a
stopped player from a playing player. `Viewer.tsx` owns browser integration,
controls, and event dispatch; callers do not merge partial variable state.

Dataset and variable events reset incompatible axes, indices, probe, range,
and playback together. Dimension events validate indices. Display events keep
axes distinct. Playback advances only after a ready frame, stops at endpoints,
and stops on read failure. A new variable cannot inherit another variable's
playback path.

Metadata capabilities supply initial axes and variable choice. Session storage
holds user selection, not a second copy of metadata semantics. Restore passes
through the same state validation as interactive selection.

The timeline controls the first remaining dimension. Toolbar index inputs
control the others only when they contain more than one sample.

## Plot boundary

The flow is `API → slice controller → prepared arrays → renderer`.
`data/useSlice.ts` owns latest-request loading. `plots/PlotStatus.tsx` shares
loading/error markup. Field views retain their geometry-specific preparation,
interactions, and export registration.

`plots/structured.ts` accepts a typed raster, bounds, palette, and destination.
`plots/webgl.ts` accepts prepared geometry and scalar values. These renderers
have no React, HTTP, or CF model dependency. `plots/mesh.ts` builds geometry and
hit indices. It does not fetch data. Plot captures return a PNG blob and the
sampling description used for that capture.

## Work and ownership

Mesh geometry uses two passes to allocate typed arrays once. The hit index is
a compressed list of triangle references. Oversized overlap falls back to a
bounded linear scan. Geometry above 32,768 input nodes runs in a disposable Web
Worker. Cached input arrays are copied; returned buffers transfer to the view.
Cancellation terminates the worker. Small geometry uses the same builder on
the calling thread. Worker URLs are hashed build assets embedded by Rust.

Curvilinear grids use indexed triangles and upload their scalar array directly.
UGRID scalar expansion and upload occur only when the geometry or source values
change. Pan, palette, and range changes reuse that buffer. Native edge scalars
retain the existing incident-edge mean; this is a derived face view, not a
native edge renderer. Means accumulate in f64 before float32 output.

Canvas fallback uses `plots/meshRaster.ts` to build a screen-pixel triangle map.
It keeps the existing flat triangle mean and missing-value mask, without
issuing a separate Canvas path for each triangle. Pixel-centre coverage replaces
path-edge antialiasing. The view owns the current map and image only.

Long ordered curves retain first/min/max/last samples per screen-pixel bin in
source order. NaNs preserve gaps. Small curves keep every sample. The ordered
path scales with pixels plus gaps; unordered X can revisit bins and retain more
points. Raw arrays, probes, statistics, and source extents remain unchanged.

Structured field preview uses nearest strided samples. It can miss a narrow
feature and does not claim peak preservation. Existing status shows strides.
PNG `ncx_sampling` text metadata records sampling for each exported plot,
including curve envelopes and derived edge means. Export recomputes curve
sampling at its output resolution. No extra user-facing explanation is added.
