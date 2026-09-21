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
r.configure(json.dumps([dict(alias="s1", metadata=dict(variables=[variable]))]), "{}")
t = r._namespace["sources"].s1["/v"]
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
assert r.plots.curve is r.panel1.curve
assert len(r.frame.panels) == 1

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
r.plots.curve.show(v)
payload = r.updates()[0]["inputs"][0]["expression"]["payload"]
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

r._namespace["v"] = v
for text, expected in [('sources.s1["/', '/v'), ('panel1.cu', 'curve'), ('v.com', 'compute'), ('np.mean(v, ax', 'axis=')]:
    items = r.completions(text, len(text))["items"]
    assert expected in [item["label"] for item in items], (text, items)
assert not r.completions('t += 1.45', 9)["items"]
assert not reads

class Dangerous:
    @property
    def value(self):
        raise AssertionError("Completion executed a getter")
r._namespace["danger"] = Dangerous()
r.completions('danger.va', 9)
r.completions('danger.value.', 13)
assert not reads
print("PASS: immutable arithmetic, lazy selection, global reduction, serialization, completion, safe inspection, concise errors")

huge_meta = dict(variable, path="/huge", dimensions=[dict(path="/x", name="x", length=10**12)])
r._sources["s1"]["/huge"] = huge_meta
huge = r._namespace["sources"].s1["/huge"] + 1.45
assert huge.shape == (10**12,) and not reads
try:
    await huge.compute()
    raise AssertionError("Oversized materialization was accepted")
except MemoryError:
    pass
assert not reads
print("PASS: very large variable arithmetic stays metadata-only and eager allocation is rejected")

probe = dict(source="s1", path="/v", along="/x", indices={"/x": 0, "/y": 2, "/z": 3})
r.configure("[]", "{}", probe_json=json.dumps(probe))
reads.clear()
series = original.probe
assert series.shape == (3,) and not reads
np.testing.assert_allclose(await series.compute(), source[:, 2, 3], equal_nan=True)
assert sum(reads) == 3
speed = np.hypot(original, original * 2).rename("Magnitude")
assert speed.unit == "K" and speed.name == "Magnitude"
np.testing.assert_allclose(await speed.probe.compute(), np.hypot(source[:, 2, 3], source[:, 2, 3] * 2), equal_nan=True)
r.configure("[]", "{}", probe_json=json.dumps(dict(probe, indices={"/x": 0, "/y": 4, "/z": 1})))
np.testing.assert_allclose(await series.compute(), source[:, 2, 3], equal_nan=True)
try:
    original.isel({"y": 0}).probe
    raise AssertionError("Probe escaped a selected domain")
except ValueError:
    pass
r._sources["s1"]["/surface"] = dict(variable, path="/surface", dimensions=[variable["dimensions"][0], variable["dimensions"][2]])
r.configure("[]", "{}", probe_json=json.dumps(dict(probe, path="/surface", indices={"/z": 3})))
np.testing.assert_allclose(await original.isel({"y": 2}).probe.compute(), source[:, 2, 3], equal_nan=True)
try:
    original.probe
    raise AssertionError("An extra dimension was selected implicitly")
except ValueError as error:
    assert "isel" in str(error)
area = dict(probe, indices={"/x": 0, "/y": 0, "/z": 1}, average=dict(dimension="/y", indices=[0, 4]))
r.configure("[]", "{}", probe_json=json.dumps(area))
u, w = original, original * -1 + 50
first = await np.hypot(u.probe, w.probe).compute()
second = await np.hypot(u, w).probe.compute()
np.testing.assert_allclose(first, np.hypot(np.mean(source[:, [0, 4], 1], axis=1), np.mean(50-source[:, [0, 4], 1], axis=1)))
np.testing.assert_allclose(second, np.mean(np.hypot(source[:, [0, 4], 1], 50-source[:, [0, 4], 1]), axis=1))
assert not np.allclose(first, second)

reply = await r.execute('p = frame.append(sources.s1["/v"]); await p.probe.move(x=2, y=3); series = p.probe.data', 40)
assert "error" not in reply, reply
commands = r.updates()
assert commands[0]["target"] == "panel2" and "kind" not in commands[0]
assert commands[0]["probe"]["indices"] == {"/y": 2, "/z": 3}
np.testing.assert_allclose(await r._namespace["series"].compute(), source[:, 2, 3], equal_nan=True)
value = r._published[commands[0]["inputs"][0]["expression"]["id"]]
state = dict(panel1=dict(), panel2=dict(ids=[value.id], spatial=True,
             position=dict(x=2, y=3), probe=dict(indices={"/y":2,"/z":3}, along="/x")))
