(function(){({name:`ncx-web`,private:!0,version:`0.1.0`,type:`module`,scripts:{dev:`vite`,build:`npm run style:check && tsc --noEmit && vite build && node scripts/copy-python.mjs`,test:`npm run style:check && node --test 'src/**/*.test.ts'`,"style:sync":`node scripts/sync-plot-style.mjs`,"style:check":`node scripts/sync-plot-style.mjs --check`},dependencies:{"@speed-highlight/core":`2.1.0`,pyodide:`314.0.7`,react:`^19.2.8`,"react-dom":`^19.2.8`},devDependencies:{"@types/react":`^19.2.18`,"@types/react-dom":`^19.2.4`,typescript:`^7.0.2`,vite:`^8.2.1`}}).dependencies.pyodide;let e={readBytes:33554432,blockBytes:4194304,publishedBytes:67108864,outputChars:65536,history:100,names:500,graphTasks:1e5,computeBytes:134217728,runMs:12e4,panels:16},t=(e,t=1,n=0,r=[],i=e)=>({id:e,label:i,scale:t,offset:n,aliases:[e,...r]}),n={pressure:[t(`Pa`,1,0,[`pascal`,`pascals`]),t(`hPa`,100),t(`mb`,100,0,[`mbar`,`millibar`]),t(`kPa`,1e3),t(`atm`,101325),t(`psi`,6894.757293168)],velocity:[t(`m/s`,1,0,[`m s-1`,`m s^-1`,`m s**-1`,`ms-1`],`m s⁻¹`),t(`km/h`,1/3.6,0,[`km h-1`,`km h^-1`,`kmh-1`],`km h⁻¹`),t(`mph`,.44704),t(`kt`,1852/3600,0,[`knot`,`knots`])],temperature:[t(`K`,1,0,[`kelvin`]),t(`°C`,1,273.15,[`degC`,`degree_Celsius`,`degrees_Celsius`,`Celsius`]),t(`°F`,5/9,255.3722222222222,[`degF`,`degree_Fahrenheit`,`Fahrenheit`])],length:[t(`m`,1,0,[`metre`,`meter`,`metres`,`meters`]),t(`km`,1e3),t(`ft`,.3048,0,[`feet`,`foot`])],water:[t(`m`),t(`mm`,.001),t(`in`,.0254)],fraction:[t(`1`,1,0,[`fraction`,`(0 - 1)`]),t(`%`,.01,0,[`percent`])],period:[t(`s`,1,0,[`second`,`seconds`]),t(`min`,60,0,[`minute`,`minutes`])],angle:[t(`degrees`,Math.PI/180,0,[`degree`,`deg`]),t(`rad`,1,0,[`radian`,`radians`])],energy:[t(`J/m2`,1,0,[`J m-2`,`J m**-2`,`J m^-2`],`J m⁻²`),t(`kJ/m2`,1e3,0,[`kJ m-2`],`kJ m⁻²`),t(`MJ/m2`,1e6,0,[`MJ m-2`],`MJ m⁻²`)],flux:[t(`W/m2`,1,0,[`W m-2`,`W m**-2`,`W m^-2`],`W m⁻²`),t(`kW/m2`,1e3,0,[`kW m-2`],`kW m⁻²`)],specificEnergy:[t(`J/kg`,1,0,[`J kg-1`,`J kg**-1`,`J kg^-1`],`J kg⁻¹`),t(`kJ/kg`,1e3,0,[`kJ kg-1`],`kJ kg⁻¹`)]};var r=[{file:`click-8.5.0-py3-none-any.whl`,sha256:`255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360`},{file:`cloudpickle-3.1.2-py3-none-any.whl`,sha256:`9acb47f6afd73f60dc1df93bb801b472f05ff42fa6c84167d25cb206be1fbf4a`},{file:`dask-2026.8.0-py3-none-any.whl`,sha256:`ccc0c83a189b0398602435189771d28dad7b5773b6089bb8dce14ae732dd782c`},{file:`fsspec-2026.7.0-py3-none-any.whl`,sha256:`b57ddbafedfaef7018c1ecab32aa200a9d7ca26b77965f64e48b70061249d279`},{file:`locket-1.0.0-py2.py3-none-any.whl`,sha256:`b6c819a722f7b6bd955b80781788e4a66a55628b858d347536b7e81325a3a5e3`},{file:`packaging-26.3-py3-none-any.whl`,sha256:`d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c`},{file:`partd-1.4.2-py3-none-any.whl`,sha256:`978e4ac767ec4ba5b86c6eaa52e5a2a3bc748a2ca839e8cc798f1cc6ce6efb0f`},{file:`toolz-1.1.0-py3-none-any.whl`,sha256:`15ccc861ac51c53696de0a5d6d4607f99c210739caf987b5d2054f3efed429d8`}];let i=self,a,o,s=0,c,l=!1,u=0,d=0,f=``,p=`output`,m,h=[],g=new Map;function _(){clearTimeout(m),m=void 0,f&&i.postMessage({type:`output`,run:s,kind:p,text:f}),f=``}function v(t,n=`output`){if(d>=e.outputChars)return;n!==p&&_(),p=n;let r=e.outputChars-d;d+=t.length,f+=t.slice(0,r),t.length>r&&(f+=`
Console output limit reached.
`),f.length>=4096?_():m??=setTimeout(_,50)}function y(e,...t){let n=o[e];try{return n(...t)}finally{n.destroy()}}function b(e){try{return e.toJs({dict_converter:Object.fromEntries})}finally{e.destroy()}}function x(e,...t){return b(y(e,...t))}function S(e,t=new Set){if(ArrayBuffer.isView(e))t.add(e.buffer);else if(e&&typeof e==`object`)for(let n of Object.values(e))S(n,t);return[...t]}function C(e=[]){for(let t of e)y(`restore`,t.id,t.payload)}i.onmessage=({data:e})=>{if(e.type===`read-result`||e.type===`probe-result`){let t=g.get(e.id);g.delete(e.id),e.type===`probe-result`?t?.resolve(JSON.stringify(e.error?{error:e.error}:e.result)):e.error?t?.reject(Error(e.error)):t?.resolve(e.slice);return}h.push(e),w()};async function w(){if(!l){l=!0;try{for(;h.length;)await T(h.shift())}finally{l=!1}}}async function T(t){if(t.type===`init`){try{let{loadPyodide:l}=await import(`${t.runtimeURL}pyodide.mjs`);a=await l({indexURL:t.runtimeURL,packageBaseUrl:t.runtimeURL,stdin:()=>null}),await a.loadPackage([`numpy`,`pyyaml`]);let d=a.runPython(`__import__('site').getsitepackages()[0]`);for(let e of r){let n=await fetch(`${t.runtimeURL}${e.file}?sha256=${e.sha256}`);if(!n.ok)throw Error(`Cannot load ${e.file}`);a.unpackArchive(await n.arrayBuffer(),`zip`,{extractDir:d})}Object.assign(i,{ncx_move_probe:(e,t,n)=>{let r=++u,a=n.toJs({dict_converter:Object.fromEntries});return new Promise((n,o)=>{g.set(r,{resolve:n,reject:o}),i.postMessage({type:`move-probe`,id:r,run:s,target:e,position:JSON.parse(t),updates:a},S(a))})},ncx_read:async e=>{let t=++u;return new Promise((n,r)=>{if(g.size){r(Error(`Only one source read can run at a time`));return}g.set(t,{resolve:n,reject:r}),_(),i.postMessage({type:`read`,id:t,run:s,evaluation:c,reference:JSON.parse(e)})})},ncx_limits:JSON.stringify(e),ncx_units:JSON.stringify(n),ncx_instance:t.instance}),a.FS.writeFile(`${d}/ncx_evaluation.py`,`"""Asynchronous read adapter for the pinned Dask task format."""
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
`),a.FS.writeFile(`${d}/ncx_console.py`,`"""Bounded, non-evaluating descriptions shared by Outline and completion."""
import ast
import annotationlib
import builtins
from collections import ChainMap
from itertools import islice
import inspect
import keyword
import linecache
import re
import traceback
import types
import numpy as np


def _runtime():
    import ncx_runtime
    return ncx_runtime


def summary(value):
    runtime = _runtime()
    if type(value) is runtime.Variable:
        shape = " × ".join(map(str, value.shape)) or "scalar"
        storage = "resident" if value._node[0] == "resident" else "lazy"
        return f"Variable · {value.dtype} · {shape} · {value.unit or 'unit unspecified'} · {storage}"
    if type(value) is runtime.Plot: return f"{value.path} · {'Field' if value.kind == 'field' else 'Curve'}"
    if type(value) is runtime.PanelProbe: return f"{value.panel.path}.probe"
    if type(value) is runtime.PanelCollection: return f"Panels · {len(value)}"
    if type(value) is runtime.Frame: return f"Frame · {len(value.panels)} panels"
    if type(value) is runtime.Panel: return f"{value.path} · Panel"
    if type(value) is runtime.Source: return f"Source {value._alias}"
    if type(value) is np.ndarray: return f"ndarray · {value.dtype} · {value.shape} · {value.nbytes} bytes"
    if type(value) in (str, int, float, bool, type(None)):
        return repr(value[:512] if type(value) is str else value)[:512]
    if isinstance(value, np.generic): return str(value)[:512]
    if type(value) in (tuple, list):
        items = ", ".join(summary(item) if type(item) not in (list, tuple, dict, set) else type(item).__name__ for item in value[:12])
        suffix = ", …" if len(value) > 12 else "," if type(value) is tuple and len(value) == 1 else ""
        return f"{'(' if type(value) is tuple else '['}{items}{suffix}{')' if type(value) is tuple else ']'}"
    if type(value) in (dict, set): return f"{type(value).__name__} · {len(value)} items"
    if type(value) is types.ModuleType: return f"module {value.__name__}"
    if type(value) in (types.FunctionType, types.BuiltinFunctionType, types.MethodType): return f"function {value.__name__}"
    return f"{type(value).__name__} object"


def members(value):
    runtime = _runtime()
    if type(value) is runtime.Variable:
        result = dict(shape=value.shape, dtype=str(value.dtype), dims=value.dims, unit=value.unit,
                      unit_kind=value.unit_kind, name=value.name, expression=value.expression,
                      storage="resident" if value._node[0] == "resident" else "lazy")
        result.update({name: getattr(value, name) for name in ("isel", "compute", "read", "blocks", "coordinate", "to_unit", "with_unit", "with_values", "rename")})
        result["probe"] = runtime.Variable.probe
        return result
    if type(value) in (runtime.Panel, runtime.PanelProbe, runtime.Plot):
        panel = value if type(value) is runtime.Panel else value.panel
        try: panel._check()
        except ValueError: return dict(status="removed")
    if type(value) is runtime.Plot:
        return dict(data=value.data, visible=value.visible, range=value.range, unit=value.unit,
                    show=value.show, clear=value.clear, reset=value.reset)
    if type(value) is runtime.Panel:
        result = {"curve": value.curve, "field": value.field, "data": value.data, "probe": value.probe, "show": value.show, "clear": value.clear, "reset": value.reset}
        result["remove"] = value.remove
        return result
    if type(value) is runtime.PanelCollection: return {}
    if type(value) is runtime.PanelProbe: return dict(position=value.position, data=value.data, move=value.move, clear=value.clear)
    if type(value) is runtime.Frame: return dict(panels=value.panels, append=value.append)
    if type(value) is runtime.Source: return {}
    if type(value) in (types.SimpleNamespace, runtime.View, types.ModuleType):
        return dict(vars(value))
    if type(value) is np.ndarray:
        return dict(shape=value.shape, dtype=str(value.dtype), ndim=value.ndim, size=value.size, nbytes=value.nbytes)
    # Unknown descriptors are listed but never invoked.
    result = {}
    for cls in type.__getattribute__(type(value), "__mro__"):
        for name in type.__getattribute__(cls, "__dict__"):
            if not name.startswith("_"): result.setdefault(name, inspect.getattr_static(value, name))
    return result


def describe(value):
    runtime = _runtime()
    result = dict(kind=type(value).__name__, summary=summary(value), fields=[])
    if type(value) is runtime.Plot:
        result["target"] = value.target
        result["reference"] = value.path
    if type(value) is runtime.Variable: result["objectId"] = value.id
    if type(value) is runtime.Source:
        result["fields"] = [dict(name="variables", value=str(len(runtime._sources[value._alias])))]
        return result
    if type(value) in (runtime.Variable, runtime.Plot, runtime.Panel, runtime.Frame, runtime.PanelProbe, np.ndarray):
        result["fields"] = [dict(name=name, value=summary(item)) for name, item in members(value).items() if not callable(item) and not isinstance(item, property)]
    elif type(value) is dict:
        result["fields"] = [dict(name=summary(key), value=summary(item)) for key, item in islice(value.items(), 20)]
    elif type(value) in (list, tuple):
        result["fields"] = [dict(name=str(i), value=summary(item)) for i, item in enumerate(value[:20])]
    return result


def complete_input(compiler, code):
    try: return compiler(code, symbol="exec") is not None
    except (SyntaxError, OverflowError, ValueError): return True


def _resolve(namespace, expression):
    node = ast.parse(expression, mode="eval").body
    def resolve(item):
        if isinstance(item, ast.Name): return namespace.get(item.id, vars(builtins).get(item.id))
        if isinstance(item, ast.Attribute):
            value = members(resolve(item.value)).get(item.attr)
            return None if isinstance(value, (property, types.GetSetDescriptorType, types.MemberDescriptorType)) else value
        if isinstance(item, ast.Subscript) and isinstance(item.slice, ast.Constant):
            owner = resolve(item.value)
            if type(owner) is _runtime().Source and isinstance(item.slice.value, str): return owner[item.slice.value]
            if type(owner) in (tuple, list, _runtime().PanelCollection) and type(item.slice.value) is int: return owner[item.slice.value]
        return None
    return resolve(node)


def _signature(value):
    trusted = type(value) in (types.FunctionType, types.BuiltinFunctionType, types.MethodType)
    numpy_function = type(value) in (type(np.mean), np.ufunc)
    trusted = trusted or numpy_function
    if not trusted: return "", []
    if isinstance(value, np.ufunc): return f"{value.__name__}(...)", []
    try:
        signature = inspect.signature(value, eval_str=False, follow_wrapped=numpy_function, annotation_format=annotationlib.Format.STRING)
        if type(signature) is not inspect.Signature: return "", []
        parameters = signature.parameters.values()
    except (ValueError, TypeError): return "", []
    labels, keywords = [], []
    for param in parameters:
        label = param.name
        if param.kind is param.VAR_POSITIONAL: label = "*" + label
        elif param.kind is param.VAR_KEYWORD: label = "**" + label
        elif param.kind in (param.POSITIONAL_OR_KEYWORD, param.KEYWORD_ONLY): keywords.append(param.name)
        if param.default is not param.empty: label += "=…"
        labels.append(label)
    return f"{value.__name__}({', '.join(labels)})", keywords


def completion(namespace, code, cursor, force=False):
    before, after = code[:cursor], code[cursor:]
    result = dict(start=cursor, end=cursor, items=[], signature="")
    path = re.search(r'''([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)\\[(["'])([^"'\\n]*)$''', before)
    try:
        if path:
            owner, quote, prefix = _resolve(namespace, path[1]), path[2], path[3]
            if type(owner) is not _runtime().Source: return result
            result["start"] = cursor - len(prefix)
            closing = after.find(quote)
            if closing >= 0 and after[closing + 1:closing + 2] == "]": result["end"] = cursor + closing + 2
            result["items"] = [dict(label=name, insert=name.replace("\\\\", "\\\\\\\\").replace(quote, "\\\\" + quote) + quote + "]", detail="source variable")
                               for name, variable in _runtime()._sources[owner._alias].items()
                               if variable["capabilities"]["numeric"] and name.startswith(prefix)][:50]
            return result
        expression = r'''[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*|\\[(?:"[^"\\n]*"|'[^'\\n]*'|[0-9]+)\\])*'''
        attribute = re.search(rf"({expression})\\.([A-Za-z_]\\w*)?$", before)
        prefix = re.search(r"(?<!\\w)[A-Za-z_]\\w*$", before)
        prefix = prefix[0] if prefix else ""
        result["start"] = cursor - len(prefix)
        suffix = re.match(r"\\w*", after)[0]
        result["end"] = cursor + len(suffix)
        if attribute:
            choices = members(_resolve(namespace, attribute[1]))
            prefix = attribute[2] or ""
            result["start"] = cursor - len(prefix)
        else:
            choices = dict(islice(namespace.items(), 1000))
            choices.update(vars(builtins))
            choices.update({word: None for word in keyword.kwlist})
        call = re.search(rf"({expression})\\(([^()]*)$", before)
        if call and not attribute:
            function = _resolve(namespace, call[1])
            signature, keywords = _signature(function)
            result["signature"] = signature
            if not prefix and not force and not before.endswith(("(", ",")): return result
            used = set(re.findall(r"\\b(\\w+)\\s*=", call[2]))
            for name in keywords:
                if name.startswith(prefix) and name not in used:
                    result["items"].append(dict(label=name + "=", insert=name + "=", detail="parameter"))
        if not prefix and not attribute and not call and not force: return result
        for name in sorted(choices):
            if not isinstance(name, str) or not name.startswith(prefix) or name.startswith("_") and not prefix.startswith("_"): continue
            value = choices[name]
            signature, _ = _signature(value)
            result["items"].append(dict(label=name, insert=name, detail=signature or type(value).__name__))
            if len(result["items"]) >= 50: break
    except (SyntaxError, KeyError, ValueError, TypeError): pass
    return result


def error_details(error, submitted):
    trace = traceback.TracebackException.from_exception(error, capture_locals=False)
    frames = [frame for frame in trace.stack if frame.filename.startswith("<steering-")]
    frame = frames[-1] if frames else None
    line, column, source = None, None, ""
    if isinstance(error, SyntaxError):
        line, column, source = error.lineno, max(0, (error.offset or 1) - 1), (error.text or "").rstrip("\\n")
    elif frame:
        line, source = frame.lineno, frame.line or ""
        raw = linecache.getline(frame.filename, line).rstrip("\\n")
        column = len(raw.encode("utf-8")[:frame.colno or 0].decode("utf-8", "ignore").encode("utf-16-le")) // 2
        source = raw
    return dict(message=f"{type(error).__name__}: {str(error)[:2048]}", line=line, column=column,
                source=source[:4096], code=submitted, traceback="".join(trace.format())[:65536])
`),a.FS.writeFile(`${d}/ncx_runtime.py`,`"""Scientific variables and display handles for the Steering console."""
import ast
import codeop
import itertools
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
from js import ncx_read, ncx_limits, ncx_units, ncx_instance
import js
from ncx_evaluation import checked_bytes, chunk_shape, compute as evaluate_array

_LIMITS = json.loads(ncx_limits)
_UNITS = json.loads(ncx_units)
_sources = {}
_source_variables = WeakValueDictionary()
_view_key = None
_view = None
_updates = {}
_namespace = {}
_published = {}
_display_state = {}
_probe = None
_panels = {}
_next_panel = 2
_probe_updates = {}
_identifiers = itertools.count(1)
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


class _Reference:
    def __setattr__(self, name, value):
        if name in self.__dict__:
            raise AttributeError("Variable references are immutable; use isel to make a selection")
        object.__setattr__(self, name, value)

    def __init__(self, source, path, selection=None, wire="f64"):
        self.source = source
        self.path = path
        self._meta = _sources[source][path]
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


class _SourceArray:
    def __init__(self, reference):
        self.reference = reference
        self.shape = reference.shape
        self.ndim = len(self.shape)
        self.dtype = np.dtype("float64")

    def __getitem__(self, key):
        selected = self.reference.isel(dict(zip(self.reference.dims, key)))
        return selected.read()


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

    def _initialize(self, node, shape, dtype, dims, unit, name, unit_kind, origin, coords, expression):
        if len(dims) != len(shape) or len(set(dims)) != len(dims):
            raise ValueError("Supply one unique dimension per array axis")
        if unit_kind not in ("absolute", "delta"):
            raise ValueError("unit_kind must be absolute or delta")
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
            data = np.array(data, dtype=np.float64, copy=True)
            data.flags.writeable = False
            self._coords[dim] = dict(values=data, unit=info.get("unit", ""), calendar=info.get("calendar", ""))
        self.expression = expression[:256]
        self.id = f"{ncx_instance}:{next(_identifiers)}"

    @classmethod
    def _make(cls, node, shape, dtype, dims, unit, name, unit_kind="absolute", origin=None, coords=None, expression="expression"):
        value = object.__new__(cls)
        value._initialize(node, shape, dtype, dims, unit, name, unit_kind, origin, coords, expression)
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
        return self._node[1]

    def __repr__(self):
        return f"Variable {self.name!r} shape={self.shape} dtype={self.dtype} unit={self.unit!r} ({self._node[0]})"

    def __array__(self, *args, **kwargs):
        raise TypeError("Implicit materialization is disabled; use await variable.compute()")

    def _meta(self):
        return da.empty(self.shape, dtype=self.dtype, chunks=tuple(max(1, n) for n in self.shape))

    def _build(self, selection=None):
        selection = selection or (slice(None),) * self.ndim
        kind, *node = self._node
        if kind == "source":
            ref = node[0].isel(dict(zip(self.dims, selection)))
            data = _SourceArray(ref)
            chunks = chunk_shape(data.shape, 8, _LIMITS["blockBytes"])
            if math.prod((n + c - 1) // c for n, c in zip(data.shape, chunks)) > _LIMITS["graphTasks"]:
                raise MemoryError("Source selection exceeds the task limit; use a smaller selection")
            return da.from_array(data, chunks=chunks,
                                 asarray=False, fancy=False, meta=np.empty((0,) * data.ndim, dtype=data.dtype))
        if kind == "resident":
            data = node[0][selection]
            return da.from_array(data, chunks=chunk_shape(data.shape, data.dtype.itemsize, _LIMITS["blockBytes"]))
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
            return parent._build(tuple(composed))
        function, method, inputs, kwargs, pointwise = node
        def unwrap(value):
            if isinstance(value, Variable):
                return value._build(selection if pointwise and value.ndim else None)
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
        return await evaluate_array(self._build(), _LIMITS)

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
                              unit_kind or self.unit_kind, self._origin, self._coords, self.expression)

    def rename(self, name):
        return Variable._make(self._node, self.shape, self.dtype, self.dims, self.unit, name,
                              self.unit_kind, self._origin, self._coords, self.expression)

    @property
    def probe(self):
        """Select the command's GUI probe without reading numeric samples."""
        if self.ndim == 1 and (not _probe or _probe["along"] in self.dims): return self
        if not _probe or not self._origin:
            raise ValueError("Click a field to place a probe before using .probe")
        origin = _Reference(**self._origin)
        if origin.source != _probe["source"]:
            raise ValueError("The probe belongs to another source; select a native location explicitly")
        reference = _sources[origin.source][_probe["path"]]
        if origin._meta.get("view_hint") != reference.get("view_hint"):
            raise ValueError("The probe and variable use different geometry")
        dimensions = {d["path"]: d["length"] for d in reference["dimensions"]}
        for dimension, base in zip(origin._meta["dimensions"], origin._selection):
            expected = dimensions.get(dimension["path"])
            if expected is None and isinstance(base, int): continue
            if expected != dimension["length"]:
                raise ValueError("The probe and variable use different dimensions; select extra dimensions with isel")
        along = _probe["along"]
        if along not in self.dims:
            raise ValueError("The probe's Along dimension is absent from this variable")

        def at(indices):
            selected = {}
            for dim, base in zip(origin._meta["dimensions"], origin._selection):
                path = dim["path"]
                if path == along: continue
                if isinstance(base, int):
                    if path in indices and indices[path] != base: raise ValueError("Probe is outside this variable's selection")
                else:
                    if path not in indices: raise ValueError(f"Probe has no selection for {path}")
                    index = indices[path]
                    start, stop, stride = base["start"], base["stop"], base["stride"]
                    if not start <= index < stop or (index - start) % stride:
                        raise ValueError("Probe is outside this variable's selection")
                    selected[path] = (index - start) // stride
            return self.isel(selected)

        average = _probe.get("average")
        if not average: return at(_probe["indices"])
        if average["dimension"] == along:
            raise ValueError("The averaged dimension cannot also be the curve's Along dimension")
        samples = tuple(at({**_probe["indices"], average["dimension"]: index}) for index in average["indices"])
        if not samples: raise ValueError("The area probe is empty")
        first = samples[0]
        return Variable._make(("call", _mean_samples, None, samples, {}, True), first.shape,
                              first.dtype, first.dims, first.unit, self.name, self.unit_kind,
                              first._origin, first._coords, f"area mean({self.expression})")

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
            variable = _sources[ref.source].get(dim)
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
Array = Variable


class Source:
    def __init__(self, alias): self._alias = alias

    def __getitem__(self, path):
        if path not in _sources[self._alias]: raise KeyError(path)
        if not _sources[self._alias][path]["capabilities"]["numeric"]: raise TypeError("The variable is not numeric")
        key = self._alias, path
        value = _source_variables.get(key)
        if value is None:
            value = Variable._source(_Reference(*key))
            _source_variables[key] = value
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
    def __init__(self, name):
        self.name = name
        self.field = Plot(self, "field")
        self.curve = Plot(self, "curve")
        self._probe = PanelProbe(self)

    @property
    def probe(self):
        return self._probe

    @probe.setter
    def probe(self, value):
        self._probe._copy_from(value)

    @property
    def path(self):
        for index, panel in enumerate(frame.panels):
            if panel is self: return f"panels[{index}]"
        return "removed panel"

    def _check(self):
        if self.name not in _display_state and self.name not in _updates:
            raise ValueError("This panel is no longer available")
        if _updates.get(self.name, {}).get("action") == "remove":
            raise ValueError("This panel was removed")

    @property
    def data(self):
        self._check()
        pending = _updates.get(self.name, {})
        if pending.get("action") in ("clear", "reset", "remove"): return None
        state = _display_state.get(self.name, {})
        ids = pending.get("ids", state.get("ids", []))
        if ids: return _published.get(ids[0])
        reference = state.get("reference")
        return Variable._source(_Reference(**reference)) if reference else None

    def show(self, variable):
        self._check()
        if type(variable) is not Variable or variable.dtype.kind not in "biuf":
            raise TypeError("Show a Variable containing real numeric data")
        if any(n == 0 for n in variable.shape): raise ValueError("Plot data cannot be empty")
        previous = self.data
        if previous is None or previous.id != variable.id:
            _probe_updates[self.name] = dict(position=None, probe=None)
        _published[variable.id] = variable
        _updates[self.name] = dict(target=self.name, action="show", ids=[variable.id])
        return self

    def clear(self):
        self._check()
        _updates[self.name] = dict(target=self.name, action="clear")
        return self

    def reset(self):
        self._check()
        _updates[self.name] = dict(target=self.name, action="reset")
        return self

    def remove(self):
        self._check()
        if self.name == "panel1": raise ValueError("The main panel cannot be removed; clear or reset it")
        if self.name not in _display_state:
            _updates.pop(self.name, None)
            _panels.pop(self.name, None)
        else:
            _updates[self.name] = dict(target=self.name, action="remove")


class Plot:
    def __init__(self, panel, kind):
        self.panel, self.kind = panel, kind
        self.target = panel.name

    @property
    def path(self): return f"{self.panel.path}.{self.kind}"

    @property
    def data(self):
        if self.kind == "curve": return self.panel.probe.data
        return self.panel.data

    @property
    def visible(self):
        state = _display_state.get(self.target, {})
        return state.get("kind") == self.kind and state.get("visible", False)

    @property
    def range(self): return _display_state.get(self.target, {}).get("range", "automatic")

    @property
    def unit(self): return _display_state.get(self.target, {}).get("unit", "")

    def show(self, variable):
        self.panel.show(variable)
        return self

    def clear(self): return self.panel.clear()
    def reset(self): return self.panel.reset()


class PanelProbe:
    def __init__(self, panel):
        self.panel = panel

    def _state(self):
        self.panel._check()
        return {**_display_state.get(self.panel.name, {}), **_probe_updates.get(self.panel.name, {})}

    @staticmethod
    def _domain(variable):
        if variable._origin is None:
            return variable.id
        reference = _Reference(**variable._origin)
        return (reference.source, reference._meta.get("view_hint"), variable.dims, variable.shape, reference._selection)

    def _copy_from(self, other):
        self.panel._check()
        if other is None:
            self.clear()
            return
        if type(other) is not PanelProbe:
            raise TypeError("Assign another panel's probe or None")
        source_state = other._state()
        if source_state.get("position") is None:
            self.clear()
            return
        source, target = other.panel.data, self.panel.data
        if source is None or target is None:
            raise ValueError("Bind both panels before copying a probe")
        if self._domain(source) != self._domain(target):
            raise ValueError("Probe assignment requires the same source geometry and selection; use await probe.move() for another grid")
        state = deepcopy({key: source_state[key] for key in ("position", "probe", "selection")})
        query = self._state().get("probe")
        if query:
            state["probe"]["along"] = query["along"]
        state["selection"]["value"] = math.nan
        self._set(state)

    def _set(self, state):
        _probe_updates[self.panel.name] = state
        update = _updates.setdefault(self.panel.name, dict(target=self.panel.name, action="probe"))
        update["probe"] = state["selection"]

    @property
    def position(self):
        position = self._state().get("position")
        return dict(position) if position else None

    @property
    def data(self):
        variable = self.panel.data
        if variable is None: return None
        state = self._state()
        probe = state.get("probe")
        if not probe:
            if variable.ndim == 1 and not state.get("spatial", False): return variable
            return None
        along = probe["along"]
        if along not in variable.dims: raise ValueError("The probe's Along dimension is absent")
        indices = {dim: index for dim, index in probe["indices"].items() if dim in variable.dims and dim != along}
        average = probe.get("average")
        if not average: return variable.isel(indices)
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
        if geographic and (x is not None or y is not None):
            raise ValueError("Supply longitude/latitude or x/y, not both")
        if any(type(value) not in (int, float) or not math.isfinite(value) for value in position.values()):
            raise ValueError("Supply two finite probe coordinates")
        response = await js.ncx_move_probe(self.panel.name, json.dumps(position), updates(clear=False))
        resolved = json.loads(response)
        if "error" in resolved:
            raise ValueError(resolved["error"])
        self._set(resolved)
        return self

    def clear(self):
        self.panel._check()
        self._set(dict(position=None, probe=None, selection=None))



class PanelCollection:
    def __iter__(self):
        ids = dict.fromkeys([*_display_state, *_updates])
        return iter(tuple(_panels[key] for key in ids if _updates.get(key, {}).get("action") != "remove"))

    def __len__(self): return sum(1 for _ in self)
    def __getitem__(self, index): return tuple(self)[index]


class Frame:
    def __init__(self): self.panels = PanelCollection()

    def append(self, data=None):
        global _next_panel
        if len(self.panels) >= _LIMITS.get("panels", 16): raise MemoryError("Panel limit reached; remove an unused panel")
        name = f"panel{_next_panel}"
        _next_panel += 1
        panel = _panels[name] = Panel(name)
        _updates[name] = dict(target=name, action="append")
        if data is not None: panel.show(data)
        return panel


panel1 = _panels["panel1"] = Panel("panel1")
plots = panel1
frame = Frame()
panels = frame.panels
_display_state["panel1"] = {}


def configure(catalog_json, view_json, displays_json="{}", probe_json="null"):
    global _view_key, _view, _probe, _next_panel
    catalog, selection = json.loads(catalog_json), json.loads(view_json)
    for source in catalog: _sources[source["alias"]] = {v["path"]: v for v in source["metadata"]["variables"]}
    _probe = json.loads(probe_json)
    _probe_updates.clear()
    displays = json.loads(displays_json)
    if displays:
        _display_state.clear(); _display_state.update(displays)
        for name in set(_panels) - set(displays): del _panels[name]
        for name in displays:
            if name not in _panels: _panels[name] = Panel(name)
            _next_panel = max(_next_panel, int(name.removeprefix("panel")) + 1)
    sources = types.SimpleNamespace(**{name: Source(name) for name in _sources})
    if _view_key == view_json:
        _namespace.update(sources=sources, view=_view, np=np, Variable=Variable, Array=Variable, plots=plots, panel1=panel1, frame=frame, panels=panels)
        return
    view = View()
    for alias, item in selection.items():
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
    _namespace.update(sources=sources, view=view, np=np, Variable=Variable, Array=Variable,
                      plots=plots, panel1=panel1, frame=frame, panels=panels)
    _view_key, _view = view_json, view


def _mean_samples(*samples):
    return da.nanmean(da.stack(samples), axis=0)


def restore(key, payload):
    if key not in _published:
        value = cloudpickle.loads(bytes(payload.to_py()))
        if type(value) is not Variable: raise TypeError("Invalid expression")
        _published[key] = value


def retain(ids_json):
    ids = set(json.loads(ids_json))
    for key in list(_published):
        if key not in ids: del _published[key]


async def evaluate(key, selection_json, wire):
    variable = _published[key]
    selection = [s if isinstance(s, int) else slice(s["start"], s["stop"], s["stride"]) for s in json.loads(selection_json)]
    try:
        data = await evaluate_array(variable._build(tuple(selection)), _LIMITS)
    except BaseException as error:
        return dict(error=error_details(error, ""))
    result = np.ascontiguousarray(data, dtype=np.float64 if wire == "f64" else np.float32)
    return dict(values=memoryview(result).cast("B"), shape=list(data.shape), dtype="f64" if wire == "f64" else "f32")


from ncx_console import describe, members, complete_input, completion, error_details


def complete(code): return complete_input(_compiler, code)


async def execute(code, run):
    _updates.clear()
    _probe_updates.clear()
    filename = f"<steering-{run}>"
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    while len(linecache.cache) > _LIMITS["history"]: linecache.cache.pop(next(iter(linecache.cache)))
    try:
        result = await eval_code_async(code, globals=_namespace, filename=filename,
                                       return_mode="last_expr", quiet_trailing_semicolon=True)
        if result is not None: _namespace["_"] = result
        return dict(result=describe(result) if result is not None else None)
    except BaseException as error:
        _updates.clear()
        return dict(error=error_details(error, code))


def updates(clear=True):
    known = {key for state in _display_state.values() for key in state.get("ids", [])}
    result, size = [], 0
    commands = list(_updates.values())
    if clear: _updates.clear()
    for command in commands:
        update = {k: v for k, v in command.items() if k != "ids"}
        if command["action"] == "show":
            update["inputs"] = []
            for key in command["ids"]:
                if key in known:
                    update["inputs"].append(dict(id=key))
                    continue
                variable = _published[key]
                payload = cloudpickle.dumps(variable, protocol=5)
                coords = {dim: {**info, "values": memoryview(info["values"]).cast("B")} for dim, info in variable._coords.items()}
                size += len(payload) + sum(info["values"].nbytes for info in variable._coords.values())
                if size > _LIMITS["publishedBytes"]: raise MemoryError("Published expressions exceed the memory limit")
                update["inputs"].append(dict(expression=dict(id=key, payload=memoryview(payload),
                    shape=list(variable.shape), dims=list(variable.dims), name=variable.name,
                    unit=variable.unit, unit_kind=variable.unit_kind, origin=variable._origin,
                    coords=coords, summary=variable.expression)))
                known.add(key)
        result.append(update)
    return result


def outline():
    reserved = {"sources", "view", "np", "Variable", "Array", "plots", "panel1", "frame", "panels"}
    result = []
    for index, (name, value) in enumerate(_namespace.items()):
        if index >= _LIMITS["names"] + len(reserved) + 2: break
        if type(name) is not str or len(name) > 256 or name.startswith("_") or name in reserved: continue
        result.append(dict(name=name, **describe(value)))
    return result


def completions(code, cursor, force=False): return completion(_namespace, code, cursor, force)
`),o=a.pyimport(`ncx_runtime`),y(`configure`,JSON.stringify(t.catalog),`{}`),C(t.expressions);let f=new TextDecoder;a.setStdout({write(e){return v(f.decode(e,{stream:!0})),e.length}}),a.setStderr({write(e){return v(f.decode(e,{stream:!0}),`error`),e.length}}),i.postMessage({type:`ready`})}catch(e){i.postMessage({type:`failed`,error:String(e)})}return}if(t.type===`retain`){y(`retain`,JSON.stringify(t.ids));return}if(t.type===`complete`){try{C(t.expressions),y(`configure`,`[]`,JSON.stringify(t.view??{}),JSON.stringify(t.displays),JSON.stringify(t.probe??null)),i.postMessage({type:`completion`,id:t.id,completion:x(`completions`,t.code,t.cursor,t.force)})}catch{i.postMessage({type:`completion`,id:t.id,completion:{start:t.cursor,end:t.cursor,items:[],signature:``}})}return}if(t.type===`evaluate`){c=t.id;try{C([t.expression]);let e=b(await y(`evaluate`,t.expression.id,JSON.stringify(t.selection),t.wire));i.postMessage({type:`evaluated`,id:t.id,...e},S(e))}catch(e){i.postMessage({type:`evaluated`,id:t.id,error:{message:String(e),code:``}})}finally{c=void 0}return}if(t.type!==`submit`)return;s=t.run,d=0;let l=!1;try{if(!y(`complete`,t.code)){i.postMessage({type:`incomplete`,run:s});return}l=!0,C(t.expressions),y(`configure`,`[]`,JSON.stringify(t.view),JSON.stringify(t.displays),JSON.stringify(t.probe??null)),i.postMessage({type:`started`,run:s,code:t.code});let e=b(await y(`execute`,t.code,s));_();let n=x(`outline`),r=x(`updates`);i.postMessage({type:`done`,run:s,updates:r,names:n,...e},S(r))}catch(e){_(),i.postMessage({type:`done`,run:s,updates:[],names:l?x(`outline`):[],error:{message:String(e),code:t.code}})}}})();