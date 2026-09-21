# Paired panel performance — 2026-09-21

This records the panel model with one data binding, separate Field/Curve views,
editable probes, and a global clock. [Raw trials](steering-panel-performance.json)
include resource sizes, process RSS samples, render measures, and the measured
asset version. The baseline is `b43a784`, before Steering.

Five alternating baseline/current release trials per fixture used fresh Firefox
profiles at 1440 × 900 on loopback. A second navigation measures warm loading.
Fixtures are a 32 × 256 × 256 pressure field and two 50,000-sample station curves.
The OS file cache was not cleared. Times include automation and frame waits.
No other browser checks ran during these trials.

## Ordinary viewing

Times are median milliseconds, followed by the observed minimum–maximum.

| Operation | Before Steering | Paired panels |
| --- | ---: | ---: |
| Field first display | 425 (361–479) | 406 (355–506) |
| Field warm navigation | 340 (225–406) | 342 (243–405) |
| Field frame change | 91 (62–102) | 72 (66–89) |
| Field unit change | 47 (45–62) | 45 (32–48) |
| Two curves, first display | 452 (420–458) | 470 (451–502) |
| Two curves, warm navigation | 344 (270–390) | 378 (330–452) |
| Curve resize | 75 (69–80) | 73 (54–80) |
| Prepared host anomaly display | 156 (148–203) | 171 (152–179) |

The ranges overlap. These samples do not establish a general speedup. Warm
curve navigation remains slower: 378 ms versus 344 ms, about 10%. First curve
display was 470 ms versus 452 ms. Startup still loads a larger application even
when the Python worker is closed; splitting that cost needs a separate profile.

Closed Steering fetched no Python worker/runtime. Unit conversion and curve
resize made zero extra data requests in every trial. An intermediate build
reloaded curves on each parent render because its load callback changed identity.
The callback now stays stable. The profile runner asserts zero resize reads.

## Terminal and additional panels

| Operation | Median ms (range) |
| --- | ---: |
| First Python startup, field | 4464 (4397–4562) |
| First Python startup, curves | 4489 (4413–4594) |
| Converted field to paint | 113 (105–147) |
| Coordinate matching | 67 (65–68) |
| Anomaly calculation and paint | 207 (201–241) |
| Repeat anomaly show | 68 (66–83) |
| Append same field to paint | 90 (86–93) |
| Append same curve, command completion | 83 (82–99) |

Initial anomaly evaluation made two data requests, totaling 800,000 decoded
bytes. Repeated anomaly show, appending the same curve, and appending the same
field each made zero data requests. Ten editor changes caused zero field-raster
rebuilds in every field trial. Python startup remains about 4.5 seconds.

Probe curves use a bounded cache by binding and resolved selection. Area curves
accumulate one line at a time. Panel admission reserves curve storage as well
as expression and geometry buffers. Static fields do not acquire a new read key
when global time changes. Renderer buffers are not the calculation inputs.

Browser process RSS sums were about 776 MiB (field) and 793 MiB (curves) with
Steering closed, compared with 768 and 778 MiB at baseline. After Python startup,
the medians were 1,084 and 1,032 MiB. Shared pages can be counted more than once;
these numbers are neither private heap measurements nor hard memory bounds.

The existing geometry check measured 111 ms for the 320 × 320 mesh and 127 ms
for a million-sample curve. Its buffer and path-size assertions passed. These
local checks do not establish remote-file, compressed-file, or GPU throughput.

## Functional and visual checks

- Python runtime: immutable arithmetic, lazy selection, memory admission,
  completion, panel identity, probe handles, and failed-command rollback.
- Browser panels: rectilinear, curvilinear, UGRID nodes and edge averages;
  missing exact timestamps; independent and editable probes; scalar/1D views;
  global pressure/wind; hub and restricted CSP.
- Clock: playback works with static appended fields. Moving time on Curve
  reuses the full probe series and updates its marker without another data read.
- Native viewer: rectilinear, curvilinear, UGRID, projected UGRID, station,
  comparison, wind, and unit-assignment checks passed.
- PNG: equal-geometry fields have equal print sizes; only eligible page views
  enter the export grid. Desktop, narrow, Curve, and exported layouts were
  inspected. Print layout changes restore the web layout after export.

Final Curve-clock readiness and global wind-component routing were checked
after the timed trials; those paths are not timed operations above. The raw record
identifies the measured application asset rather than assigning those timings
to a later binary hash.

## Reproduce

Use the fixture generator and baseline build from
[the original profile](steering-profile.md#reproduce), then:

```bash
NCX_PROFILE_RUNS=5 node tests/steering-profile.mjs \
  /tmp/ncx-steering-profile/baseline/ncx/target/release/ncx \
  target/release/ncx /tmp/ncx-steering-profile/fixtures /tmp/ncx-paired-profile
```

[Checks](../checks.md#steering) lists the runnable browser and runtime commands.

## Playback renderer retention

A later browser regression check found that each time change replaced the
appended field with a loading message while its exact sample index resolved.
This destroyed the canvas and its local renderer state before lazy numeric
reading began. The panel now keeps the renderer for the same binding and lets
the existing slice loader update it in place. A missing exact timestamp still
shows an unavailable view; a different binding cannot inherit the old frame.

The check failed before the fix because the original appended canvas was
removed. It now passes on rectilinear and UGRID playback. Both canvases remain
connected through playback, and the mesh geometry measure does not change.
This is a renderer-lifetime check, not a new latency benchmark. The timed
results above were not rerun for this fix.
