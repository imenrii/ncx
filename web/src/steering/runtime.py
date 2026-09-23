"""Scientific variables and display handles for the Steering console."""
import ast
import codeop
import itertools
import hashlib
import sys
import uuid
import json
import linecache
import math
from copy import deepcopy
from functools import partial
import types
from weakref import WeakValueDictionary
import numpy as np
import dask
import dask.array as da
import cloudpickle
from pyodide.code import eval_code_async
from js import ncx_read, ncx_limits, ncx_units
import js
from ncx_evaluation import checked_bytes, chunk_shape, compute as evaluate_array, scalar_array

_LIMITS = json.loads(ncx_limits)
_UNITS = json.loads(ncx_units)
_compiler = codeop.CommandCompiler()
_compiler.compiler.flags |= ast.PyCF_ALLOW_TOP_LEVEL_AWAIT


def _text(value, label):
    if not isinstance(value, str) or len(value) > 512:
        raise ValueError(f"Invalid {label}")
    return value


def _unit(text):
    key = " ".join(text.lower().split())
    for family, units in _UNITS.items():
        for unit in units:
            if key in (" ".join(alias.lower().split()) for alias in [unit["label"], *unit["aliases"]]):
                return ("length" if family == "water" else family), unit
    return text, dict(scale=1, offset=0)


def _no_eager_compute(*args, **kwargs):
    raise TypeError("This function requires eager arrays; compute a bounded input explicitly")


