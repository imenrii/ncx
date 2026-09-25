"""Run through steering-python.mjs with the pinned runtime."""
import json
import types
import numpy as np
import ncx_runtime as r

source = np.arange(3 * 5 * 7, dtype=np.float64).reshape(3, 5, 7)
source[1, 2, 3] = np.nan
reads = []

async def read(descriptor):
    selection = json.loads(descriptor)["selection"]
    slices = tuple(slice(s["start"], s["stop"], s["stride"]) if isinstance(s, dict) else s for s in selection)
    values = source[slices].copy()
    reads.append(values.size)
    return types.SimpleNamespace(values=types.SimpleNamespace(to_py=lambda: values))
r.ncx_read = read
variable = dict(path="/v", name="v", attributes=[dict(name="units", value="K")], capabilities=dict(numeric=True),
                dimensions=[dict(path="/"+name, name=name, length=length) for name, length in zip("xyz", source.shape)])
catalog = [dict(alias="s1", metadata=dict(variables=[variable]))]
def configure(panels):
    r.configure(json.dumps(dict(scope="test:1", catalog=catalog, panels=panels, view={})), r.WORKSPACE.revision + 1)
configure(dict(panel1={}))
t = r.WORKSPACE.namespace["sources"].s1["/v"]
original = t
t += 1.45
assert not reads
np.testing.assert_allclose(await t.compute(), source + 1.45, equal_nan=True)
np.testing.assert_allclose(await original.compute(), source, equal_nan=True)
assert t is not original
assert len(t) == 3
assert np.shape(t) == (3, 5, 7)
fraction, integer = np.modf(t)
assert type(fraction) is r.Variable and type(integer) is r.Variable
np.testing.assert_allclose(await fraction.compute(), np.modf(source + 1.45)[0], equal_nan=True)
try:
    bool(t)
    raise AssertionError("Implicit truth value was accepted")
except TypeError:
    pass
np.testing.assert_allclose(await t[0, 0, 1:4].compute(), source[0, 0, 1:4] + 1.45)
assert len(r.WORKSPACE.frame.panels) == 1

reads.clear()
chosen = (t * 2).isel({"x": 1, "y": 0, "z": slice(None, None, 2)})
np.testing.assert_allclose(await chosen.compute(), (source[1, 0, ::2] + 1.45) * 2)
assert sum(reads) == 4, reads
reads.clear()
centered = t - np.nanmean(t)
np.testing.assert_allclose(await centered.isel({"x": 0, "y": 0, "z": slice(1, 4)}).compute(),
                           source[0, 0, 1:4] - np.nanmean(source))
assert sum(reads) >= source.size
reads.clear()
await centered.isel({"x": 0, "y": 0, "z": slice(4, 7)}).compute()
assert sum(reads) == 3, reads

found = []
async for block in original.isel({"x": 1, "y": 0, "z": slice(None, None, 2)}).blocks():
    assert block.values.nbytes <= 24
    found.extend(block.values.flat)
np.testing.assert_equal(found, source[1, 0, ::2])

raw = np.arange(3.)
v = r.Variable(raw, dims=("x",), unit="m")
raw[:] = 999
np.testing.assert_allclose(await v.compute(), [0, 1, 2])
r.WORKSPACE.frame.panels[0].show(v)
payload = r.updates()[0]["input"]["expression"]["payload"]
v += 5
frozen = r.cloudpickle.loads(bytes(payload))
np.testing.assert_allclose(await frozen.compute(), [0, 1, 2])
np.testing.assert_allclose(await v.compute(), [5, 6, 7])

reads.clear()
reply = await r.execute('t = sources.s1["/v"]; t += 1.45; t', 1)
assert reply["result"]["kind"] == "Variable" and not reads
assert reply["result"]["fields"]
reply = await r.execute('1/0', 2)
assert reply["error"]["message"] == "ZeroDivisionError: division by zero"
assert reply["error"]["source"] == "1/0" and reply["error"]["line"] == 1
reply = await r.execute('r = (', 3)
assert reply["error"]["message"].startswith("SyntaxError")

r.WORKSPACE.namespace["v"] = v
for text, expected in [('sources.s1["/', '/v'), ('panels[0].sh', 'show'), ('v.com', 'compute'), ('np.mean(v, ax', 'axis=')]:
    items = r.completions(text, len(text))["items"]
    assert expected in [item["label"] for item in items], (text, items)
