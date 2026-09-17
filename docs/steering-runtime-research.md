# Steering runtime research

Status: research and recommendation. No runtime is installed or implemented.
Scope: execution environment only. The [comparison plan](comparison-plan.md)
owns the workflow. The [Steering interface](steering.md) owns source/view
access, panel publication, and override rules.

## Recommendation

Use real Python and NumPy through Pyodide in a dedicated browser worker for a
first experiment. Load it only when Steering opens. Keep the Rust server as a
read-only NetCDF server. Use a small message contract around Pyodide; do not
adopt the JupyterLite application or create a Python-like expression language.

This is a design recommendation, not a measured result. Pyodide is CPython
compiled for WebAssembly, includes NumPy support, and exposes Python/JavaScript
interop. JupyterLite demonstrates browser-worker Python with static deployment.
These facts fit ncx's browser-side data operations without a server execution
endpoint. [Pyodide project](https://github.com/pyodide/pyodide/blob/main/README.md),
[JupyterLite project](https://github.com/jupyterlite/jupyterlite/blob/main/README.md).

## Existing approaches

| Approach | Existing contract | Implication for ncx |
| --- | --- | --- |
| Pyodide worker | Python executes away from the UI thread. Inputs and results cross a message boundary. | A narrow run/snapshot/result contract can preserve renderer ownership. |
| JupyterLite | Browser kernels, notebook/console UI, storage, sessions, and extensions | Reuse the runtime pattern. The full application adds unrelated ownership and UI. |
| Local/server CPython kernel | A separate process receives code through an execution protocol. | Supports native Python packages but adds interpreter deployment, process lifetime, and authority over the host. |
| Custom expression evaluator | An ncx-owned syntax and operation set | Avoid it when users expect Python and NumPy. ncx would need to define and test a second language. |

Pyodide's worker example passes both code and a context dictionary to execution.
Its custom-namespace API supports explicit Python dictionaries. These are useful
building blocks for a snapshot of the current view; they do not establish an
immutable or secure namespace by themselves.
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
receive the latest view snapshot on the next Run. Graceful interrupt can be an
enhancement where supported; some native calls still need signal checks to
respond. [Worker termination](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate),
[interrupt limitations](https://github.com/pyodide/pyodide/blob/main/docs/usage/keyboard-interrupts.md).

Proposed controller bounds are one active execution, no accumulating run queue,
bounded input snapshots, bounded accepted output, bounded console output, and a
main-thread timeout that terminates the worker. These bounds do not impose a
hard limit on arbitrary Python or NumPy temporary allocations. Upstream Pyodide
permits growth of its WebAssembly memory; the inspected build sets a 4 GB linear
memory maximum. This is neither an ncx memory budget nor a limit on all browser
allocations. [Build settings](https://github.com/pyodide/pyodide/blob/6d84f35177193e96542d681db9de454f15e7adda/Makefile.envs#L166).

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

## Narrow ncx boundary to test

The proposed runtime receives a run ID, view revision, code, and copies of
prepared arrays with their axis metadata. It returns console text and a staged
display result. The application validates the result and commits it only if
the run and view revision still match. Python must not receive live React state,
renderer buffers, file handles, provider credentials, or a server execution API.
Only sources already admitted through Add enter the snapshot.

The controller owns publication. A Python exception, Stop, or a superseded
revision cannot commit half of a panel update. Closing the terminal need not
close a successfully published panel. Reset and source-removal behavior belong
to the comparison plan, not to Pyodide globals.

Start with explicit Run. Do not automatically replay arbitrary previous code
after a source change: it can depend on intermediate session variables or
perform side effects. An optional live calculation should later be an explicit
function of a declared snapshot with replacement semantics, not a replay of
terminal history. This is a proposed execution policy, not a Pyodide limitation.

## Evidence still needed

Before choosing a production runtime, test the pinned runtime under local,
HTTP, and HTTPS deployment and the current cuSURGE iframe. Measure asset size,
first Run latency, representative curve operations, input/output copies, and
worker restart. Exercise a loop that does not finish, allocation failure,
excessive output, stale completion, and attempts to reach host endpoints.

If hard per-run memory limits are a requirement, the browser proposal has not
met it. A separate OS process can use platform resource controls, but those
controls and cross-platform behavior need their own deployment design.
[Python resource controls](https://docs.python.org/3/library/resource.html).
