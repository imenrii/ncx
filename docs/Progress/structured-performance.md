# Structured-field performance

Measured and accepted on 2026-09-22. The machine-readable
[results](structured-performance.json) contain all runs, timing entries,
request traces, geometry measurements, and executable SHA-256 values.

The input was `TY0000_forecast.nc` from the sibling cuSURGE LFZ_RUPGEN output:
301 frames of 1626 × 2036 float32 values, one complete frame per NetCDF chunk,
with full 2D float64 longitude and latitude. The coordinates are curved;
converting them to rectilinear axes would change the displayed geometry.

## Before and after

These are medians of three browser runs per renderer. Each run measures five
server requests per stride. Firefox 151.0.4 used a 1400 × 1000 viewport at device
scale one. Both binaries were release builds. Canvas was forced in headless
Firefox; WebGL ran under Xvfb. These are local, warm-read results, not remote
transfer estimates or hardware-GPU frame-rate claims.

| Measurement | Before | After | Improvement |
| --- | ---: | ---: | ---: |
| Canvas initial display | 18,555 ms | 1,072 ms | 17.3× |
| Canvas time change | 25,519 ms | 103 ms | 248× |
| WebGL initial display | 3,542 ms | 986 ms | 3.6× |
| WebGL time change | 3,623 ms | 48 ms | 75.5× |
| Scalar requests per time change | 3 | 1 | 67% fewer |
| Geometry attempts per time change | 4 | 0 | Removed |
| Stride-2 server request | 140.121 ms | 12.987 ms | 10.8× |
| Stride-3 server request | 67.516 ms | 8.138 ms | 8.3× |
| Stride-4 server request | 36.854 ms | 6.683 ms | 5.5× |

The server rows use the Canvas runs; the WebGL runs independently show the
same improvement. A server duration includes admission, NetCDF access,
decoding, and response construction. It excludes network-body transfer.
Geometry attempts include cancelled work. The browser runner waits for workers
and a stable rendered frame, so intermediate previews do not end measurement.
The timestamp is the final `data-rendered` marker. GPU submission measures do
not measure GPU completion.

## Acceptance decisions

1. **Stable spatial selection: accepted.** Curvilinear views no longer switch
   full → preview → full when time changes. Their accepted slice determines
   the geometry key. Time changes reuse geometry, and mismatched slices cannot
   draw against an old mesh. A zero-size initial layout makes no scalar read.

2. **Display-sized geometry: accepted.** The screen uses nearest native
   samples at a stride based on its dimensions and device scale. This test uses
   542 × 679 samples instead of 1626 × 2036. Time changes keep that sampling.
   The explicit export path still reads the full frame for this fixture.
   Screen sampling can omit small features and extrema. It does not alter
   stored values or exact scientific reads. Probe curves read native samples
   at the selected displayed node. Zoom increases sampling density, including
   native detail within the existing full-resolution limit. Larger grids still
   use bounded previews; spatial tiling is not implemented.

3. **Contiguous reads with in-place gathering: accepted.** Dense 2D previews
   use a bounded source rectangle. Source allocation is reserved before NetCDF
   access. Sparse, one-dimensional, multi-frame, and connectivity reads keep
   direct access. Tests compare both read paths byte for byte for f32/f64
   responses, with nonzero starts, unequal strides, packing, and missing data.

4. **Indexed curvilinear vertices: accepted for memory and upload savings.**
   On an isolated synthetic grid of the same dimensions, full geometry plus
   its hit index fell from 374,283,372 to 189,156,948 bytes (49.5% less).
   Scalar upload size fell from 79,365,000 to 13,242,144 bytes (83.3% less).
   Full-resolution construction did not improve: 2,754 → 2,934 ms. At stride
   three it was 337 → 332 ms. This change is retained for its measured storage
   and transfer reduction, not as a mesh-construction speedup. UGRID keeps its
   existing node/face/edge representation.

5. **Cached Canvas raster mapping: accepted.** The fallback maps screen pixel
   centres to triangles once per geometry/view/size, then repaints the current
   values. Time changes rebuild no pixel map. The existing flat triangle mean
   and missing-data mask remain; pixel-centre coverage replaces Canvas path
   edge antialiasing. The renderer retains one map and image, not past frames.

No new runtime dependency, frame cache, or worker pool was added. The existing
playback interval is unchanged. Native ncview was compared by implementation,
not through a timed GUI benchmark.

## Checks and reproduction

The [check commands](../checks.md#visual-and-performance-gates) describe both
runners. Save the pre-change release binary before rebuilding and collect its
JSON result with `NCX_BINARY`. Set `NCX_BASELINE` when running the candidate.
The runner rejects less than 20% improvement in initial display, time change,
or stride-2 reads. It also rejects extra scalar reads, geometry rebuilds, and
Canvas map rebuilds on a time change. Every measured candidate run passed.

Validation completed:

- Rust tests: 66 passed, one existing ignored test; format and Clippy passed.
- Frontend tests and TypeScript/Vite build passed.
- Existing geometry/curve performance gate passed with an 8 MiB mesh budget.
- Browser smoke passed for rectilinear, curvilinear, UGRID, projected UGRID,
  grouped UGRID, comparison, and UGRID/curvilinear wind.
- Large-file Canvas and WebGL screenshots were inspected.
- Large-file zoom refined to stride 1,1,1 on both renderers and reset correctly.
- Large-file PNG export passed on both renderers and requested stride 1,1,1.
  Export took 3.65 s on Canvas and 4.67 s on WebGL in the recorded runs.

The prior uncommitted viewer and steering changes were preserved. The final
release binary and embedded web assets were rebuilt from the combined tree.