assert not r.completions('t += 1.45', 9)["items"]
assert not reads

class Dangerous:
    @property
    def value(self):
        raise AssertionError("Completion executed a getter")
r.WORKSPACE.namespace["danger"] = Dangerous()
r.completions('danger.va', 9)
r.completions('danger.value.', 13)
assert not reads
print("PASS: immutable arithmetic, lazy selection, global reduction, serialization, completion, safe inspection, concise errors")

huge_meta = dict(variable, path="/huge", dimensions=[dict(path="/x", name="x", length=10**12)])
r.WORKSPACE.sources["s1"]["/huge"] = huge_meta
huge = r.WORKSPACE.namespace["sources"].s1["/huge"] + 1.45
assert huge.shape == (10**12,) and not reads
try:
    await huge.compute()
    raise AssertionError("Oversized materialization was accepted")
except MemoryError:
    pass
assert not reads
print("PASS: very large variable arithmetic stays metadata-only and eager allocation is rejected")

reply = await r.execute('p = frame.append(sources.s1["/v"]); await p.probe.move(x=2, y=3); series = p.probe.data', 40)
assert "error" not in reply, reply
commands = r.updates()
assert commands[0]["target"] == "panel2" and "kind" not in commands[0]
assert commands[0]["probe"]["indices"] == {"/y": 2, "/z": 3}
np.testing.assert_allclose(await r.WORKSPACE.namespace["series"].compute(), source[:, 2, 3], equal_nan=True)
value = r.WORKSPACE.published[commands[0]["input"]["expression"]["id"]]
state = dict(panel1=dict(), panel2=dict(data=dict(id=value.id), domain="field", along="/x", indices={},
             probe=dict(x=2, y=3, value=0, indices={"/y":2,"/z":3})))
configure(state)
assert r.WORKSPACE.frame.panels[1] is r.WORKSPACE.namespace["p"]
reply = await r.execute('await p.probe.move(x=-1, y=0)', 41)
assert "error" in reply and r.WORKSPACE.namespace["p"].probe.position == dict(x=2, y=3)
reply = await r.execute('p.probe.clear(); assert p.probe.position is None; assert p.probe.data is None', 42)
assert "error" not in reply, reply
assert r.updates()[0]["probe"] is None
reply = await r.execute('p.remove()', 43)
assert r.updates()[0]["action"] == "remove"
configure(dict(panel1=dict()))
reply = await r.execute('p.show(v)', 44)
assert "no longer available" in reply["error"]["message"]
reply = await r.execute('frame.append(v); 1/0', 45)
assert "error" in reply and not r.updates()
assert len(r.WORKSPACE.frame.panels) == 1
reply = await r.execute('a = frame.append(v); b = frame.append(v)', 46)
commands = r.updates()
assert "expression" in commands[0]["input"]
assert commands[1]["input"] == dict(id=v.id)
assert any(item["label"] == "append" for item in r.completions('frame.ap', 8)["items"])
assert any(item["label"] == "probe" for item in r.completions('panels[0].pr', 12)["items"])
assert any(item["label"] == "move" for item in r.completions('panels[0].probe.mo', 18)["items"])
print("PASS: panel collection, one binding, editable probe handles, immutable probe data, rollback, identity reuse")

# Assignment must publish a selection change and retain the destination handle.
shifted = original + 10
r.WORKSPACE.published[original.id] = original
r.WORKSPACE.published[shifted.id] = shifted
selection = dict(indices={"/y": 2, "/z": 3}, x=2, y=3, value=0)
copy_state = dict(
    panel1=dict(data=dict(id=original.id), domain="field", probe=selection, along="/x", indices={}),
    panel2=dict(data=dict(id=shifted.id), domain="field", along="/x", indices={}),
)
configure(copy_state)
reads_before_copy = len(reads)
reply = await r.execute('handle = panels[1].probe; panels[1].probe = panels[0].probe; copied = panels[1].probe.data', 50)
assert "error" not in reply, reply
commands = r.updates()
assert len(commands) == 1 and commands[0]["target"] == "panel2", "Probe assignment did not publish a panel update"
assert len(reads) == reads_before_copy, "Copying a probe loaded numeric data"
assert r.WORKSPACE.frame.panels[1].probe is r.WORKSPACE.namespace["handle"], "Assignment replaced the destination probe handle"
np.testing.assert_allclose(await r.WORKSPACE.namespace["copied"].compute(), source[:, 2, 3] + 10, equal_nan=True)
assert commands[0]["probe"]["indices"] == selection["indices"]
print("PASS: probe assignment publishes the destination selection and keeps its data owner")

