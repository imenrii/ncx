# Embedding contract

`web/src/data/sourceFeed.ts` owns the same-origin `window.ncx` API. Version 2
exposes `getState()`, `setSources()`, and `setOptions()` with the
`secondaryCurve` and `sourceOptions` capabilities. Version 2 only adds fields;
a version 1 host keeps working without source options.

The host supplies dataset IDs from the running viewer or plain series. It does
not supply paths to the viewer API, inspect iframe DOM, or mutate ncx state.
ncx sends no messages to the host. The host polls detached state and submits
one atomic, revision-bound source list. Stale input is rejected.
Provider-specific calculation and authentication belong to the host.

## Wire format and API

Same-origin hosts call `window.ncx = {version: 2, getState, setSources, setOptions}`.
The API is also present in standalone viewers, before React mounts. ncx sends
no messages or requests to the host. The host must poll; it must not inspect
the iframe DOM. Start even a single hosted dataset with `--dataset id=path`
to keep its dataset ID stable.

`getState()` returns a detached plain object:

```ts
{
  revision: string,
  selection: {
    dataset: string, path: string, view: string,
    location_id?: string, quantity?: string, units?: string,
    start_ms?: number, end_ms?: number
  } | null,
  sources: {
    id: string, label: string, color: string, dash: string, width: number,
    primary: boolean, locked: boolean
  }[],
  request: { revision: string, sources: string[] } | null,
  capabilities?: {
    secondaryCurve?: boolean,
    sourceOptions?: boolean
  }
}
```

`width` is the stroke width in CSS px; `dash` is an SVG dash array in px or
`none`. Both follow the reader's line style for that source.

The selection uses source metadata, including session unit selections, not
converted display units. Curve extents are the raw UTC union of participating
NetCDF extents, without supplied samples or display offsets. The extent is
absent until reads finish. A scientific selection, dataset identity, or raw
extent change changes the revision and immediately makes old inline data
unavailable. Style and offset changes do not change it.

`setSources({revision, sources, secondary?})` validates synchronously, then accepts
the whole list or throws `Error`. A stale revision is an error. Each source in `sources`
is exactly one of:

```ts
{ id: string, dataset: string, label?: string,
  attributes?: { locked?: boolean } }
{ id: string, series: {
    label: string, quantity: string, location_id: string,
    x_units: "milliseconds since 1970-01-01T00:00:00Z", x: number[],
    y_units: string, y: (number | null)[], vertical_datum?: string
  }, attributes?: { locked?: boolean } }
```

Dataset names must identify open datasets, not paths. IDs must be unique.
Arrays must have equal non-zero lengths, with at most 100,000 supplied samples
in total. Times must be ordered safe epoch-ms integers within the date range;
values must be finite float32-range numbers or null for missing values.
Unknown fields, including offset inputs, are rejected. Source order controls
palette and participation; the first dataset is primary. Default source IDs
are dataset IDs. The getter includes unavailable sources and reports ncx's
actual palette. Inline series use generic location, quantity, and unit matching;
a locked series has no provider-specific behavior.

`setOptions({options})` declares up to 64 sources the reader may add. Each is
`{id, label, dataset}` or `{id, label, kind: "series"}`; the dataset need not be
open yet. With options declared, ncx shows **Add**, a remove key on each tab,
and **Make primary**. These never change host sources. They write
`getState().request`: the option or source IDs the reader wants, in order. The
host reads it when it polls and answers with `setSources()`, which settles the
request. Until then a requested source shows as a dashed, waiting tab.

## Secondary curve panel

The source API exposes `capabilities.secondaryCurve = true`.
`setSources` accepts optional `secondary={label, sources, error?, difference?}`. Its
sources are ordinary supplied series with optional color/dash copied from existing
source styles; no calculation or provider policy enters ncx. Secondary input
is bound to the same selection revision and total sample limit as other input.
Omitting `secondary` clears it. An empty sources list may retain a labelled
loading/unavailable panel. The primary and secondary sources replace atomically.

The two curve panels share horizontal range, cursor time, drag selection, unit
changes, and presentation. They use the same renderer, typography, and aligned
margins. Secondary Y range is automatic and independent. An explicit `difference=true`
marks delta values for unit conversion and includes a zero reference. Ordinary
secondary series use ordinary unit conversion. Each panel requires matching
quantity, units, and location across its sources; signed ranges use linear scale. Primary display offsets never change
secondary samples. Both panels appear in Export PNG. `getState` remains metadata
only and reports the feature capability; ncx does not request data from its host.

## Source membership and options

Membership belongs to the host; the reader edits it in ncx. The host declares
what may be added with `setOptions()`. ncx's source tabs, Add sheet, remove
keys, and Make primary then write `getState().request` (option or source IDs,
in order) and nothing else. The host reads the request on its next poll, opens
or reopens datasets and fetches series as it needs, and answers with
`setSources()`, which settles the request. Use option IDs as source IDs, so a
request and the answer name the same sources.

cuSURGE's `web/viewer.py` owns its loopback child process and streaming proxy.
Its browser integration owns tide/observation requests and derived secondary
series. It declares every case output and both D2 series as options and
answers requests; it draws no source list of its own. ncx owns presentation,
source tabs, source styles, unit conversion, cursor, range, and PNG capture. Primary and secondary panels share X interaction and retain
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
