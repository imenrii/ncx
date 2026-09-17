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
