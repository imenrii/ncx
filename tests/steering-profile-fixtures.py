"""Generate deterministic, uncompressed NetCDF files for steering-profile.mjs."""

import sys
from pathlib import Path

import netCDF4
import numpy as np

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
with netCDF4.Dataset(root / "field.nc", "w", format="NETCDF3_64BIT_OFFSET") as ds:
    for name, size in [("time", 32), ("lat", 256), ("lon", 256)]:
        ds.createDimension(name, size)
    field = ds.createVariable("msl", "f4", ("time", "lat", "lon"))
    field.units = "Pa"
    field.standard_name = "air_pressure_at_mean_sea_level"
    field.coordinates = "lat lon"
    time = ds.createVariable("time", "f8", ("time",))
    time.units = "hours since 2025-01-01 00:00:00"
    time.standard_name = "time"
    time[:] = np.arange(32)
    for name, unit, values in [("lat", "degrees_north", np.linspace(20, 25, 256)),
                                ("lon", "degrees_east", np.linspace(110, 115, 256))]:
        coord = ds.createVariable(name, "f8", (name,))
        coord.units = unit
        coord.standard_name = "latitude" if name == "lat" else "longitude"
        coord[:] = values
    spatial = np.sin(np.arange(256)[:, None] / 20) + np.cos(np.arange(256)[None, :] / 30)
    for i in range(32):
        field[i] = 100_000 + spatial * 100 + i * 10

for name in ["normal", "tide"]:
    with netCDF4.Dataset(root / f"{name}.nc", "w", format="NETCDF3_64BIT_OFFSET") as ds:
        ds.createDimension("time", 50_000)
        level = ds.createVariable("TPK", "f4", ("time",))
        level.units = "m"
        level.standard_name = "sea_surface_height_above_mean_sea_level"
        level.station_id = "TPK"
        level.vertical_datum = "MSL"
        time = ds.createVariable("time", "f8", ("time",))
        time.units = "seconds since 2025-01-01 00:00:00"
        time.standard_name = "time"
        time[:] = np.arange(50_000) * 30
        samples = np.arange(50_000)
        values = np.sin(samples / 1440)
        if name == "normal":
            values += 0.3 * np.cos(samples / 2000)
        values[12_345] = np.nan
        level[:] = values