r.configure("[]", "{}", json.dumps(state))
assert r.panels[1] is r._namespace["p"]
reply = await r.execute('await p.probe.move(x=-1, y=0)', 41)
assert "error" in reply and r._namespace["p"].probe.position == dict(x=2, y=3)
reply = await r.execute('p.probe.clear(); assert p.probe.position is None; assert p.probe.data is None', 42)
assert "error" not in reply, reply
assert r.updates()[0]["probe"] is None
reply = await r.execute('p.remove()', 43)
assert r.updates()[0]["action"] == "remove"
r.configure("[]", "{}", json.dumps(dict(panel1=dict())))
reply = await r.execute('p.show(v)', 44)
assert "no longer available" in reply["error"]["message"]
reply = await r.execute('frame.append(v); 1/0', 45)
assert "error" in reply and not r.updates()
assert len(r.frame.panels) == 1
reply = await r.execute('a = frame.append(v); b = frame.append(v)', 46)
commands = r.updates()
assert "expression" in commands[0]["inputs"][0]
assert commands[1]["inputs"] == [dict(id=v.id)]
assert any(item["label"] == "append" for item in r.completions('frame.ap', 8)["items"])
assert any(item["label"] == "probe" for item in r.completions('panels[0].pr', 12)["items"])
assert any(item["label"] == "move" for item in r.completions('panels[0].probe.mo', 18)["items"])
print("PASS: panel collection, one binding, editable probe handles, immutable probe data, rollback, identity reuse")

# Assignment must publish a selection change and retain the destination handle.
shifted = original + 10
r._published[original.id] = original
r._published[shifted.id] = shifted
selection = dict(indices={"/y": 2, "/z": 3}, x=2, y=3, value=0)
copy_state = dict(
    panel1=dict(ids=[original.id], spatial=True, selection=selection, position=dict(x=2, y=3),
                probe=dict(indices=selection["indices"], along="/x")),
    panel2=dict(ids=[shifted.id], spatial=True),
)
r.configure("[]", "{}", json.dumps(copy_state))
reads_before_copy = len(reads)
reply = await r.execute('handle = panels[1].probe; panels[1].probe = panels[0].probe; copied = panels[1].probe.data', 50)
assert "error" not in reply, reply
commands = r.updates()
assert len(commands) == 1 and commands[0]["target"] == "panel2", "Probe assignment did not publish a panel update"
assert len(reads) == reads_before_copy, "Copying a probe loaded numeric data"
assert r.panels[1].probe is r._namespace["handle"], "Assignment replaced the destination probe handle"
np.testing.assert_allclose(await r._namespace["copied"].compute(), source[:, 2, 3] + 10, equal_nan=True)
assert commands[0]["probe"]["indices"] == selection["indices"]
print("PASS: probe assignment publishes the destination selection and keeps its data owner")

r.configure("[]", "{}", json.dumps(copy_state))
reply = await r.execute('panels[1].probe = panels[0].probe; panels[0].probe.clear(); assert panels[1].probe.position == {"x": 2, "y": 3}', 51)
assert "error" not in reply, reply
commands = r.updates()
assert commands[0]["target"] == "panel2" and commands[1]["probe"] is None
r.configure("[]", "{}", json.dumps(copy_state))
reply = await r.execute('panels[1].probe = panels[0].probe; 1/0', 52)
assert "error" in reply and not r.updates()
r.configure("[]", "{}", json.dumps(copy_state))
assert r.panels[1].probe.position is None
reply = await r.execute('panels[1].probe = (1, 2)', 53)
assert "TypeError" in reply["error"]["message"] and not r.updates()
reply = await r.execute('p = frame.append(panels[1].data); p.probe = panels[0].probe; assert p.probe.position == panels[0].probe.position', 54)
assert "error" not in reply, reply
assert r.updates()[0]["probe"]["indices"] == selection["indices"]
r.configure("[]", "{}", json.dumps(copy_state))
reply = await r.execute('p = frame.append(panels[1].data.isel({"y": slice(1, 5)})); p.probe = panels[0].probe', 55)
assert "same source geometry" in reply["error"]["message"] and not r.updates()
reply = await r.execute('panels[0].probe = None; panels[1].probe = panels[0].probe', 56)
assert "error" not in reply, reply
assert all(command["probe"] is None for command in r.updates())
print("PASS: probe copies remain independent, validate their domain, and obey publication rollback")
