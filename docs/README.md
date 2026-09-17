# ncx module contracts

ncx opens NetCDF files read-only and renders their native samples. The
[README](../README.md) defines user behavior. These documents define ownership,
inputs, outputs, and failure rules for maintainers.

| Boundary | Contract |
| --- | --- |
| NetCDF → canonical metadata → browser | [Data contract](data-contract.md) |
| Request → read → response and cache | [Read lifecycle](reading.md) |
| User event → selection → plot | [Viewer and rendering](viewer.md) |
| Host application → ncx iframe | [Embedding](embedding.md) |
| Browser → hub → local or SSH viewer | [Hub policy](hub.md) |
| Style source → screen and export | [Plot style](plot-style.md) |
| Source change → executable gates | [Checks](checks.md) |

[Progress](Progress/) contains historical plans, research, and implementation
records. It does not override these contracts. Steering is deferred.
