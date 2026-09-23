"""Bounded, non-evaluating descriptions shared by Outline and completion."""
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
    if type(value) is runtime.Variable: result["objectId"] = value.id
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
    path = re.search(r'''([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\[(["'])([^"'\n]*)$''', before)
    try:
        if path:
            owner, quote, prefix = _resolve(namespace, path[1]), path[2], path[3]
            if type(owner) is not _runtime().Source: return result
            result["start"] = cursor - len(prefix)
            closing = after.find(quote)
            if closing >= 0 and after[closing + 1:closing + 2] == "]": result["end"] = cursor + closing + 2
            result["items"] = [dict(label=name, insert=name.replace("\\", "\\\\").replace(quote, "\\" + quote) + quote + "]", detail="source variable")
                               for name, variable in _runtime().WORKSPACE.sources[owner._alias].items()
                               if variable["capabilities"]["numeric"] and name.startswith(prefix)][:50]
            return result
        expression = r'''[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[(?:"[^"\n]*"|'[^'\n]*'|[0-9]+)\])*'''
        attribute = re.search(rf"({expression})\.([A-Za-z_]\w*)?$", before)
        prefix = re.search(r"(?<!\w)[A-Za-z_]\w*$", before)
        prefix = prefix[0] if prefix else ""
        result["start"] = cursor - len(prefix)
        suffix = re.match(r"\w*", after)[0]
        result["end"] = cursor + len(suffix)
        if attribute:
            choices = members(_resolve(namespace, attribute[1]))
            prefix = attribute[2] or ""
            result["start"] = cursor - len(prefix)
        else:
            choices = dict(islice(namespace.items(), 1000))
            choices.update(vars(builtins))
            choices.update({word: None for word in keyword.kwlist})
        call = re.search(rf"({expression})\(([^()]*)$", before)
        if call and not attribute:
            function = _resolve(namespace, call[1])
            signature, keywords = _signature(function)
            result["signature"] = signature
            if not prefix and not force and not before.endswith(("(", ",")): return result
            used = set(re.findall(r"\b(\w+)\s*=", call[2]))
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
        line, column, source = error.lineno, max(0, (error.offset or 1) - 1), (error.text or "").rstrip("\n")
    elif frame:
        line, source = frame.lineno, frame.line or ""
        raw = linecache.getline(frame.filename, line).rstrip("\n")
        column = len(raw.encode("utf-8")[:frame.colno or 0].decode("utf-8", "ignore").encode("utf-16-le")) // 2
        source = raw
    return dict(message=f"{type(error).__name__}: {str(error)[:2048]}", line=line, column=column,
                source=source[:4096], code=submitted, traceback="".join(trace.format())[:65536])
