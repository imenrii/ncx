# Read lifecycle

## Admission and execution

`src/reading.rs` owns admission per viewer process: 32 active/waiting jobs,
4 blocking operations, and 256 MiB of estimated transient memory. Reservations
use 64 KiB pages. Saturated job admission returns 503 with `Retry-After: 1`.
An individual read above the memory budget returns 413. The ordinary response
limit remains 64 MiB unless the operator supplies a lower limit.

A data request obtains a job ticket and opening reservation, opens its catalog
entry, constructs a `ReadPlan`, reserves `peak_bytes`, and takes the dataset's
single read slot before entering blocking work. The NetCDF mutex still protects
the C handle. Memory reservations cover source and response buffers and remain
attached to response bytes until the HTTP body and its clones are dropped.
Metadata discovery has cardinality and retained-byte limits; JSON is written
through a size-capped writer.

Dense spatial previews can read a contiguous source rectangle and gather the
requested samples in place before decoding. `ReadSelection::contiguous_plane`
owns the eligibility and source-byte limits. Its full source allocation is
included in `ReadPlan.peak_bytes`. Sparse selections, curves, connectivity, and
multi-frame reads retain direct strided access. Both paths return the exact
requested shape and samples, with the same packing and missing-value rules.

Cancelled waiters release their tickets and permits. A blocking operation
checks whether its receiver still exists before it starts. An active NetCDF C
call cannot be interrupted. Dropped client work can therefore finish once it
has started, but it cannot create an unbounded blocking queue.

The browser's `LatestSliceLoader` keeps one current read and one latest desired
read. It replaces unsent intermediate frames. `useSlice` owns this lifecycle
for both field views. Export and static reads use the same backend admission;
there is no separate priority scheduler without an observed starvation case.

These are application allocation estimates, not an operating-system RSS cap.
NetCDF/HDF5 internal caches, native metadata temporaries, retained open handles,
and allocator overhead are outside `peak_bytes`. Hub child viewers each have
their own budget. Deployment memory limits must cover all allowed sessions.

## Browser cache

`web/src/data/cache.ts` owns an LRU of completed values, deduplicates pending
keys, evicts errors, and aborts pending work on scope disposal. There are at
most 32 pending entries per cache. Static slices retain at most 128 MiB and
128 entries. Metadata retains at most 64 entries and 16 MiB of estimated text
storage. A value larger than its cache budget is delivered without retention.

Retargeting a hub session clears the previous scope's caches and unit
assignments. Eviction drops only the cache's reference; an active plot can
retain its input. Cache limits do not claim to bound total browser heap.

Curve averages accumulate one slice at a time with f64 sums and integer
counts. They do not retain all input slices at once.

## Browser mesh geometry

To configure the build-time geometry limit, edit `MESH_GEOMETRY_LIMIT_MIB` at
the top of `web/src/plots/mesh.ts`. The value is in MiB (1,048,576 bytes).
Rebuild the frontend with `cd web && npm run build`, then run
`cargo build --release` from the repository root to embed it in the binary.
The limit applies per mesh to vertex and triangle-index arrays. It excludes the hit
index, source coordinates, scalar data, worker copies, and GPU buffers.

Curvilinear screen views select nearest native samples for the available plot
pixels, including device scale up to two. They retain this spatial sampling
when time changes; stopping playback does not force a full-grid mesh. Zoom and
resize can select a finer stride, including native detail when it fits the
existing full-resolution limit. Small features and extrema between samples can be
missed. Click probes identify a displayed native node; extracted curves still
read its native samples. PNG export uses the separate existing export request,
which reads the native plane within the full-resolution limit and otherwise
records its stride in `ncx_sampling`.

Each mesh view retains its current geometry, keyed by the accepted slice's
spatial selection and shape. It does not draw a new slice against mismatched
geometry. Curvilinear grids share vertices and upload one scalar per sampled
node; UGRID keeps its node/face/edge contracts. Canvas fallback retains a pixel
to triangle map and image buffer for its current geometry, bounds, and size.
Frame and colour changes repaint those pixels without rebuilding the map.
Pan, resize, or geometry replacement invalidates it; destruction releases it.

## Steering and published arrays

`data/arrayData.ts` defines the shared exact selection checks and the internal
resident-data reader registry. Published variables use private identities;
they are not new external sources. Their axes resolve through the same reader
as their scientific values. Releasing a publication removes its reader.

`fetchSlice` admits at most 128 MiB of in-flight browser response bytes. It
checks response shape against the request and copies a stream into a bounded
allocation, cancelling a body that exceeds its declared shape. These transient
reservations end after decode; cache and renderer ownership remain separate.

Steering's read, block, publication, and execution limits are in
`steering/model.ts`. It never turns a full scientific read into a strided preview.
See [Steering](steering.md) for the separate limits on ncx-owned storage and
unrestricted NumPy allocations.
