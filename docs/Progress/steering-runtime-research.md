# Steering runtime research

Status: research and recommendation. Revised 2026-09-17. No runtime is installed
or implemented. This revision adds source-backed reads to the runtime experiment.
Scope: execution environment only. The [comparison plan](comparison-plan.md)
owns the workflow. The [Steering interface](steering.md) owns variable references,
materialization, block reads, plot bindings, and publication rules.

## Recommendation

Use real Python and NumPy through Pyodide in a dedicated browser worker for a
first experiment. Load it only when Steering opens. Keep the Rust server as a
read-only NetCDF server. Use a small message contract around Pyodide; do not
adopt the JupyterLite application or create a Python-like expression language.

This is a design recommendation, not a measured result. Pyodide is CPython
compiled for WebAssembly, includes NumPy support, and exposes Python/JavaScript
interop. JupyterLite demonstrates browser-worker Python with static deployment.
These facts fit ncx's browser-side data operations without a server execution
endpoint. They do not establish that an arbitrary large-file calculation fits
browser memory. [Pyodide project](https://github.com/pyodide/pyodide/blob/main/README.md),
[JupyterLite project](https://github.com/jupyterlite/jupyterlite/blob/main/README.md).

## Existing approaches

| Approach | Existing contract | Implication for ncx |
| --- | --- | --- |
| Pyodide worker | Python executes away from the UI thread. Inputs and results cross a message boundary. | Explicit reads and publication can preserve data ownership. |
| JupyterLite | Browser kernels, notebook/console UI, storage, sessions, and extensions | Reuse the runtime pattern. The full application adds unrelated ownership and UI. |
| Local/server CPython kernel | A separate process receives code through an execution protocol. | Supports native Python packages but adds interpreter deployment, process lifetime, and authority over the host. |
| Custom expression evaluator | An ncx-owned syntax and operation set | Avoid it when users expect Python and NumPy. ncx would need to define and test a second language. |

Pyodide's worker example passes both code and a context dictionary to execution.
Its custom-namespace API supports explicit Python dictionaries. These are useful
building blocks for a namespace of references and explicit values; they do not
establish an immutable or secure namespace by themselves.
[Worker example](https://github.com/pyodide/pyodide/blob/main/docs/usage/webworker.md),
[namespace API](https://github.com/pyodide/pyodide/blob/main/docs/usage/faq.md).

JupyterLite's actual Pyodide kernel selects different worker communication paths
depending on cross-origin isolation. It also imports Jupyter services and content
management. This is evidence that the kernel has responsibilities ncx does not
need for a small Steering terminal.
[Kernel implementation](https://github.com/jupyterlite/pyodide-kernel/blob/main/packages/pyodide-kernel/src/kernel.ts).

Jupyter's kernel protocol supports execution, output, completion, interrupts, and
process connection details. Its server documentation treats kernel execution
authority as equivalent to arbitrary code execution. A local CPython child is
therefore a possible future advanced mode, not a transparent replacement for
read-only viewer access. HTTPS encrypts transport; it does not restrict Python's
host privileges.
[Kernel contract](https://github.com/jupyter/jupyter_client/blob/main/docs/kernels.rst),
[execution authority](https://jupyter-server.readthedocs.io/en/latest/operators/security.html).

## Packaging and offline use

Pyodide can be self-hosted. JupyterLite's Pyodide extension supports a local
distribution and local package wheels. For ncx, pin and serve the runtime,
NumPy, and required package assets from the same release as the viewer. A single
executable can embed those assets, but they increase its size. Lazy loading
reduces ordinary viewer startup work; it does not reduce the shipped executable.
A CDN-only setup does not meet offline use.
[Self-hosting](https://github.com/pyodide/pyodide/blob/main/README.md),
[local distribution configuration](https://github.com/jupyterlite/pyodide-kernel/blob/main/README.md).

Do not promise a download size, startup time, or memory cost yet. Measure the
pinned build with NumPy, cold and warm startup, standalone and cuSURGE iframe.
No such measurements were made for this research.

## Stop, memory, and authority

Pyodide's graceful interrupt mechanism requires a worker and a
`SharedArrayBuffer`. Shared memory requires a secure context and cross-origin
isolation. Plain remote HTTP cannot assume this capability, and HTTPS alone is
insufficient. The cuSURGE embedding must test the parent and iframe policies.
[Pyodide interrupts](https://github.com/pyodide/pyodide/blob/main/docs/usage/keyboard-interrupts.md),
[browser requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).

Use worker termination as the baseline Stop operation. It stops the worker
without waiting for Python cleanup and loses its namespace. A fresh worker can
receive the current source catalog on the next Run. Graceful interrupt can be an
enhancement where supported; some native calls still need signal checks to
respond. [Worker termination](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate),
[interrupt limitations](https://github.com/pyodide/pyodide/blob/main/docs/usage/keyboard-interrupts.md).

Proposed controller bounds are one active execution, no accumulating run queue,
bounded reads and staged results, bounded accepted output and console output, and a
main-thread timeout that terminates the worker. These bounds do not impose a
hard limit on arbitrary Python or NumPy temporary allocations. Upstream Pyodide
permits growth of its WebAssembly memory; the previously inspected build sets a
4 GB linear memory maximum. That historical build setting is neither an ncx
memory budget nor a limit on all browser allocations. Check the actual pinned
runtime during the experiment.
[Build settings](https://github.com/pyodide/pyodide/blob/6d84f35177193e96542d681db9de454f15e7adda/Makefile.envs#L166).

A worker is a UI-thread boundary, not a separate origin or a security boundary
for application authority. Pyodide exposes Web APIs, and its documentation
demonstrates `js.fetch` with same-origin credentials. Supplying only a small
Python API does not prevent Python from using that bridge. If execution must
have no access to host endpoints, use and test a separate origin or an isolated
browser context with an explicit message bridge and enforced network policy.
Do not claim that an import allowlist or a hidden JavaScript object provides
that isolation.
[Web API access](https://github.com/pyodide/pyodide/blob/main/README.md),
[fetch example](https://github.com/pyodide/pyodide/blob/main/docs/usage/faq.md).

## Runtime seam to test

Start the worker with a metadata-only catalog of admitted sources. A run receives
code, run ID, source epoch, logical selection capture, and plot revisions.
It does not receive all loaded plot buffers. A Python variable reference requests
an exact selection through an asynchronous message to the browser read adapter.
The adapter validates identity, admits bytes, and uses the current session-aware
NetCDF transport. A block iterator repeats this with one outstanding request.
Cancellation rejects its pending await and releases owned transfer buffers.

The existing Pyodide worker example uses `runPythonAsync` with a supplied
namespace. This supports an experiment with explicit awaited reads; it does not
provide ncx's read admission, block iterator, or publication rules. Those need
testing in the bridge. Pin a runtime release for the experiment instead of using
an unversioned CDN URL.
[Worker example](https://pyodide.org/en/stable/usage/webworker.html).

Do not implement implicit NumPy conversion for a source reference. NumPy's
`asarray` produces an ndarray and can require a copy; it is not a bounded remote
read protocol. `await ref.read()` or `async for block in ref.blocks()` makes I/O
explicit, then ordinary NumPy operates on resident `.values`. This is a design
choice that avoids an ncx operation whitelist or custom lazy array backend.
[NumPy asarray](https://numpy.org/doc/stable/reference/generated/numpy.asarray.html).

Return bounded console output, namespace summaries, and staged plot commands.
The browser validates and commits commands using the revision rules in
[steering.md](steering.md#execution-revisions-and-publication). Python must not
receive live React state, renderer buffers, file handles, provider credentials,
or a server execution interface through this bridge. The worker's wider Web API
authority still applies as described above. Accept only user-authored commands;
do not execute NetCDF attributes, URL text, or imported recipes automatically.

The browser owns publication. A Python exception, Stop, or stale revision
cannot commit half of a plot update. Namespace summaries come from supported
types without calling arbitrary `repr` or evaluating properties. Keep counts,
text, and update frequency bounded. Hiding the terminal preserves its namespace;
worker termination loses it. Published data has a separate browser lifetime.

## Copies and package scope

Pyodide exposes Python buffers through proxies and provides conversions between
JavaScript and Python. Its documentation describes typed-array copies into
WebAssembly memory and explicit release of buffer views and proxies. Thus a
transferable HTTP buffer does not establish a zero-copy NumPy pipeline.
[Type translations](https://pyodide.org/en/stable/usage/type-conversions.html).

Measure the full path: response buffer, worker transfer, Python array, NumPy
temporary, frozen publication copy, and browser render preparation. Release
interop proxies and buffer views promptly. Keep browser-owned source caches
isolated from Python writes, including code that changes NumPy write flags.
Validate dtype, shape, byte count, axes, and geometry before publication copies.

Start with NumPy and small data containers for values and their metadata. Do not
add xarray/Dask merely to label arrays, and do not claim the containers implement
their alignment or scheduling behavior. If transparent lazy scientific
operations become required, evaluate an established backend in the pinned
browser runtime as a separate choice. That choice must solve remote reads,
chunk semantics, package cost, and limits; the absence of a function whitelist
alone does not solve those requirements.

Start with explicit Enter-to-submit execution. Use Python's completeness check
for continuation input; highlighting is not a parser. Keep Stop while busy and
Reset workspace in terminal options. Do not automatically replay arbitrary code
after a source change: it can depend on intermediate session variables or
perform side effects. An optional live calculation should later be an explicit
function of a declared snapshot with replacement semantics, not a replay of
terminal history. This is a proposed execution policy, not a Pyodide limitation.

## Evidence still needed

Before choosing a production runtime, test the pinned runtime under local,
HTTP, and HTTPS deployment and the current cuSURGE iframe. Measure asset size,
first Run latency, metadata-only variable listing, input/output copies, and
worker restart. Test a small curve, a large field selection, a complete scan
with a scalar result, and bounded field publication. Include expensive mesh
geometry, six sources, compressed chunks, and SSH latency. Exercise a loop that
does not finish, retained scan blocks, allocation failure, excessive output,
stale reads/publication, and attempts to reach host endpoints. The performance
and memory acceptance contract is in [steering.md](steering.md); no such
measurements have been made in this revision.

If hard per-run memory limits are a requirement, the browser proposal has not
met it. A separate OS process can use platform resource controls, but those
controls and cross-platform behavior need their own deployment design.
[Python resource controls](https://docs.python.org/3/library/resource.html).
