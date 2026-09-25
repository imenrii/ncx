(function(){({name:`ncx-web`,private:!0,version:`0.1.0`,type:`module`,scripts:{dev:`vite`,build:`npm run style:check && tsc --noEmit && vite build && node scripts/copy-python.mjs`,test:`npm run style:check && node --test 'src/**/*.test.ts'`,"style:sync":`node scripts/sync-plot-style.mjs && node scripts/sync-components.mjs`,"style:check":`node scripts/sync-plot-style.mjs --check && node scripts/sync-components.mjs --check`},dependencies:{"@speed-highlight/core":`2.1.0`,pyodide:`314.0.7`,react:`^19.2.8`,"react-dom":`^19.2.8`},devDependencies:{"@types/react":`^19.2.18`,"@types/react-dom":`^19.2.4`,typescript:`^7.0.2`,vite:`^8.2.1`}}).dependencies.pyodide;let e={readBytes:33554432,blockBytes:4194304,publishedBytes:67108864,outputChars:65536,history:100,names:500,graphTasks:1e5,expressionDepth:64,expressionNodes:1e4,concurrentReads:4,cancelMs:1500,computeBytes:134217728,runMs:12e4,panels:16},t=(e,t=1,n=0,r=[],i=e)=>({id:e,label:i,scale:t,offset:n,aliases:[e,...r]}),n={pressure:[t(`Pa`,1,0,[`pascal`,`pascals`]),t(`hPa`,100),t(`mb`,100,0,[`mbar`,`millibar`]),t(`kPa`,1e3),t(`atm`,101325),t(`psi`,6894.757293168)],velocity:[t(`m/s`,1,0,[`m s-1`,`m s^-1`,`m s**-1`,`ms-1`],`m s⁻¹`),t(`km/h`,1/3.6,0,[`km h-1`,`km h^-1`,`kmh-1`],`km h⁻¹`),t(`mph`,.44704),t(`kt`,1852/3600,0,[`knot`,`knots`])],temperature:[t(`K`,1,0,[`kelvin`]),t(`°C`,1,273.15,[`degC`,`degree_Celsius`,`degrees_Celsius`,`Celsius`]),t(`°F`,5/9,255.3722222222222,[`degF`,`degree_Fahrenheit`,`Fahrenheit`])],length:[t(`m`,1,0,[`metre`,`meter`,`metres`,`meters`]),t(`km`,1e3),t(`ft`,.3048,0,[`feet`,`foot`])],water:[t(`m`),t(`mm`,.001),t(`in`,.0254)],fraction:[t(`1`,1,0,[`fraction`,`(0 - 1)`]),t(`%`,.01,0,[`percent`])],period:[t(`s`,1,0,[`second`,`seconds`]),t(`min`,60,0,[`minute`,`minutes`])],angle:[t(`degrees`,Math.PI/180,0,[`degree`,`deg`]),t(`rad`,1,0,[`radian`,`radians`])],energy:[t(`J/m2`,1,0,[`J m-2`,`J m**-2`,`J m^-2`],`J m⁻²`),t(`kJ/m2`,1e3,0,[`kJ m-2`],`kJ m⁻²`),t(`MJ/m2`,1e6,0,[`MJ m-2`],`MJ m⁻²`)],flux:[t(`W/m2`,1,0,[`W m-2`,`W m**-2`,`W m^-2`],`W m⁻²`),t(`kW/m2`,1e3,0,[`kW m-2`],`kW m⁻²`)],specificEnergy:[t(`J/kg`,1,0,[`J kg-1`,`J kg**-1`,`J kg^-1`],`J kg⁻¹`),t(`kJ/kg`,1e3,0,[`kJ kg-1`],`kJ kg⁻¹`)]};var r=[{file:`click-8.5.0-py3-none-any.whl`,sha256:`255bc9599cf7748b4b1a446ccc735421bd08a2ae529a8b88597d3de5664ee360`},{file:`cloudpickle-3.1.2-py3-none-any.whl`,sha256:`9acb47f6afd73f60dc1df93bb801b472f05ff42fa6c84167d25cb206be1fbf4a`},{file:`dask-2026.8.0-py3-none-any.whl`,sha256:`ccc0c83a189b0398602435189771d28dad7b5773b6089bb8dce14ae732dd782c`},{file:`fsspec-2026.7.0-py3-none-any.whl`,sha256:`b57ddbafedfaef7018c1ecab32aa200a9d7ca26b77965f64e48b70061249d279`},{file:`locket-1.0.0-py2.py3-none-any.whl`,sha256:`b6c819a722f7b6bd955b80781788e4a66a55628b858d347536b7e81325a3a5e3`},{file:`packaging-26.3-py3-none-any.whl`,sha256:`d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c`},{file:`partd-1.4.2-py3-none-any.whl`,sha256:`978e4ac767ec4ba5b86c6eaa52e5a2a3bc748a2ca839e8cc798f1cc6ce6efb0f`},{file:`toolz-1.1.0-py3-none-any.whl`,sha256:`15ccc861ac51c53696de0a5d6d4607f99c210739caf987b5d2054f3efed429d8`}];let i=self,a,o,s=0,c,l=!1,u=0,d=0,f=``,p=`output`,m,h=[],g=new Map;function _(){clearTimeout(m),m=void 0,f&&i.postMessage({type:`output`,run:s,kind:p,text:f}),f=``}function v(t,n=`output`){if(d>=e.outputChars)return;n!==p&&_(),p=n;let r=e.outputChars-d;d+=t.length,f+=t.slice(0,r),t.length>r&&(f+=`
Console output limit reached.
`),f.length>=4096?_():m??=setTimeout(_,50)}function y(e,...t){let n=o[e];try{return n(...t)}finally{n.destroy()}}function b(e){try{return e.toJs({dict_converter:Object.fromEntries})}finally{e.destroy()}}function x(e,...t){return b(y(e,...t))}function S(e,t=new Set){if(ArrayBuffer.isView(e))t.add(e.buffer);else if(e&&typeof e==`object`)for(let n of Object.values(e))S(n,t);return[...t]}function C(e=[]){for(let t of e)y(`restore`,t.id,t.payload)}i.onmessage=({data:e})=>{if(e.type===`read-result`||e.type===`probe-result`){let t=g.get(e.id);g.delete(e.id),e.type===`probe-result`?t?.resolve(JSON.stringify(e.error?{error:e.error}:e.result)):e.error?t?.reject(Error(e.error)):t?.resolve(e.slice);return}if(e.type===`cancel-evaluation`){let t=h.findIndex(t=>t.type===`evaluate`&&t.id===e.id);t>=0?(h.splice(t,1),i.postMessage({type:`evaluated`,id:e.id,error:{message:`Evaluation cancelled`,code:``}})):y(`cancel_evaluation`,e.id);for(let[t,n]of g)n.evaluation===e.id&&(n.reject(Error(`Evaluation cancelled`)),g.delete(t));return}h.push(e),w()};async function w(){if(!l){l=!0;try{for(;h.length;)await T(h.shift())}finally{l=!1}}}async function T(t){if(t.type===`init`){try{let{loadPyodide:l}=await import(`${t.runtimeURL}pyodide.mjs`);a=await l({indexURL:t.runtimeURL,packageBaseUrl:t.runtimeURL,stdin:()=>null}),await a.loadPackage([`numpy`,`pyyaml`]);let d=a.runPython(`__import__('site').getsitepackages()[0]`);for(let e of r){let n=await fetch(`${t.runtimeURL}${e.file}?sha256=${e.sha256}`);if(!n.ok)throw Error(`Cannot load ${e.file}`);a.unpackArchive(await n.arrayBuffer(),`zip`,{extractDir:d})}Object.assign(i,{ncx_move_probe:(e,t,n)=>{let r=++u,a=n.toJs({dict_converter:Object.fromEntries});return new Promise((n,o)=>{g.set(r,{resolve:n,reject:o}),i.postMessage({type:`move-probe`,id:r,run:s,target:e,position:JSON.parse(t),updates:a},S(a))})},ncx_read:async t=>{let n=++u;return new Promise((r,a)=>{if(g.size>=e.concurrentReads){a(Error(`Source read concurrency limit reached`));return}g.set(n,{resolve:r,reject:a,evaluation:c}),_(),i.postMessage({type:`read`,id:n,run:s,evaluation:c,reference:JSON.parse(t)})})},ncx_limits:JSON.stringify(e),ncx_units:JSON.stringify(n)}),a.FS.writeFile(`${d}/ncx_evaluation.py`,`"""Bounded asynchronous reads for the pinned Dask task format."""
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
        return result
    if type(value) in (runtime.Panel, runtime.PanelProbe):
        panel = value if type(value) is runtime.Panel else value.panel
        try: panel._check()
        except ValueError: return dict(status="removed")
    if type(value) is runtime.Panel:
        result = {"visible": value.visible, "range": value.range, "unit": value.unit, "data": value.data, "probe": value.probe, "show": value.show, "clear": value.clear, "reset": value.reset}
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
    if type(value) is runtime.Panel:
        result["target"] = value.name
        result["reference"] = value.path
    if type(value) is runtime.Variable:
        result["objectId"] = value.id
        result["variable"] = dict(name=value.name, dtype=str(value.dtype), shape=list(value.shape),
                                  derived=not value.__dict__.get("_read_only"))
    if type(value) is runtime.Source:
        result["fields"] = [dict(name="variables", value=str(len(runtime.WORKSPACE.sources[value._alias])))]
        return result
    if type(value) in (runtime.Variable, runtime.Panel, runtime.Frame, runtime.PanelProbe, np.ndarray):
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
                               for name, variable in _runtime().WORKSPACE.sources[owner._alias].items()
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
            raise AttributeError("Variable references are read-only; use isel to make a selection")
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
    """A scientific value; arithmetic records a new expression.

    Values, axes, and coordinates never change. A derived variable owns its
    name and unit labels; source lookups and displayed snapshots are read-only."""
    _LABELS = ("name", "unit", "unit_kind")

    def __setattr__(self, name, value):
        if name not in self.__dict__:
            return object.__setattr__(self, name, value)
        if self.__dict__.get("_read_only"):
            raise AttributeError("Source and displayed variables are read-only; derive one first, e.g. v = sources.s1[path].rename(...)")
        if name not in self._LABELS:
            raise AttributeError("Only name, unit, and unit_kind can change; assign a new expression")
        if name == "unit_kind" and value not in ("absolute", "delta"):
            raise ValueError("unit_kind must be absolute or delta")
        object.__setattr__(self, name, value if name == "unit_kind" else _text(value, name))
        object.__setattr__(self, "id", self._identity())

    def _identity(self):
        return _token(("ncx-variable-v2", self.token, self.dims, self.unit, self.unit_kind,
                       self.name, self._origin, self._coords))

    def _snapshot(self):
        """A read-only copy sharing this expression, so later relabelling cannot move a plot."""
        if self.__dict__.get("_read_only"): return self
        value = object.__new__(Variable)
        value.__dict__.update(self.__dict__, _read_only=True)
        return value

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
        self.id = self._identity()

    @classmethod
    def _make(cls, node, shape, dtype, dims, unit, name, unit_kind="absolute", origin=None, coords=None, expression="expression", token=None):
        value = object.__new__(cls)
        value._initialize(node, shape, dtype, dims, unit, name, unit_kind, origin, coords, expression, token, copy_coords=False)
        return value

    @classmethod
    def _source(cls, reference):
        value = cls._make(("source", reference), reference.shape, "float64", reference.dims,
                          reference.unit, reference.name, origin=reference._descriptor(),
                          expression=f"sources.{reference.source}[{reference.path!r}]")
        value._read_only = True
        return value

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
            raise TypeError("Variable values are read-only; assign the returned expression")
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
        variable = variable._snapshot()
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
                                          ref.name + " (area mean)", origin=ref._descriptor(), expression="area mean")._snapshot()
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
`),o=a.pyimport(`ncx_runtime`),C(t.expressions);let f=new TextDecoder;a.setStdout({write(e){return v(f.decode(e,{stream:!0})),e.length}}),a.setStderr({write(e){return v(f.decode(e,{stream:!0}),`error`),e.length}}),i.postMessage({type:`ready`})}catch(e){i.postMessage({type:`failed`,error:String(e)})}return}if(t.type===`retain`){y(`retain`,JSON.stringify(t.ids));return}if(t.type===`configure`){y(`configure`,JSON.stringify(t.snapshot),t.revision);return}if(t.type===`complete`){try{i.postMessage({type:`completion`,id:t.id,completion:x(`completions`,t.code,t.cursor,t.force)})}catch{i.postMessage({type:`completion`,id:t.id,completion:{start:t.cursor,end:t.cursor,items:[],signature:``}})}return}if(t.type===`evaluate`){c=t.id;try{C([t.expression]);let e=b(await y(`evaluate`,t.expression.id,JSON.stringify(t.selection),t.wire,t.id));i.postMessage({type:`evaluated`,id:t.id,...e},S(e))}catch(e){i.postMessage({type:`evaluated`,id:t.id,error:{message:String(e),code:``}})}finally{c=void 0}return}if(t.type!==`submit`)return;s=t.run,d=0;let l=!1;try{if(!y(`complete`,t.code)){i.postMessage({type:`incomplete`,run:s});return}l=!0,C(t.expressions),i.postMessage({type:`started`,run:s,code:t.code});let e=b(await y(`execute`,t.code,s));_();let n=x(`outline`),r=x(`updates`);i.postMessage({type:`done`,run:s,updates:r,names:n,...e},S(r))}catch(e){_(),i.postMessage({type:`done`,run:s,updates:[],names:l?x(`outline`):[],error:{message:String(e),code:t.code}})}}})();