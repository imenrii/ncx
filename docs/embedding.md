# Embedding contract

`web/src/data/sourceFeed.ts` owns the same-origin `window.ncx` API. Version 1
exposes `getState()` and `setSources()` plus the `secondaryCurve` capability.
The [README source API](../README.md#sources-and-embedded-api) defines the wire
shape, sample limits, revision rules, offsets, and secondary-panel behavior.

The host supplies dataset IDs from the running viewer or plain series. It does
not supply paths to the viewer API, inspect iframe DOM, or mutate ncx state.
ncx does not request provider data from the host. The host polls detached state
and submits one atomic, revision-bound source list. Stale input is rejected.
Provider-specific calculation and authentication belong to the host.

cuSURGE's `web/viewer.py` owns its loopback child process and streaming proxy.
Its browser integration owns tide/observation requests and derived secondary
series. ncx owns presentation, source styles, unit conversion, cursor, range,
and PNG capture. Primary and secondary panels share X interaction and retain
independent Y ranges. Steering does not take ownership of these paths.

The host must forward API headers and serve hashed worker assets through the
same viewer proxy. Its CSP permits same-origin workers and fetches. The
optional coastline fetch also requires
`connect-src https://raw.githubusercontent.com`; source URLs remain pinned by
ncx. No general remote-origin permission is needed.

After a shared interface change, rebuild ncx web assets, rebuild Rust, and run
cuSURGE's `tests/web/embedding-smoke.mjs` against that exact binary. See
[checks](checks.md) for the sibling checkout commands.

## Steering worker

Steering needs `worker-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'`
on the viewer response. It loads pinned Python/NumPy assets from the viewer's
own asset routes. General JavaScript `unsafe-eval` is not needed. The current
cuSURGE viewer policy must add the WebAssembly permission before Steering can
start. Its console policy and host calculations need no change. See
[Steering](steering.md) for the worker's authority and limits.
