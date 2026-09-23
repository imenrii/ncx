import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeMessage, PlotCommand, Expression, ObjectDescription } from "./model.ts";
import { metadataFixture } from "../../tests/fixtures.ts";
import { LIMITS } from "./model.ts";

Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://127.0.0.1/" } });
const { SteeringSession } = await import("./session.ts");
const { arraySource } = await import("../data/arrayData.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));

class WorkerDouble {
  static last: WorkerDouble;
  messages: any[] = [];
  onmessage?: (event: { data: RuntimeMessage }) => void;
  onerror?: (event: { message: string }) => void;
  terminated = false;
  constructor() { WorkerDouble.last = this; }
  postMessage(message: any) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(data: RuntimeMessage) { this.onmessage?.({ data }); }
}
Object.defineProperty(globalThis, "Worker", { configurable: true, value: WorkerDouble });

function field(target = "panel1"): PlotCommand {
  return { target, action: "show", input: { array: {
    dims: ["y", "x"], shape: [2, 2], unit: "m", unit_kind: "absolute", name: "Field",
    values: new Uint8Array(new Float64Array([1, 2, 3, 4]).buffer),
  } } };
}
async function open() {
  const session = new SteeringSession();
  session.configure([], 0, "test", { dataset: "test", path: "/v", kind: "field", display: { x: 1, y: 0 }, indices: {}, along: 0 });
  await session.open();
  const worker = WorkerDouble.last;
  worker.emit({ type: "ready" });
  return { session, worker };
}
async function send(session: InstanceType<typeof SteeringSession>, worker: WorkerDouble, commands: PlotCommand[], result?: ObjectDescription, afterReply?: () => void) {
  session.setInput("command");
  await session.submit();
  const message = worker.messages.findLast(message => message.type === "submit");
  worker.emit({ type: "done", run: message.run, updates: commands, names: [], result });
  afterReply?.();
}
async function ready(session: InstanceType<typeof SteeringSession>) {
  for (let i = 0; i < 50 && session.state !== "ready"; i++) await tick();
  assert.equal(session.state, "ready");
}

test("publication is atomic and failed admission never registers temporary datasets", async () => {
  const { session, worker } = await open();
  try {
    await send(session, worker, [field()]); await ready(session);
    const previous = session.panels[0];
    const binding = session.bindingFor(previous)!;
    assert.ok(arraySource(binding.metadata.dataset_id));
    const nextId = Number(binding.metadata.dataset_id!.split(":")[1]) + 1;
    const bad = field("panel3");
    (bad.input as any).array.shape = [2, 9];
    await send(session, worker, [field("panel2"), bad]); await ready(session);
    assert.equal(session.panels.length, 1);
    assert.equal(session.panels[0], previous);
    assert.equal(arraySource(`steering:${nextId}`), undefined);
    assert.match(session.log.at(-1)!.text, /byte count/);

    const expression: Expression = { id: "large", payload: new Uint8Array(LIMITS.publishedBytes), summary: "large",
      dims: ["y", "x"], shape: [2, 2], unit: "m", unit_kind: "absolute", name: "Large" };
    await send(session, worker, [{ target: "panel2", action: "show", input: { expression } }]); await ready(session);
    assert.equal(session.panels[0], previous);
    assert.equal(session.panels.length, 1);
    assert.match(session.log.at(-1)!.text, /memory limit/);
    assert.ok(arraySource(binding.metadata.dataset_id));
    await send(session, worker, [{ target: "panel1", action: "clear" }]); await ready(session);
    assert.equal(arraySource(binding.metadata.dataset_id), undefined);
  } finally { session.dispose(); }
});

test("a scientific edit rejects in-flight publication without replacing the current binding", async () => {
  const { session, worker } = await open();
  try {
    await send(session, worker, [field()]); await ready(session);
    const original = session.bindingFor(session.panels[0]);
    await send(session, worker, [field("panel2")], undefined, () =>
      session.setProbe({ x: 1, y: 1, indices: { x: 1, y: 1 }, value: 4 }));
    await ready(session);
    assert.equal(session.panels.length, 1);
    assert.equal(session.bindingFor(session.panels[0]), original);
    assert.match(session.log.at(-1)!.text, /View changed/);
  } finally { session.dispose(); }
});

test("editor changes reuse snapshots and do not remeasure stored log objects", async () => {
  const { session, worker } = await open();
  try {
    let measurements = 0;
    const result = { kind: "test", summary: "test", fields: [], toJSON() { measurements++; return { summary: "test" }; } };
    await send(session, worker, [], result); await ready(session);
    const displays = session.describeDisplays();
    const before = measurements;
    const configurations = worker.messages.filter(message => message.type === "configure").length;
    for (let i = 0; i < 20; i++) {
      session.setInput(`draft${i}`);
      const promise = session.complete("panels[0].", 10);
      const message = worker.messages.at(-1);
      worker.emit({ type: "completion", id: message.id, completion: { start: 0, end: 0, signature: "", items: [] } });
      await promise;
      assert.equal(session.describeDisplays(), displays);
    }
    assert.equal(measurements, before);
    assert.equal(worker.messages.filter(message => message.type === "configure").length, configurations);
  } finally { session.dispose(); }
});

test("evaluation timeout cancels its task and keeps an acknowledged worker alive", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { session, worker } = await open();
  try {
    const expression: Expression = { id: "slow", payload: new Uint8Array([1]), summary: "slow",
      dims: ["x"], shape: [2], unit: "m", unit_kind: "absolute", name: "Slow" };
    await send(session, worker, [{ target: "panel1", action: "show", input: { expression } }]); await ready(session);
    const binding = session.bindingFor(session.panels[0])!;
    const request = binding.read({ path: binding.variable.path, selection: [{ start: 0, stop: 2, stride: 1 }], wire: "f64" });
    const rejected = assert.rejects(request, /time limit/);
    await tick();
    const job = worker.messages.findLast(message => message.type === "evaluate");
    context.mock.timers.tick(LIMITS.runMs);
    assert.equal(worker.messages.at(-1).type, "cancel-evaluation");
    assert.equal(worker.terminated, false);
    worker.emit({ type: "evaluated", id: job.id, error: { message: "Cancelled", code: "" } });
    await rejected;
    context.mock.timers.tick(LIMITS.cancelMs);
    assert.equal(worker.terminated, false);
    assert.equal(session.state, "ready");
    assert.equal(session.bindingFor(session.panels[0]), binding);
  } finally { session.dispose(); context.mock.timers.reset(); }
});


test("snapshots keep fixed selectors separate from panel-owned probe indices", () => {
  const session = new SteeringSession();
  const metadata = metadataFixture("rectilinear");
  metadata.dataset_id = "source";
  const variable = metadata.variables.find(v => v.path === "/temperature")!;
  session.configure([{ id: "source", dataset: "source" }], 0, "test", {
    dataset: "source", path: variable.path, kind: "field", display: { x: 2, y: 1 }, along: 0,
    indices: { "/time": 0, "/lat": 0, "/lon": 0 },
  }, { metadata, variable });
  session.setProbe({ x: 114, y: 22, value: 1, indices: { "/lat": 2, "/lon": 3 } });
  const snapshot = session.describeDisplays().panel1;
  assert.deepEqual(snapshot.indices, { "/time": 0 });
  assert.deepEqual(snapshot.probe?.indices, { "/lat": 2, "/lon": 3 });
  session.dispose();
});
