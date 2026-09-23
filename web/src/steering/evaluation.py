"""Bounded asynchronous reads for the pinned Dask task format."""
from collections import Counter, OrderedDict
import asyncio
import inspect
import math
import numpy as np
import dask.array as da
from dask._task_spec import convert_legacy_graph, DataNode
from dask.core import flatten
from dask.order import order
from dask.optimization import cull
from dask.sizeof import sizeof

_scalars = OrderedDict()
_SCALAR_PREFIX = "ncx-scalar-"


def _identity(value):
    return value


def scalar_array(array, token):
    # Only this explicit expression/selection token can enter the scalar cache.
    return da.map_blocks(_identity, array, dtype=array.dtype, name=_SCALAR_PREFIX + token)


def checked_bytes(shape, width, maximum):
    if any(not isinstance(n, (int, np.integer)) or n < 0 for n in shape):
        raise ValueError("The result shape is unknown; materialize a bounded input first")
    size = math.prod(shape) * width
    if size > maximum:
        raise MemoryError("Selection exceeds the memory limit; select a smaller region or iterate blocks")
    return size


def chunk_shape(shape, width, maximum):
    remaining = max(1, maximum // width)
    chunks = [1] * len(shape)
    for axis in reversed(range(len(shape))):
        chunks[axis] = max(1, min(shape[axis], remaining))
        remaining = max(1, remaining // chunks[axis])
    return tuple(chunks)


async def compute(array, limits):
    checked_bytes(array.shape, array.dtype.itemsize, limits["readBytes"])
    keys = array.__dask_keys__()
    requested = set(flatten(keys))
    graph = array.__dask_graph__().cull(requested)
    if len(graph) > limits["graphTasks"]:
        raise MemoryError("The computation exceeds the task limit; use a smaller selection")
    graph = convert_legacy_graph(graph.to_dict())
    for key in graph.keys() & _scalars.keys():
        graph[key] = DataNode(key, _scalars[key])
        _scalars.move_to_end(key)
    graph, _ = cull(graph, list(requested))
    references = Counter(dep for node in graph.values() for dep in node.dependencies)
    priorities = sorted(graph, key=order(graph).get)
    cache, sizes, pending = {}, {}, {}
    retained = reserved = 0

    def store(key, result):
        nonlocal retained
        size = sizeof(result)
        if retained + reserved + size > limits["computeBytes"]:
            raise MemoryError("Computation buffers exceed the memory limit")
        cache[key], sizes[key] = result, size
        retained += size
        if (isinstance(key, tuple) and str(key[0]).startswith(_SCALAR_PREFIX)
                and isinstance(result, (np.ndarray, np.generic)) and result.ndim == 0
                and result.dtype.kind in "biufc" and result.nbytes <= 1024):
            scalar = np.array(result, copy=True)
            scalar.flags.writeable = False
            _scalars[key] = scalar
            _scalars.move_to_end(key)
            while len(_scalars) > 64: _scalars.popitem(last=False)

    def release_dependencies(key):
        nonlocal retained
        for dependency in graph[key].dependencies:
            references[dependency] -= 1
            if not references[dependency] and dependency not in requested:
                retained -= sizes.pop(dependency)
                del cache[dependency]

    # Source descriptors and resident chunks are synchronous DataNodes. Loading
    # these first lets independent source reads overlap without running NumPy ahead.
    for key in priorities:
        if isinstance(graph[key], DataNode): store(key, graph[key](cache))
    sources = [key for key in priorities if any(
        isinstance(graph[dep], DataNode) and getattr(graph[dep].value, "_ncx_source", False)
        for dep in graph[key].dependencies)]
    next_source = 0

    async def await_read(request):
        return await request

    def prefetch():
        nonlocal next_source, reserved
        while next_source < len(sources) and len(pending) < limits["concurrentReads"]:
            key = sources[next_source]
            request = graph[key](cache)
            # Reserve both the read result and the transient conversion before I/O.
            size = request.nbytes * 2
            if retained + reserved + size > limits["computeBytes"]: break
            reserved += size
            pending[key] = (asyncio.create_task(await_read(request)), size)
            next_source += 1

    try:
        # Fusion stays disabled: every source task must finish before NumPy uses it.
        for key in priorities:
            if isinstance(graph[key], DataNode): continue
            prefetch()
            if key in pending:
                task, reservation = pending.pop(key)
                result = await task
                reserved -= reservation
            else:
                result = graph[key](cache)
                if next_source < len(sources) and sources[next_source] == key: next_source += 1
                if inspect.isawaitable(result):
                    size = getattr(result, "nbytes", limits["blockBytes"]) * 2
                    if retained + reserved + size > limits["computeBytes"]:
                        raise MemoryError("Source reads exceed the computation memory limit")
                    result = await result
            store(key, result)
            release_dependencies(key)
            # Cancellation messages must be serviced between NumPy tasks as well as reads.
            await asyncio.sleep(0)

        def collect(key):
            return [collect(item) for item in key] if isinstance(key, list) else cache[key]

        finalize, arguments = array.__dask_postcompute__()
        return np.asarray(finalize(collect(keys), *arguments))
    finally:
        tasks = [task for task, _ in pending.values()]
        for task in tasks: task.cancel()
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)
