# Offline Steering runtime

Pyodide is pinned by `web/package-lock.json`. The build embeds its runtime,
stdlib, NumPy, YAML, and the pure-Python wheels listed in `packages.json` under
`dist/assets/python-<version>/`. All wheel SHA-256 hashes are checked at build.
NumPy/YAML hashes come from the pinned Pyodide lockfile. Other wheels were
obtained from PyPI and are pinned by filename and hash in `packages.json`.

Dask 2026.8.0 builds the chunk graph. `steering/evaluation.py` supplies an
asynchronous, single-task executor for that pinned task format. It does not
start Dask threads, processes, or a distributed scheduler. Runtime tests cover
this seam, including a reduction followed by a display selection.

Source: https://github.com/pyodide/pyodide and https://github.com/dask/dask.
Pyodide's MPL-2.0 licence is included. Each wheel contains its licence metadata.
Python initializes only when Steering opens. No runtime CDN access is needed.

The Rust build embeds WASM, JavaScript, CSS, and JSON as gzip when this reduces
their size. The server selects gzip from `Accept-Encoding` and sends
`Vary: Accept-Encoding`. Clients that do not accept gzip receive decompressed
bytes. Wheels and ZIP files remain unchanged. Frontend files in `dist/` remain
uncompressed for local tools and runtime tests.