def _slice_size(start, stop, step):
    # Logical extents can exceed the WASM interpreter's 32-bit sequence length.
    return max(0, (stop - start + step - 1) // step)


def _output(function, method, path, *args, **kwargs):
    result = getattr(function, method)(*args, **kwargs) if method else function(*args, **kwargs)
    for index in path: result = result[index]
    return result


def _token(value):
    """Hash value semantics, never object addresses or Dask's graph-key spelling."""
    digest = hashlib.sha256()
    def add(item):
        if isinstance(item, Variable):
            add(("variable", item.token))
        elif isinstance(item, _Reference):
            add(("source", item.scope, item._descriptor()))
        elif type(item) is np.ndarray:
            add(("array", item.dtype.str, item.dtype.descr, item.shape))
            digest.update(memoryview(np.ascontiguousarray(item)).cast("B"))
        elif isinstance(item, np.generic):
            add(("scalar", item.dtype.str, item.tobytes()))
        elif isinstance(item, partial):
            add(("partial", item.func, item.args, item.keywords))
        elif isinstance(item, slice):
            add(("slice", item.start, item.stop, item.step))
        elif isinstance(item, dict):
            add(("dict", tuple(sorted(item.items(), key=lambda pair: str(pair[0])))))
        elif isinstance(item, (tuple, list)):
            digest.update(type(item).__name__.encode() + len(item).to_bytes(8, "big"))
            for child in item: add(child)
        elif type(item) in (str, bytes, int, float, complex, bool) or item is None:
            data = item if isinstance(item, bytes) else repr(item).encode()
            digest.update(type(item).__name__.encode() + len(data).to_bytes(8, "big") + data)
        elif isinstance(item, np.dtype):
            add(("dtype", item.str))
        elif item is Ellipsis:
            add(("ellipsis",))
        else:
            module = getattr(item, "__module__", "numpy" if isinstance(item, np.ufunc) else "")
            name = getattr(item, "__qualname__", getattr(item, "__name__", ""))
            owner = sys.modules.get(module)
            for part in name.split("."):
                owner = getattr(owner, part, None)
            if owner is item and (module.startswith("numpy") or module == __name__ or module == "builtins"):
                add(("symbol", module, name))
            else:
                # Opaque callbacks are valid inputs, but are not assumed pure or content-equivalent.
                add(("opaque", uuid.uuid4().hex))
    add(value)
    return digest.hexdigest()


def _children(value):
    if isinstance(value, Variable):
        yield value
    elif isinstance(value, (tuple, list)):
        for child in value: yield from _children(child)
    elif isinstance(value, dict):
        for child in value.values(): yield from _children(child)


def _admit_expression(node):
    children = tuple({child.token: child for child in _children(node)}.values())
    depth = 1 + max((child.depth for child in children), default=0)
    nodes = 1 + sum(child.nodes for child in children)
    if depth > _LIMITS["expressionDepth"] or nodes > _LIMITS["expressionNodes"]:
        raise MemoryError("Expression exceeds the complexity limit; materialize a bounded intermediate")
    return depth, nodes


class _Reference:
    def __setattr__(self, name, value):
        if name in self.__dict__:
            raise AttributeError("Variable references are immutable; use isel to make a selection")
        object.__setattr__(self, name, value)

    def __init__(self, source, path, selection=None, wire="f64"):
        self.source = source
        self.path = path
        self._meta = WORKSPACE.sources[source][path]
        self.scope = WORKSPACE.scope
        self._selection = selection or [dict(start=0, stop=d["length"], stride=1) for d in self._meta["dimensions"]]
        self.wire = wire
        self.unit = next((a["value"] for a in self._meta["attributes"] if a["name"] == "units"), "")
        self.name = self._meta["name"]

    @property
    def dims(self):
        return tuple(d["path"] for d, s in zip(self._meta["dimensions"], self._selection) if isinstance(s, dict))

    @property
    def shape(self):
        return tuple(_slice_size(s["start"], s["stop"], s["stride"]) for s in self._selection if isinstance(s, dict))

    def __repr__(self):
        return f"VariableRef {self.source}[{self.path!r}] shape={self.shape} unit={self.unit!r} (not loaded)"

    def __array__(self, *args, **kwargs):
        raise TypeError("Read a selection or iterate blocks first")

    def _descriptor(self):
        return dict(source=self.source, path=self.path, selection=self._selection, wire=self.wire)

    def isel(self, selection):
        if self.scope != WORKSPACE.scope: raise ValueError("The source generation is no longer available")
        selected = [dict(s) if isinstance(s, dict) else s for s in self._selection]
        for name, value in selection.items():
            matches = [i for i, d in enumerate(self._meta["dimensions"]) if d["path"] == name or d["name"] == name]
            if len(matches) != 1:
                raise ValueError(f"Unknown or ambiguous dimension {name!r}")
            index = matches[0]
            current = selected[index]
            if not isinstance(current, dict):
                raise ValueError(f"Dimension {name!r} is already fixed")
            indices = range(current["start"], current["stop"], current["stride"])
            if isinstance(value, (int, np.integer)) and not isinstance(value, bool):
                selected[index] = indices[int(value)]
            elif isinstance(value, slice):
                sub = indices[value]
                if sub.step < 1 or sub.stop <= sub.start:
                    raise ValueError("Selections need nonempty ranges and positive strides")
                selected[index] = dict(start=sub.start, stop=min(current["stop"], sub.stop), stride=sub.step)
            else:
                raise TypeError("Select a dimension with an integer or slice")
        return _Reference(self.source, self.path, selected, self.wire)

    async def read(self):
        response = await ncx_read(json.dumps(self._descriptor()))
        return np.asarray(response.values.to_py()).reshape(self.shape)


class SourceRead:
    def __init__(self, reference):
        self.reference = reference
        self.nbytes = checked_bytes(reference.shape, 8, _LIMITS["readBytes"])

    def __await__(self):
        return self.reference.read().__await__()


class _SourceArray:
    _ncx_source = True
    def __init__(self, reference):
        self.reference = reference
        self.shape = reference.shape
        self.ndim = len(self.shape)
        self.dtype = np.dtype("float64")

    def __getitem__(self, key):
        selected = self.reference.isel(dict(zip(self.reference.dims, key)))
        return SourceRead(selected)


class Variable(np.lib.mixins.NDArrayOperatorsMixin):
    """An immutable scientific value; arithmetic records a new expression."""
    def __setattr__(self, name, value):
        if name in self.__dict__:
            raise AttributeError("Variables are immutable; assign a new expression")
        object.__setattr__(self, name, value)

    def __setstate__(self, state):
        self.__dict__.update(state)
        if self._node[0] == "resident": self._node[1].flags.writeable = False
        for coordinate in self._coords.values(): coordinate["values"].flags.writeable = False

    def __init__(self, values, *, dims, unit, coords=None, name="Result", unit_kind="absolute", _origin=None):
        data = np.asarray(values)
        if data.dtype.kind not in "biufc": raise TypeError("Variables require numeric arrays")
        checked_bytes(data.shape, data.dtype.itemsize, _LIMITS["publishedBytes"])
        data = data.copy()
        data.flags.writeable = False
        self._initialize(("resident", data), data.shape, data.dtype, dims, unit, name, unit_kind, _origin, coords, name)

    def _initialize(self, node, shape, dtype, dims, unit, name, unit_kind, origin, coords, expression, token=None, copy_coords=True):
        if len(dims) != len(shape) or len(set(dims)) != len(dims):
            raise ValueError("Supply one unique dimension per array axis")
        if unit_kind not in ("absolute", "delta"):
            raise ValueError("unit_kind must be absolute or delta")
        self.depth, self.nodes = _admit_expression(node)
        self._node = node
        self.shape, self.dtype, self.dims = tuple(shape), np.dtype(dtype), tuple(_text(d, "dimension") for d in dims)
        self.unit, self.name, self.unit_kind = _text(unit, "unit"), _text(name, "name"), unit_kind
        self._origin = origin
        self._coords = {}
        for dim, value in (coords or {}).items():
            info = value if isinstance(value, dict) else {"values": value}
            if dim not in self.dims:
                raise ValueError("Unknown coordinate dimension")
            data = np.asarray(info["values"])
            if data.shape != (self.shape[self.dims.index(dim)],):
                raise ValueError("Coordinates must match their dimension")
            checked_bytes(data.shape, 8, _LIMITS["readBytes"])
            data = np.array(data, dtype=np.float64, copy=True) if copy_coords else np.asarray(data, dtype=np.float64)
            data.flags.writeable = False
            self._coords[dim] = dict(values=data, unit=info.get("unit", ""), calendar=info.get("calendar", ""))
        self.expression = expression[:256]
        self.token = token or _token(("ncx-values-v2", node, self.shape, self.dtype.str))
        self.id = _token(("ncx-variable-v2", self.token, self.dims, self.unit, self.unit_kind,
                          self.name, self._origin, self._coords))

    @classmethod
    def _make(cls, node, shape, dtype, dims, unit, name, unit_kind="absolute", origin=None, coords=None, expression="expression", token=None):
        value = object.__new__(cls)
        value._initialize(node, shape, dtype, dims, unit, name, unit_kind, origin, coords, expression, token, copy_coords=False)
        return value

    @classmethod
    def _source(cls, reference):
        return cls._make(("source", reference), reference.shape, "float64", reference.dims,
                         reference.unit, reference.name, origin=reference._descriptor(),
                         expression=f"sources.{reference.source}[{reference.path!r}]")

    @property
    def ndim(self):
        return len(self.shape)

    def __len__(self):
        if not self.ndim: raise TypeError("A scalar variable has no length")
        return self.shape[0]

    def __bool__(self):
        raise TypeError("A Variable has no implicit truth value; compute a scalar explicitly")

    def __getitem__(self, key):
        indices = key if isinstance(key, tuple) else (key,)
        if sum(index is Ellipsis for index in indices) > 1: raise IndexError("Use at most one ellipsis")
        expanded = []
        for index in indices:
            if index is Ellipsis: expanded.extend([slice(None)] * (self.ndim - len(indices) + 1))
            else: expanded.append(index)
        if len(expanded) > self.ndim: raise IndexError("Too many indices")
        return self.isel(dict(zip(self.dims, expanded)))

    @property
    def values(self):
        if self._node[0] != "resident":
            raise TypeError("This variable is lazy; use arithmetic directly or await its compute() method")
        return self._node[1].view()

    def __repr__(self):
        return f"Variable {self.name!r} shape={self.shape} dtype={self.dtype} unit={self.unit!r} ({self._node[0]})"

    def __array__(self, *args, **kwargs):
        raise TypeError("Implicit materialization is disabled; use await variable.compute()")

    def _meta(self):
        return da.empty(self.shape, dtype=self.dtype, chunks=tuple(max(1, n) for n in self.shape))

    def _build(self, selection=None, memo=None):
        selection = selection or (slice(None),) * self.ndim
        memo = {} if memo is None else memo
        key = (self.token, _token(selection))
        if key not in memo:
            result = self._build_node(selection, memo)
            if result.ndim == 0: result = scalar_array(result, _token(key))
            memo[key] = result
        return memo[key]

    def _build_node(self, selection, memo):
        kind, *node = self._node
        if kind == "source":
            ref = node[0].isel(dict(zip(self.dims, selection)))
            data = _SourceArray(ref)
            chunks = chunk_shape(data.shape, 8, _LIMITS["blockBytes"])
            if math.prod((n + c - 1) // c for n, c in zip(data.shape, chunks)) > _LIMITS["graphTasks"]:
                raise MemoryError("Source selection exceeds the task limit; use a smaller selection")
            return da.from_array(data, chunks=chunks, name="ncx-source-" + _token((ref, chunks)),
                                 asarray=False, fancy=False, meta=np.empty((0,) * data.ndim, dtype=data.dtype))
        if kind == "resident":
            data = node[0][selection]
            chunks = chunk_shape(data.shape, data.dtype.itemsize, _LIMITS["blockBytes"])
            return da.from_array(data, chunks=chunks, name="ncx-resident-" + _token((self.token, selection, chunks)))
        if kind == "slice":
            parent, indices = node
            # Compose selections on the logical axes before any source chunks are read.
            composed, axis = [], 0
            for size, index in zip(parent.shape, indices):
                if isinstance(index, int):
                    composed.append(index)
                else:
                    indices_range = range(*index.indices(size))
                    selected = indices_range[selection[axis]]
                    composed.append(selected if isinstance(selected, int) else slice(selected.start, min(size, selected.stop), selected.step))
                    axis += 1
            return parent._build(tuple(composed), memo)
        function, method, inputs, kwargs, pointwise = node
        def unwrap(value):
            if isinstance(value, Variable):
                return value._build(selection if pointwise and value.ndim else None, memo)
            if type(value) is np.ndarray and pointwise and value.ndim:
                return value[selection]
            if isinstance(value, tuple): return tuple(unwrap(x) for x in value)
            if isinstance(value, list): return [unwrap(x) for x in value]
            if isinstance(value, dict): return {k: unwrap(v) for k, v in value.items()}
            return value
        result = getattr(function, method)(*unwrap(inputs), **unwrap(kwargs)) if method else function(*unwrap(inputs), **unwrap(kwargs))
        return result if pointwise else result[selection]

    def _operation(self, function, method, inputs, kwargs):
        if kwargs.get("out") is not None:
            raise TypeError("Variables are immutable; assign the returned expression")
        def capture(value):
            if type(value) is np.ndarray:
                checked_bytes(value.shape, value.dtype.itemsize, _LIMITS["publishedBytes"])
                value = value.copy(); value.flags.writeable = False
            elif isinstance(value, (list, tuple)): value = tuple(capture(v) for v in value)
            elif isinstance(value, dict): value = {k: capture(v) for k, v in value.items()}
            return value
        _admit_expression((inputs, kwargs))
        inputs, kwargs = capture(inputs), capture(kwargs)
        variables = []
        def metadata(value):
            if isinstance(value, Variable): variables.append(value); return value._meta()
            if isinstance(value, (tuple, list)): return type(value)(metadata(x) for x in value)
            if isinstance(value, dict): return {k: metadata(v) for k, v in value.items()}
            return value
        args = metadata(inputs)
        input_variables = tuple(variables)
        options = metadata(kwargs)
        with dask.config.set(scheduler=_no_eager_compute):
            result = getattr(function, method)(*args, **options) if method else function(*args, **options)
        def wrap(result, path=()):
            if isinstance(result, (tuple, list)):
                values = [wrap(value, path + (index,)) for index, value in enumerate(result)]
                return tuple(values) if isinstance(result, tuple) else values
            if not isinstance(result, da.Array): return result
            template = next((v for v in variables if v.ndim), self)
            pointwise = isinstance(function, np.ufunc) and method == "__call__" and function.signature is None
            if pointwise and any(v.ndim and (v.dims != template.dims or v.shape != template.shape) for v in variables):
                raise ValueError("Variable dimensions differ; align explicitly before arithmetic")
            def compatible_arrays(value):
                if type(value) is np.ndarray: return not value.ndim or value.shape == result.shape
                if isinstance(value, (tuple, list)): return all(compatible_arrays(x) for x in value)
                if isinstance(value, dict): return all(compatible_arrays(x) for x in value.values())
                return True
            pointwise = pointwise and result.shape == template.shape and compatible_arrays(inputs) and compatible_arrays(kwargs)
            keep_axes = pointwise
            unit, unit_kind = "", "absolute"
            # These are physical-unit rules. NumPy/Dask decide operation support.
            if function in (np.add, np.subtract, np.maximum, np.minimum, np.positive, np.negative, np.absolute, np.hypot):
                if any(v.ndim and v.unit != template.unit for v in input_variables):
                    raise ValueError("Variable units differ; convert with to_unit() first")
                unit, unit_kind = template.unit, template.unit_kind
                if function is np.subtract and len(input_variables) == 2 and all(v.unit_kind == "absolute" for v in input_variables):
                    unit_kind = "delta"
            elif len(input_variables) == 1 and (function is np.multiply or function is np.true_divide and inputs[0] is template):
                unit, unit_kind = template.unit, template.unit_kind
            if result.dtype.kind == "b": unit = "1"
            dims = template.dims if keep_axes else tuple(f"dim_{i}" for i in range(result.ndim))
            def brief(value):
                if isinstance(value, Variable): return value.expression
                if type(value) in (int, float, bool, str): return str(value)[:40]
                return type(value).__name__
            expression = f"{function.__name__}({', '.join(brief(v) for v in inputs)})" + "".join(f"[{i}]" for i in path)
            return Variable._make(("call", partial(_output, function, method, path) if path else function, None if path else method, inputs, kwargs, pointwise), result.shape, result.dtype,
                                  dims, unit, template.name, unit_kind,
                                  template._origin if keep_axes else None, template._coords if keep_axes else None, expression)
        return wrap(result)

    def __array_ufunc__(self, ufunc, method, *inputs, **kwargs):
        return self._operation(ufunc, method, inputs, kwargs)

    def __array_function__(self, function, types, args, kwargs):
        return self._operation(function, None, args, kwargs)

    def isel(self, selection):
        indices = [slice(None)] * self.ndim
        for name, value in selection.items():
            matches = [i for i, dim in enumerate(self.dims) if dim == name or dim.split("/")[-1] == name]
            if len(matches) != 1: raise ValueError(f"Unknown or ambiguous dimension {name!r}")
            axis = matches[0]
            if isinstance(value, (int, np.integer)) and not isinstance(value, (bool, np.bool_)):
                indices[axis] = range(self.shape[axis])[int(value)]
            elif isinstance(value, slice) and (value.step is None or value.step > 0):
                start, stop, step = value.indices(self.shape[axis])
                indices[axis] = slice(start, stop, step)
            else: raise TypeError("Select an integer or a positive-stride slice")
        dims = tuple(d for d, index in zip(self.dims, indices) if not isinstance(index, int))
        shape = tuple(_slice_size(*index.indices(size)) for size, index in zip(self.shape, indices) if not isinstance(index, int))
        origin = _Reference(**self._origin).isel(selection)._descriptor() if self._origin else None
        coords = {dim: {**info, "values": info["values"][indices[self.dims.index(dim)]]} for dim, info in self._coords.items() if dim in dims}
        return Variable._make(("slice", self, tuple(indices)), shape, self.dtype, dims, self.unit, self.name,
                              self.unit_kind, origin, coords, f"{self.expression}.isel({selection!r})")

    async def compute(self):
        """Return a detached NumPy array for the complete logical selection."""
        checked_bytes(self.shape, self.dtype.itemsize, _LIMITS["readBytes"])
        return np.array(await evaluate_array(self._build(), _LIMITS), copy=True)

    async def read(self, *, dtype="float64"):
        values = await self.compute()
        if dtype not in ("float32", "float64"): raise ValueError("Use float32 or float64")
        return Variable(values.astype(dtype), dims=self.dims, unit=self.unit, name=self.name,
                        unit_kind=self.unit_kind, coords=self._coords, _origin=self._origin)

    async def blocks(self):
        chunks = chunk_shape(self.shape, self.dtype.itemsize, _LIMITS["blockBytes"])
        for starts in itertools.product(*(range(0, n, c) for n, c in zip(self.shape, chunks))):
            selected = {dim: slice(start, min(n, start + chunk)) for dim, start, n, chunk in zip(self.dims, starts, self.shape, chunks)}
            yield await self.isel(selected).read()

    def with_values(self, values, *, unit, name=None, unit_kind="absolute"):
        if np.shape(values) != self.shape: raise ValueError("Changed shape needs explicit dimensions and coordinates")
        return Variable(values, dims=self.dims, unit=unit, name=name or self.name,
                        unit_kind=unit_kind, coords=self._coords, _origin=self._origin)

    def with_unit(self, unit, *, unit_kind=None):
        return Variable._make(self._node, self.shape, self.dtype, self.dims, unit, self.name,
                              unit_kind or self.unit_kind, self._origin, self._coords, self.expression, token=self.token)

    def rename(self, name):
        return Variable._make(self._node, self.shape, self.dtype, self.dims, self.unit, name,
                              self.unit_kind, self._origin, self._coords, self.expression, token=self.token)

    def to_unit(self, unit):
        family, source = _unit(self.unit)
        target_family, target = _unit(unit)
        if family != target_family: raise ValueError("Incompatible units")
        shift = 0 if self.unit_kind == "delta" else source["offset"] - target["offset"]
        return ((self * source["scale"] + shift) / target["scale"]).with_unit(unit, unit_kind=self.unit_kind)

    async def coordinate(self, dim, *, canonical=False):
        if dim in self._coords:
            info = self._coords[dim]
            return info["values"], info["unit"], info["calendar"]
        if self._origin:
            ref = _Reference(**self._origin)
            variable = WORKSPACE.sources[ref.source].get(dim)
            if variable and len(variable["dimensions"]) == 1:
                axis = next(i for i, d in enumerate(ref._meta["dimensions"]) if d["path"] == dim)
                values = await _Reference(ref.source, dim, [ref._selection[axis]]).read()
                unit = next((a["value"] for a in variable["attributes"] if a["name"] == "units"), "")
                time = variable["capabilities"].get("time")
                if time and canonical: return values * time["multiplier_ms"] + time["origin_ms"], "UTC milliseconds", ""
                return values, unit, variable["capabilities"].get("calendar", "")
        checked_bytes((self.shape[self.dims.index(dim)],), 8, _LIMITS["readBytes"])
        return np.arange(self.shape[self.dims.index(dim)], dtype=np.float64), "index", ""


# In-place syntax rebinds immutable values; explicit NumPy out= remains a write and is rejected.
for _name in np.lib.mixins.NDArrayOperatorsMixin.__dict__:
    if _name.startswith("__i") and "__" + _name[3:] in np.lib.mixins.NDArrayOperatorsMixin.__dict__:
        setattr(Variable, _name, getattr(Variable, "__" + _name[3:]))


class Source:
    def __init__(self, alias): self._alias = alias

    def __getitem__(self, path):
        if path not in WORKSPACE.sources[self._alias]: raise KeyError(path)
        if not WORKSPACE.sources[self._alias][path]["capabilities"]["numeric"]: raise TypeError("The variable is not numeric")
        key = self._alias, path
        value = WORKSPACE.source_variables.get(key)
        if value is None:
            value = Variable._source(_Reference(*key))
            WORKSPACE.source_variables[key] = value
        return value


class View(types.SimpleNamespace):
    async def match(self, first, second):
        if first.shape != second.shape: raise ValueError("Sample shapes differ")
        for a, b in zip(first.dims, second.dims):
            ax, au, ac = await first.coordinate(a, canonical=True)
            bx, bu, bc = await second.coordinate(b, canonical=True)
            af, ad = _unit(au); bf, bd = _unit(bu)
            if af != bf or ac != bc or not np.array_equal(ax * ad["scale"] + ad["offset"], bx * bd["scale"] + bd["offset"], equal_nan=True):
                raise ValueError("Sample coordinates differ; align explicitly")
        if first.unit != second.unit: raise ValueError("Units differ; convert explicitly")
        return first, second


class Panel:
    def __init__(self, workspace, name):
        self.workspace, self.name = workspace, name
        self._probe = PanelProbe(self)

    @property
    def path(self):
        for index, name in enumerate(self.workspace.panel_ids()):
            if name == self.name: return f"panels[{index}]"
        return "removed panel"

    def _check(self):
        if self.name not in self.workspace.panel_ids(): raise ValueError("This panel is no longer available")

    def _state(self):
        self._check()
        state = dict(self.workspace.panels.get(self.name, {}))
        pending = self.workspace.updates.get(self.name, {})
        action = pending.get("action")
        if action == "show": state["data"] = dict(id=pending["id"])
        elif action in ("clear", "reset"): state.pop("data", None)
        if "probe" in pending: state["probe"] = pending["probe"]
        return state

    @property
    def data(self):
        data = self._state().get("data")
        if not data: return None
        if "id" in data: return self.workspace.published.get(data["id"])
        return Variable._source(_Reference(**data["reference"]))

    @property
    def visible(self): return self._state().get("visible", False)

    @property
    def range(self): return self._state().get("range", "automatic")

    @property
    def unit(self):
        variable = self.data
        return self._state().get("unit") or (variable.unit if variable is not None else "")

    @property
    def probe(self): return self._probe

    @probe.setter
    def probe(self, other): self._probe._copy_from(other)

    def show(self, variable):
        self._check()
        if type(variable) is not Variable or variable.dtype.kind not in "biuf":
            raise TypeError("Show a Variable containing real numeric data")
        if any(n == 0 for n in variable.shape): raise ValueError("Plot data cannot be empty")
        previous = self.data
        command = dict(target=self.name, action="show", id=variable.id)
        if previous is None or previous.id != variable.id: command["probe"] = None
        self.workspace.published[variable.id] = variable
        self.workspace.updates[self.name] = command
        return self

    def clear(self):
        self._check()
        self.workspace.updates[self.name] = dict(target=self.name, action="clear", probe=None)
        return self

    def reset(self):
        self._check()
        self.workspace.updates[self.name] = dict(target=self.name, action="reset", probe=None)
        return self

    def remove(self):
        self._check()
        if self.name == "panel1": raise ValueError("The main panel cannot be removed; clear or reset it")
        if self.name not in self.workspace.panels: self.workspace.updates.pop(self.name, None)
        else: self.workspace.updates[self.name] = dict(target=self.name, action="remove")


class PanelProbe:
    def __init__(self, panel): self.panel = panel

    def _selection(self): return self.panel._state().get("probe")

    @staticmethod
    def _domain(variable):
        if variable._origin is None: return variable.id
        reference = _Reference(**variable._origin)
        return reference.source, reference._meta.get("view_hint"), variable.dims, variable.shape, reference._selection

    def _copy_from(self, other):
        self.panel._check()
        if other is None: return self.clear()
        if type(other) is not PanelProbe: raise TypeError("Assign another panel's probe or None")
        selection = other._selection()
        if selection is None: return self.clear()
        source, target = other.panel.data, self.panel.data
        if source is None or target is None: raise ValueError("Bind both panels before copying a probe")
        if self._domain(source) != self._domain(target):
            raise ValueError("Probe assignment requires the same source geometry and selection; use await probe.move() for another grid")
        selection = deepcopy(selection)
        selection["value"] = math.nan
        self._set(selection)

    def _set(self, selection):
        self.panel._check()
        command = self.panel.workspace.updates.setdefault(self.panel.name, dict(target=self.panel.name, action="probe"))
        command["probe"] = selection

    @property
    def position(self):
        selection = self._selection()
        if selection is None: return None
        return {key: selection[key] for key in ("x", "y", "longitude", "latitude") if selection.get(key) is not None}

    @property
    def data(self):
        variable = self.panel.data
        if variable is None: return None
        state = self.panel._state()
        probe = state.get("probe")
        if not probe:
            if state.get("domain") == "curve": return variable
            return None
        along = state.get("along")
        if along not in variable.dims:
            catalog = self.panel.workspace.sources.get(variable._origin["source"], {}) if variable._origin else {}
            along = next((dim for dim in variable.dims if catalog.get(dim, {}).get("capabilities", {}).get("time")), None)
            along = along or next(iter(variable.dims), None)
        if along is None: return None
        indices = {**probe["indices"], **state.get("indices", {})}
        indices = {dim: indices.get(dim, 0) for dim in variable.dims if dim != along}
        average = probe.get("average")
        if not average: return variable.isel(indices)
        if average["dimension"] == along: raise ValueError("The averaged dimension cannot be the curve dimension")
        samples = tuple(variable.isel({**indices, average["dimension"]: index}) for index in average["indices"])
        if not samples: raise ValueError("The area probe is empty")
        first = samples[0]
        return Variable._make(("call", _mean_samples, None, samples, {}, True), first.shape,
                              first.dtype, first.dims, first.unit, variable.name, variable.unit_kind,
                              first._origin, first._coords, f"area mean({variable.expression})")

    async def move(self, *, longitude=None, latitude=None, x=None, y=None):
        self.panel._check()
        geographic = longitude is not None or latitude is not None
        position = dict(longitude=longitude, latitude=latitude) if geographic else dict(x=x, y=y)
        if geographic and (x is not None or y is not None): raise ValueError("Supply longitude/latitude or x/y, not both")
        if any(type(value) not in (int, float) or not math.isfinite(value) for value in position.values()):
            raise ValueError("Supply two finite probe coordinates")
        response = await js.ncx_move_probe(self.panel.name, json.dumps(position), updates())
        selection = json.loads(response)
        if "error" in selection: raise ValueError(selection["error"])
        self._set(selection)
        return self

    def clear(self): self._set(None)


class PanelCollection:
    def __init__(self, workspace): self.workspace = workspace
    def __iter__(self): return (self.workspace.panel(name) for name in self.workspace.panel_ids())
    def __len__(self): return len(self.workspace.panel_ids())
    def __getitem__(self, index): return self.workspace.panel(self.workspace.panel_ids()[index])


class Frame:
    def __init__(self, workspace):
        self.workspace = workspace
        self.panels = PanelCollection(workspace)

    def append(self, data=None):
        workspace = self.workspace
        if len(self.panels) >= _LIMITS["panels"]: raise MemoryError("Panel limit reached; remove an unused panel")
        name = f"panel{workspace.next_panel}"
        workspace.next_panel += 1
        workspace.updates[name] = dict(target=name, action="append")
        panel = workspace.panel(name)
        if data is not None: panel.show(data)
        return panel


class Workspace:
    """The browser supplies committed state; one command map holds pending changes."""
    def __init__(self):
        self.scope = ""
        self.revision = -1
        self.sources = {}
        self.source_variables = WeakValueDictionary()
        self.panels = {}
        self.handles = WeakValueDictionary()
        self.published = {}
        self.updates = {}
        self.evaluations = {}
        self.next_panel = 2
        self.view_state = None
        self.frame = Frame(self)
        self.namespace = dict(np=np, Variable=Variable, frame=self.frame, panels=self.frame.panels)

    def panel_ids(self):
        return tuple(name for name in dict.fromkeys([*self.panels, *self.updates])
                     if self.updates.get(name, {}).get("action") != "remove")

    def panel(self, name):
        panel = self.handles.get(name)
        if panel is None:
            panel = Panel(self, name)
            self.handles[name] = panel
        return panel

    def configure(self, state, revision):
        if revision <= self.revision: return
        if self.scope and self.scope != state["scope"]: raise ValueError("Source scope changed; reset the worker")
        self.scope = state["scope"]
        if "catalog" in state:
            self.sources = {source["alias"]: {v["path"]: v for v in source["metadata"]["variables"]} for source in state["catalog"]}
            self.namespace["sources"] = types.SimpleNamespace(**{alias: Source(alias) for alias in self.sources})
        self.panels = state["panels"]
        self.updates.clear()
        for name in self.panels: self.next_panel = max(self.next_panel, int(name.removeprefix("panel")) + 1)
        if self.view_state != state["view"]:
            view = View()
            for alias, item in state["view"].items():
                ref = _Reference(alias, item["path"], item["selection"])
                value = Variable._source(ref)
                average = item.get("average")
                if average:
                    axis = next(i for i, d in enumerate(ref._meta["dimensions"]) if d["path"] == average["dimension"])
                    samples = []
                    for index in average["indices"]:
                        selected = list(ref._selection); selected[axis] = index
                        samples.append(Variable._source(_Reference(alias, ref.path, selected)))
                    value = Variable._make(("call", _mean_samples, None, tuple(samples), {}, True), ref.shape, "float64", ref.dims, ref.unit,
                                          ref.name + " (area mean)", origin=ref._descriptor(), expression="area mean")
                setattr(view, alias, value)
            self.namespace["view"] = view
            self.view_state = state["view"]
        self.revision = revision


WORKSPACE = Workspace()


def configure(state_json, revision):
    # The guard precedes JSON decoding and configuration is never called by completion.
    if revision > WORKSPACE.revision: WORKSPACE.configure(json.loads(state_json), revision)


def _mean_samples(*samples):
    return da.nanmean(da.stack(samples), axis=0)


def restore(key, payload):
    # Executable pickle: only restore bytes created by this session's worker and retained by SteeringSession.
    # Files, URLs, host setSources payloads, and terminal text are never accepted through this path.
    if key not in WORKSPACE.published:
        value = cloudpickle.loads(bytes(payload.to_py()))
        if type(value) is not Variable or value.id != key: raise TypeError("Invalid expression identity")
        WORKSPACE.published[key] = value


def retain(ids_json):
    ids = set(json.loads(ids_json))
    for key in list(WORKSPACE.published):
        if key not in ids: del WORKSPACE.published[key]


async def evaluate(key, selection_json, wire, evaluation_id):
    import asyncio
    WORKSPACE.evaluations[evaluation_id] = asyncio.current_task()
    try:
        variable = WORKSPACE.published[key]
        selection = [s if isinstance(s, int) else slice(s["start"], s["stop"], s["stride"]) for s in json.loads(selection_json)]
        data = await evaluate_array(variable._build(tuple(selection)), _LIMITS)
        result = np.ascontiguousarray(data, dtype=np.float64 if wire == "f64" else np.float32)
        return dict(values=memoryview(result).cast("B"), shape=list(data.shape), dtype="f64" if wire == "f64" else "f32")
    except BaseException as error:
        return dict(error=error_details(error, ""))
    finally:
        WORKSPACE.evaluations.pop(evaluation_id, None)


from ncx_console import describe, members, complete_input, completion, error_details


def complete(code): return complete_input(_compiler, code)


async def execute(code, run):
    WORKSPACE.updates.clear()
    filename = f"<steering-{run}>"
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    while len(linecache.cache) > _LIMITS["history"]: linecache.cache.pop(next(iter(linecache.cache)))
    try:
        result = await eval_code_async(code, globals=WORKSPACE.namespace, filename=filename,
                                       return_mode="last_expr", quiet_trailing_semicolon=True)
        if result is not None: WORKSPACE.namespace["_"] = result
        return dict(result=describe(result) if result is not None else None)
    except BaseException as error:
        WORKSPACE.updates.clear()
        return dict(error=error_details(error, code))


def cancel_evaluation(evaluation_id):
    task = WORKSPACE.evaluations.get(evaluation_id)
    if task is not None: task.cancel()


def updates():
    known = {state["data"]["id"] for state in WORKSPACE.panels.values() if "id" in state.get("data", {})}
    result, size = [], 0
    for command in WORKSPACE.updates.values():
        update = {key: value for key, value in command.items() if key != "id"}
        if command["action"] == "show":
            key = command["id"]
            if key in known: update["input"] = dict(id=key)
            else:
                variable = WORKSPACE.published[key]
                payload = cloudpickle.dumps(variable, protocol=5)
                coords = {dim: {**info, "values": memoryview(info["values"]).cast("B")} for dim, info in variable._coords.items()}
                size += len(payload) + sum(info["values"].nbytes for info in variable._coords.values())
                if size > _LIMITS["publishedBytes"]: raise MemoryError("Published expressions exceed the memory limit")
                update["input"] = dict(expression=dict(id=key, payload=memoryview(payload),
                    shape=list(variable.shape), dims=list(variable.dims), name=variable.name,
                    unit=variable.unit, unit_kind=variable.unit_kind, origin=variable._origin,
                    coords=coords, summary=variable.expression))
                known.add(key)
        result.append(update)
    return result


def outline():
    reserved = {"sources", "view", "np", "Variable", "frame", "panels"}
    result = []
    for index, (name, value) in enumerate(WORKSPACE.namespace.items()):
        if index >= _LIMITS["names"] + len(reserved) + 2: break
        if type(name) is not str or len(name) > 256 or name.startswith("_") or name in reserved: continue
        result.append(dict(name=name, **describe(value)))
    return result


def completions(code, cursor, force=False): return completion(WORKSPACE.namespace, code, cursor, force)
