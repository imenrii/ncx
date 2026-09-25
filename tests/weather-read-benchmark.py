"""Exact NetCDF access-plan benchmark; requires fixture-tool netCDF4 and numpy.
Run: python tests/weather-read-benchmark.py /tmp/weather-reads.json
Fresh handles drop the chunk cache, not OS cache. Timings exclude file open.
"""
import json
import os
import subprocess
import urllib.parse
import urllib.request
import sys
import tempfile
import time
from pathlib import Path
from statistics import median
import netCDF4
import numpy as np

SHAPE = (16, 512, 512)
LAYOUTS = {
    'classic': ('NETCDF3_64BIT_OFFSET', {}),
    'contiguous': ('NETCDF4', {'contiguous': True}),
    'frame_raw': ('NETCDF4', {'chunksizes': (1, 512, 512)}),
    'spatial_raw': ('NETCDF4', {'chunksizes': (1, 64, 64)}),
    'frame_zlib': ('NETCDF4', {'chunksizes': (1, 512, 512), 'zlib': True}),
    'spatial_zlib': ('NETCDF4', {'chunksizes': (1, 64, 64), 'zlib': True}),
    'temporal_zlib': ('NETCDF4', {'chunksizes': (8, 32, 32), 'zlib': True}),
}
CASES = {
    'frame': (7, slice(None), slice(None)),
    'stride2': (7, slice(None, None, 2), slice(None, None, 2)),
    'stride3': (7, slice(None, None, 3), slice(None, None, 3)),
    'stride4': (7, slice(None, None, 4), slice(None, None, 4)),
    'stride8': (7, slice(None, None, 8), slice(None, None, 8)),
    'roi64': (7, slice(128, 192), slice(128, 192)),
    'roi_misaligned': (7, slice(150, 214), slice(150, 214)),
    'point_series': (slice(None), 150, 150),
}

