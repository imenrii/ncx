# Steering refactor measurements — 2026-09-22

Two comparisons used five alternating release trials per fixture, fresh Firefox
profiles at 1440 × 900, loopback HTTP, and the same input files. No other browser
checks ran during profiling. The OS file cache was not cleared. These are
workstation measurements, including automation and frame waits.

- **Pre-Steering:** `b43a784`, retained from the earlier benchmark.
- **Before refactor:** the release binary saved before editing the `6cb928e`
  checkout. This version already has Steering, paired panels, and probe copying.
- **Current:** the refactored release. Binary/application hashes and all 40 trials
  are in [the JSON record](steering-refactor-performance.json).

Fixtures are a 32 × 256 × 256 pressure field and two 50,000-sample station curves.
The new mean case reads the entire field. The rebuilt-anomaly case evaluates the
same expression again through a new Python object, rather than showing the same
saved object.

## Before and after the refactor

Times are median milliseconds, followed by minimum–maximum.

| Operation | Before | Refactored |
| --- | ---: | ---: |
| Field first display | 405 (361–467) | 383 (369–493) |
| Field warm navigation | 228 (209–374) | 240 (215–260) |
| Field frame change | 82 (70–105) | 78 (61–93) |
| Python startup, field | 4546 (4420–4695) | 4601 (4427–4872) |
| Full-data mean | 233 (191–244) | 154 (133–169) |
| Rebuilt mean, cached scalar | 66 (48–67) | 66 (49–68) |
| Anomaly calculation and paint | 223 (190–242) | 220 (189–239) |
| Show the same saved anomaly | 66 (50–68) | 65 (50–67) |
| Rebuild and show the same anomaly expression | 134 (116–150) | 50 (49–57) |
| Append the same curve | 100 (83–117) | 100 (84–116) |
| Python startup, curves | 4851 (4711–4888) | 4634 (4530–5010) |

The full mean improved from 233 to 154 ms (about 34%). Both versions made four
requests and transferred 16,777,216 data bytes. The change overlaps reads; it
does not reduce the scientific domain or sample count. NetCDF access remains
serialized per open dataset in Rust.

Rebuilding the anomaly improved from 134 to 50 ms (about 63%). Before the
refactor, every trial issued two reads totaling 800,000 bytes. After the refactor,
every trial issued zero reads. This exercises content identity: the two Python
expression objects are distinct but their immutable contents match.

Both versions reused the mean's scalar result without another data read. The
new cache uses explicit expression/selection keys, with no reliance on Dask's
pickle-tokenization of source metadata. A regression test makes source
pickle-tokenization fail and verifies that source calculations still succeed.

Python startup remains roughly 4.5–5 seconds. The field startup median rose
slightly in the before/after set; the curve startup median fell. The ranges
include machine and process-startup variation. These measurements do not prove
a general startup improvement.

## Ordinary viewing against pre-Steering

| Operation | Pre-Steering | Refactored |
| --- | ---: | ---: |
| Field first display | 458 (361–497) | 383 (374–422) |
| Field warm navigation | 247 (209–423) | 258 (227–290) |
| Field frame change | 83 (77–98) | 73 (58–82) |
| Field unit change | 43 (28–47) | 46 (31–49) |
| Two curves, first display | 442 (418–476) | 459 (412–512) |
| Two curves, warm navigation | 329 (311–413) | 350 (306–395) |
| Curve resize | 68 (63–80) | 69 (61–80) |
| Prepared host anomaly display | 167 (161–231) | 210 (160–230) |

Warm curve navigation is still slower than pre-Steering: 350 versus 329 ms
(about 6%). First curve display is 459 versus 442 ms. Do not infer zero overhead
from faster field samples or overlapping ranges. The ordinary viewer still
fetches no Python runtime with Steering closed. Unit changes and curve resizing
issue zero extra data requests. Ten editor changes cause zero field-raster
rebuilds in every trial.

## Bounds and lifecycle checks

The Python transport test adds 10 ms to each source read. Four concurrent reads
complete the same calculation in about 147–156 ms, compared with 521–529 ms
for one read. It asserts both the concurrency ceiling and equal numerical
results. This isolates round-trip overlap; it is not a remote-file benchmark.
Read buffers are reserved before requests start. An insufficient budget fails
without issuing a read. Cancellation leaves no live read tasks and the workspace
can compute again afterward.

Direct session tests exercise the actual submit/worker-message path:

- A failed batch preserves existing panels and registers no temporary datasets.
- Budget rejection retains the current renderer binding.
- A scientific edit rejects an in-flight publication.
- Twenty editor changes reuse the snapshot and do not remeasure old log objects.
- Evaluation timeout requests task cancellation; an acknowledged worker remains
  alive with its published data.
- Fixed selectors remain separate from panel-owned probe indices.

Expression depth is checked before another metadata operation. Detached result
arrays cannot corrupt resident values or cached scalars. Source generations
have different identities. Read-only completion cannot discard pending updates.
A Firefox test also delays a real source read, shortens the evaluation timer,
and verifies that cancellation preserves a console variable. It then resets
Python and verifies that accepted expressions still render.
The native/browser checks cover rectilinear, curvilinear, node/edge UGRID,
projected UGRID, station, comparison, wind, unit assignment, CSP, and hub paths.

Process RSS samples are included in the raw record. Summing browser-process RSS
can count shared pages repeatedly; it does not measure a hard private-heap cap.
Retained pickle payloads can duplicate resident values across Python and the
browser. The refactor does not claim zero-copy publication or isolation from
arbitrary NumPy allocations. Synchronous NumPy that cannot acknowledge a cancel
message still requires worker termination after the grace period.

## Reproduce

After the frontend and release builds, use the fixtures from the
[original profile](steering-profile.md#reproduce):

```bash
NCX_PROFILE_RUNS=5 node tests/steering-profile.mjs \
  /tmp/ncx-steering-profile/baseline/ncx/target/release/ncx \
  target/release/ncx /tmp/ncx-steering-profile/fixtures /tmp/ncx-pre-steering

NCX_PROFILE_RUNS=5 NCX_PROFILE_BASELINE_STEERING=1 \
  node tests/steering-profile.mjs /path/to/saved-pre-refactor-ncx \
  target/release/ncx /tmp/ncx-steering-profile/fixtures /tmp/ncx-before-after
```

The profile now checks that rebuilding an equivalent expression makes no new
data requests. [Steering](../steering.md) documents the canonical commands and
removed aliases; [checks](../checks.md#steering) lists the runnable test gates.