configure(copy_state)
reply = await r.execute('panels[1].probe = panels[0].probe; panels[0].probe.clear(); assert panels[1].probe.position == {"x": 2, "y": 3}', 51)
assert "error" not in reply, reply
commands = r.updates()
assert commands[0]["target"] == "panel2" and commands[1]["probe"] is None
configure(copy_state)
reply = await r.execute('panels[1].probe = panels[0].probe; 1/0', 52)
assert "error" in reply and not r.updates()
configure(copy_state)
assert r.WORKSPACE.frame.panels[1].probe.position is None
reply = await r.execute('panels[1].probe = (1, 2)', 53)
assert "TypeError" in reply["error"]["message"] and not r.updates()
reply = await r.execute('p = frame.append(panels[1].data); p.probe = panels[0].probe; assert p.probe.position == panels[0].probe.position', 54)
assert "error" not in reply, reply
assert r.updates()[0]["probe"]["indices"] == selection["indices"]
configure(copy_state)
reply = await r.execute('p = frame.append(panels[1].data.isel({"y": slice(1, 5)})); p.probe = panels[0].probe', 55)
assert "same source geometry" in reply["error"]["message"] and not r.updates()
reply = await r.execute('panels[0].probe = None; panels[1].probe = panels[0].probe', 56)
assert "error" not in reply, reply
assert all(command["probe"] is None for command in r.updates())
print("PASS: probe copies remain independent, validate their domain, and obey publication rollback")

# Numerical identity is independent of object allocation and display metadata.
assert (original + 1).id == (original + 1).id
assert (original + 1).id != (original + 2).id
assert original.rename("Renamed").token == original.token
assert original.rename("Renamed").id != original.id
assert r.Variable(np.array([1., 2.]), dims=("x",), unit="m").id == r.Variable(np.array([1., 2.]), dims=("x",), unit="m").id
assert r.Variable(np.array([1., 2.]), dims=("x",), unit="m").id != r.Variable(np.array([1., 3.]), dims=("x",), unit="m").id
np.testing.assert_allclose(await np.nanmean(original + 2).compute(), np.nanmean(source + 2))
from ncx_evaluation import _scalars
assert _scalars and all(key[0].startswith("ncx-scalar-") for key in _scalars)

chain = original
for i in range(r._LIMITS["expressionDepth"] - 1): chain = chain + 1
assert chain.depth == r._LIMITS["expressionDepth"]
try:
    chain + 1
    raise AssertionError("Unbounded expression depth was accepted")
except MemoryError:
    pass
np.testing.assert_allclose(await chain.compute(), source + chain.depth - 1, equal_nan=True)

configure(copy_state)
reply = await r.execute('panels[1].probe = panels[0].probe', 60)
assert "error" not in reply
pending = r.updates()
panels_before = r.WORKSPACE.panels
for _ in range(20):
    r.completions('panels[0].pr', 12)
    r.configure("invalid json must not be parsed", r.WORKSPACE.revision)
assert r.WORKSPACE.panels is panels_before and r.updates() == pending
assert all(name not in r.WORKSPACE.namespace for name in ("plots", "panel1", "Array"))
assert not hasattr(original, "probe") and not hasattr(r.WORKSPACE.frame.panels[0], "field")
print("PASS: content identity, explicit scalar keys, expression-depth admission, and read-only completion")

# Delay only the source transport to measure overlap without benchmarking NumPy.
import asyncio
import time
active_reads = peak_reads = 0
async def delayed_read(descriptor):
    global active_reads, peak_reads
    active_reads += 1
    peak_reads = max(peak_reads, active_reads)
    try:
        await asyncio.sleep(0.01)
        return await read(descriptor)
    finally:
        active_reads -= 1
r.ncx_read = delayed_read
read_limit = r._LIMITS["concurrentReads"]
timings = []
for concurrency in (1, read_limit):
    r._LIMITS["concurrentReads"] = concurrency
    peak_reads = 0
    started = time.perf_counter()
    actual = await original.compute()
    timings.append((time.perf_counter() - started) * 1000)
    np.testing.assert_allclose(actual, source, equal_nan=True)
    assert peak_reads == concurrency, (peak_reads, concurrency)
    assert active_reads == 0
