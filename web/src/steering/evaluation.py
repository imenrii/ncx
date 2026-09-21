"""Asynchronous read adapter for the pinned Dask task format."""
from collections import Counter, OrderedDict
import inspect
import math
import numpy as np
from dask._task_spec import convert_legacy_graph, DataNode
from dask.core import flatten
from dask.order import order
from dask.optimization import cull
from dask.sizeof import sizeof

_scalars = OrderedDict()


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
    priorities = order(graph)
    cache, sizes = {}, {}
    retained = 0
    # Fusion stays disabled: source tasks must finish their await before NumPy runs.
    for key in sorted(graph, key=priorities.get):
        result = graph[key](cache)
        result = await result if inspect.isawaitable(result) else result
        size = sizeof(result)
        if retained + size > limits["computeBytes"]:
            raise MemoryError("Computation buffers exceed the memory limit")
        cache[key], sizes[key] = result, size
        if isinstance(result, (np.ndarray, np.generic)) and result.ndim == 0 and result.dtype.kind in "biufc" and result.nbytes <= 1024:
            scalar = np.array(result, copy=True); scalar.flags.writeable = False
            _scalars[key] = scalar
            _scalars.move_to_end(key)
            while len(_scalars) > 64: _scalars.popitem(last=False)
        retained += size
        for dependency in graph[key].dependencies:
            references[dependency] -= 1
            if not references[dependency] and dependency not in requested:
                retained -= sizes.pop(dependency)
                del cache[dependency]

    def collect(key):
        return [collect(item) for item in key] if isinstance(key, list) else cache[key]

    finalize, arguments = array.__dask_postcompute__()
    return np.asarray(finalize(collect(keys), *arguments))