def touched_chunks(start, count, stride, chunk):
    return min(count, (start + (count - 1) * stride) // chunk - start // chunk + 1)

# Check the closed form against enumeration across aligned and sparse cases.
for start in range(12):
    for count in range(1, 12):
        for stride in range(1, 12):
            for chunk in range(1, 12):
                assert touched_chunks(start, count, stride, chunk) == len({
                    (start + j * stride) // chunk for j in range(count)
                })


def run(path, selection, method):
    bounds, gather = [], []
    for length, item in zip(SHAPE, selection):
        if isinstance(item, int):
            bounds.append(item)
        else:
            start, stop, step = item.indices(length)
            last = start + ((stop - start - 1) // step) * step
            bounds.append(slice(start, last + 1))
            gather.append(slice(None, None, step))
    with netCDF4.Dataset(path) as dataset:
        variable = dataset['field']
        variable.set_auto_maskandscale(False)
        variable.use_nc_get_vars(True)
        if dataset.data_model == 'NETCDF4':
            variable.set_var_chunk_cache(4 * 1024 * 1024, 1009, 0.75)
        start = time.perf_counter_ns()
        result = variable[selection] if method == 'direct' else np.ascontiguousarray(variable[tuple(bounds)][tuple(gather)])
        elapsed = (time.perf_counter_ns() - start) / 1e6
    return result, elapsed

def viewer_measurements(path, values):
    binary = os.environ.get('NCX_BINARY')
    if not binary:
        return None
    binaries = {'after': binary}
    if os.environ.get('NCX_BASELINE_BINARY'):
        binaries = {'before': os.environ['NCX_BASELINE_BINARY'], **binaries}
    processes, addresses, result = {}, {}, {name: {} for name in binaries}
    try:
        for name, executable in binaries.items():
            command = [executable, 'serve', '--port', '0', str(path)]
            if os.environ.get('NCX_BENCH_CPU'):
                command = ['taskset', '-c', os.environ['NCX_BENCH_CPU'], *command]
            process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True)
            processes[name] = process
            for line in process.stdout:
                if line.startswith('NCX_READY='):
                    addresses[name] = line.strip().split('=', 1)[1]
                    break
            else:
                raise RuntimeError('Viewer did not start')
        for case, selection in CASES.items():
            selectors, strides = [], []
            for length, item in zip(SHAPE, selection):
                if isinstance(item, int):
                    selectors.append(str(item))
                    strides.append('1')
                else:
                    start, stop, step = item.indices(length)
                    selectors.append(f'{start}:{stop}')
                    strides.append(str(step))
            for wire in ['f32', 'f64']:
                query = urllib.parse.urlencode({'path': '/field', 'selection': ','.join(selectors),
                                               'stride': ','.join(strides), 'wire': wire})
                expected = values[selection].astype('f8') * 0.01 + 1000.0
                expected[values[selection] == -32768] = np.nan
                expected = expected.astype('<f4' if wire == 'f32' else '<f8').ravel()
                for name in binaries:
                    result[name][f'{case}_{wire}'] = []
                for repeat in range(7):
                    for name in list(binaries)[::1 if repeat % 2 == 0 else -1]:
                        started = time.perf_counter_ns()
                        with urllib.request.urlopen(f'http://{addresses[name]}/api/data?{query}', timeout=30) as response:
                            body = response.read()
                            server_ms = float(response.headers['Server-Timing'].split('dur=')[1])
                        total_ms = (time.perf_counter_ns() - started) / 1e6
                        np.testing.assert_array_equal(np.frombuffer(body, dtype=expected.dtype), expected)
                        result[name][f'{case}_{wire}'].append({'server_ms': server_ms, 'total_ms': total_ms, 'bytes': len(body)})
        for name, process in processes.items():
            status = Path(f'/proc/{process.pid}/status').read_text()
            result[name]['peak_rss_kib'] = int(next(line for line in status.splitlines() if line.startswith('VmHWM:')).split()[1])
        return result
    finally:
        for process in processes.values():
            process.terminate()
            process.wait(timeout=10)


rows = []
cache_rows = []
viewer_rows = []
rng = np.random.default_rng(924)
t, y, x = np.indices(SHAPE, sparse=True)
smooth = np.broadcast_to(1000 * np.sin(x / 60) + 500 * np.cos(y / 80) + 10 * t, SHAPE).astype('i2')
noise = rng.integers(-1500, 1500, size=SHAPE, dtype='i2')
for values in [smooth, noise]:
    values[:, :64, :256] = -32768
with tempfile.TemporaryDirectory(prefix='ncx-weather-') as temp:
    for distribution, values in [('smooth', smooth), ('noisy', noise)]:
        for layout, (format_name, options) in LAYOUTS.items():
            path = Path(temp) / f'{distribution}-{layout}.nc'
            with netCDF4.Dataset(path, 'w', format=format_name) as dataset:
                for name, length in zip(['time', 'y', 'x'], SHAPE):
                    dataset.createDimension(name, length)
                variable = dataset.createVariable('field', 'i2', ('time', 'y', 'x'), fill_value=-32768, **options)
                variable.set_auto_maskandscale(False)
                variable[:] = values
                variable.scale_factor = 0.01
                variable.add_offset = 1000.0
            viewer = viewer_measurements(path, values)
            if viewer is not None:
                viewer_rows.append({'distribution': distribution, 'layout': layout, 'measurements': viewer})
            if layout.endswith('_zlib'):
                for cache_bytes in [1024 * 1024, 8 * 1024 * 1024]:
                    with netCDF4.Dataset(path) as dataset:
                        variable = dataset['field']
                        variable.set_auto_maskandscale(False)
                        variable.set_var_chunk_cache(cache_bytes, 1009, 0.75)
                        durations = []
                        for frame in list(range(8)) * 2:
                            start = time.perf_counter_ns()
                            result = variable[frame]
                            durations.append((time.perf_counter_ns() - start) / 1e6)
                            np.testing.assert_array_equal(result, values[frame])
                        cache_rows.append({'distribution': distribution, 'layout': layout,
                                           'cache_bytes': cache_bytes, 'frame_ms': durations})
            for case, selection in CASES.items():
                samples = {'direct': [], 'gather': []}
                expected = values[selection]
                for repeat in range(5):
                    for method in (['direct', 'gather'] if repeat % 2 == 0 else ['gather', 'direct']):
                        result, elapsed = run(path, selection, method)
                        np.testing.assert_array_equal(result, expected)
                        samples[method].append(elapsed)
                rows.append({'distribution': distribution, 'layout': layout, 'case': case,
                             'file_bytes': path.stat().st_size, 'output_bytes': expected.nbytes,
                             'ms': samples, 'median_ms': {key: median(times) for key, times in samples.items()}})
record = {'shape': SHAPE, 'dtype': 'packed int16', 'seed': 924,
          'netcdf4_python': netCDF4.__version__, 'netcdf_c': netCDF4.__netcdf4libversion__,
          'hdf5': netCDF4.__hdf5libversion__, 'numpy': np.__version__,
          'chunk_cache_bytes': 4 * 1024 * 1024, 'trials_per_plan': 5,
          'note': 'Library rows are OS-warm fresh-handle reads; viewer rows separately include HTTP and CF decoding',
          'viewer_cpu': os.environ.get('NCX_BENCH_CPU'), 'rows': rows, 'cache_sequences': cache_rows, 'viewer': viewer_rows}
Path(sys.argv[1]).write_text(json.dumps(record, indent=2) + '\n')
viewer_reads = sum(len(samples) for row in viewer_rows for version in row['measurements'].values()
                   for samples in version.values() if isinstance(samples, list))
print(f'PASS: {len(rows) * 10} access-plan reads, {len(cache_rows) * 16} cache reads, {viewer_reads} viewer reads, and chunk-count checks; results in {sys.argv[1]}')