assert timings[1] < timings[0] * .8, timings
r._LIMITS["concurrentReads"] = read_limit
r.WORKSPACE.published[original.id] = original
selection_json = json.dumps([dict(start=0, stop=n, stride=1) for n in source.shape])
job = asyncio.create_task(r.evaluate(original.id, selection_json, "f64", 700))
await asyncio.sleep(.005)
r.cancel_evaluation(700)
reply = await job
assert "CancelledError" in reply["error"]["message"] and active_reads == 0
assert not r.WORKSPACE.evaluations
r.ncx_read = read
np.testing.assert_allclose(await original.compute(), source, equal_nan=True)
print(f"PASS: bounded source reads overlap ({timings[0]:.0f} → {timings[1]:.0f} ms); cancellation preserves the workspace")

# Computing a resident/scalar result must not expose buffers used by content caches.
resident = r.Variable(np.array([1., 2.]), dims=("x",), unit="m")
detached = await resident.compute()
detached[:] = 99
np.testing.assert_allclose(await resident.compute(), [1, 2])
try:
    resident.values.flags.writeable = True
    raise AssertionError("Resident storage became mutable")
except ValueError:
    pass
scalar = await np.nanmean(original).compute()
scalar[...] = 999
np.testing.assert_allclose(await np.nanmean(original).compute(), np.nanmean(source))

def forbid_source_pickle(self, protocol):
    raise AssertionError("Dask tried to pickle a source descriptor for its token")
r._SourceArray.__reduce_ex__ = forbid_source_pickle
try:
    np.testing.assert_allclose(await (original + 1).compute(), source + 1, equal_nan=True)
finally:
    del r._SourceArray.__reduce_ex__
print("PASS: detached results preserve content-cache values; source builds do not pickle-tokenize descriptors")


budget = r._LIMITS["computeBytes"]
reads.clear()
r._LIMITS["computeBytes"] = 16
try:
    await original.compute()
    raise AssertionError("Unreserved source buffers were accepted")
except MemoryError:
    assert not reads
finally:
    r._LIMITS["computeBytes"] = budget

# Shared operands count once at each node; identical inputs must not create an exponential estimate.
doubled = original
for _ in range(20): doubled = doubled + doubled
assert doubled.nodes == 21
old_id = original.id
old_workspace = r.WORKSPACE
try:
    r.WORKSPACE = r.Workspace()
    r.configure(json.dumps(dict(scope="different-source-generation", catalog=catalog, panels={"panel1": {}}, view={})), 0)
    assert r.WORKSPACE.namespace["sources"].s1["/v"].id != old_id
finally:
    r.WORKSPACE = old_workspace
print("PASS: source admission precedes reads, shared nodes stay bounded, and identities include source generation")

u = r.WORKSPACE.namespace["sources"].s1["/v"]
for name, value in (("name", "new"), ("unit", "m")):
    try:
        setattr(u, name, value)
        raise AssertionError("A source variable accepted a label")
    except AttributeError:
        pass
u1 = u + 1
token, before = u1.token, u1.id
u1.name, u1.unit, u1.unit_kind = "new", "m", "delta"
assert (u1.name, u1.unit, u1.unit_kind, u1.token) == ("new", "m", "delta", token) and u1.id != before
assert u.name == "v" and u.unit == "K"
for name, value in (("shape", (1,)), ("dims", ("a",)), ("unit_kind", "other"), ("name", 1)):
    try:
        setattr(u1, name, value)
        raise AssertionError(f"A derived variable accepted {name}={value!r}")
    except (AttributeError, ValueError):
        pass
u.rename("u").name = "renamed"
u.isel({"x": 0}).name = "selected"
configure(dict(panel1=dict()))
r.WORKSPACE.frame.panels[0].show(u1)
shown = r.WORKSPACE.published[u1.id]
u1.name = "later"
assert shown is not u1 and shown.name == "new" and r.WORKSPACE.published[shown.id] is shown
r.WORKSPACE.namespace.update(u=u, u1=u1)
names = {item["name"]: item for item in r.outline()}
assert names["u1"]["variable"]["derived"] and not names["u"]["variable"]["derived"]
print("PASS: derived labels change, source and displayed variables stay read-only")
