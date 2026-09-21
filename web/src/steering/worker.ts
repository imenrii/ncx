/// <reference lib="webworker" />
import type { PyodideInterface } from "pyodide";
import python from "./runtime.py?raw";
import evaluation from "./evaluation.py?raw";
import consoleModule from "./console.py?raw";
import { LIMITS } from "./model";
import { UNIT_FAMILIES } from "../data/units";
import packages from "../../python/packages.json";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let py: PyodideInterface;
let runtime: any;
let run = 0;
let evaluationId: number | undefined;
let busy = false;
let nextRead = 0;
let outputChars = 0;
let outputBuffer = "";
let outputKind = "output";
let outputTimer: ReturnType<typeof setTimeout> | undefined;
const jobs: any[] = [];
const reads = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function flushOutput() {
  clearTimeout(outputTimer); outputTimer = undefined;
  if (outputBuffer) scope.postMessage({ type: "output", run, kind: outputKind, text: outputBuffer });
  outputBuffer = "";
}
function output(text: string, kind = "output") {
  if (outputChars >= LIMITS.outputChars) return;
  if (kind !== outputKind) flushOutput();
  outputKind = kind;
  const remaining = LIMITS.outputChars - outputChars;
  outputChars += text.length;
  outputBuffer += text.slice(0, remaining);
  if (text.length > remaining) outputBuffer += "\nConsole output limit reached.\n";
  if (outputBuffer.length >= 4096) flushOutput();
  else outputTimer ??= setTimeout(flushOutput, 50);
}
function call(name: string, ...args: unknown[]) {
  const fn = runtime[name];
  try { return fn(...args); } finally { fn.destroy(); }
}
function plainValue(value: any) {
  try { return value.toJs({ dict_converter: Object.fromEntries }); } finally { value.destroy(); }
}
function plain(name: string, ...args: unknown[]) { return plainValue(call(name, ...args)); }
function transfers(value: unknown, result = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) result.add(value.buffer as ArrayBuffer);
  else if (value && typeof value === "object") for (const item of Object.values(value)) transfers(item, result);
  return [...result];
}
function restore(expressions: { id: string; payload: Uint8Array }[] = []) {
  for (const value of expressions) call("restore", value.id, value.payload);
}

scope.onmessage = ({ data }) => {
  if (data.type === "read-result" || data.type === "probe-result") {
    const pending = reads.get(data.id);
    reads.delete(data.id);
    if (data.type === "probe-result") pending?.resolve(JSON.stringify(data.error ? { error: data.error } : data.result));
    else if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.slice);
    return;
  }
  jobs.push(data);
  void drain();
};

async function drain() {
  if (busy) return;
  busy = true;
  try { while (jobs.length) await process(jobs.shift()); }
  finally { busy = false; }
}

async function process(data: any) {
  if (data.type === "init") {
    try {
      const { loadPyodide } = await import(/* @vite-ignore */ `${data.runtimeURL}pyodide.mjs`);
      py = await loadPyodide({ indexURL: data.runtimeURL, packageBaseUrl: data.runtimeURL, stdin: () => null });
      await py.loadPackage(["numpy", "pyyaml"]);
      const site = py.runPython("__import__('site').getsitepackages()[0]");
      for (const item of packages) {
        const response = await fetch(`${data.runtimeURL}${item.file}?sha256=${item.sha256}`);
        if (!response.ok) throw new Error(`Cannot load ${item.file}`);
        py.unpackArchive(await response.arrayBuffer(), "zip", { extractDir: site });
      }
      const bridge = async (json: string) => {
        const id = ++nextRead;
        return new Promise((resolve, reject) => {
          if (reads.size) { reject(new Error("Only one source read can run at a time")); return; }
          reads.set(id, { resolve, reject });
          flushOutput();
          scope.postMessage({ type: "read", id, run, evaluation: evaluationId, reference: JSON.parse(json) });
        });
      };
      const moveProbe = (target: string, position: string, pending: any) => {
        const id = ++nextRead;
        // Python owns this argument proxy until the callback returns.
        const updates = pending.toJs({ dict_converter: Object.fromEntries });
        return new Promise((resolve, reject) => {
          reads.set(id, { resolve, reject });
          scope.postMessage({ type: "move-probe", id, run, target, position: JSON.parse(position), updates }, transfers(updates));
        });
      };
      Object.assign(scope, { ncx_move_probe: moveProbe, ncx_read: bridge, ncx_limits: JSON.stringify(LIMITS), ncx_units: JSON.stringify(UNIT_FAMILIES), ncx_instance: data.instance });
      py.FS.writeFile(`${site}/ncx_evaluation.py`, evaluation);
      py.FS.writeFile(`${site}/ncx_console.py`, consoleModule);
      py.FS.writeFile(`${site}/ncx_runtime.py`, python);
      runtime = py.pyimport("ncx_runtime");
      call("configure", JSON.stringify(data.catalog), "{}");
      restore(data.expressions);
      const decoder = new TextDecoder();
      py.setStdout({ write(bytes) { output(decoder.decode(bytes, { stream: true })); return bytes.length; } });
      py.setStderr({ write(bytes) { output(decoder.decode(bytes, { stream: true }), "error"); return bytes.length; } });
      scope.postMessage({ type: "ready" });
    } catch (error) { scope.postMessage({ type: "failed", error: String(error) }); }
    return;
  }
  if (data.type === "retain") { call("retain", JSON.stringify(data.ids)); return; }
  if (data.type === "complete") {
    try {
      restore(data.expressions);
      call("configure", "[]", JSON.stringify(data.view ?? {}), JSON.stringify(data.displays), JSON.stringify(data.probe ?? null));
      scope.postMessage({ type: "completion", id: data.id, completion: plain("completions", data.code, data.cursor, data.force) });
    } catch { scope.postMessage({ type: "completion", id: data.id, completion: { start: data.cursor, end: data.cursor, items: [], signature: "" } }); }
    return;
  }
  if (data.type === "evaluate") {
    evaluationId = data.id;
    try {
      restore([data.expression]);
      const value = plainValue(await call("evaluate", data.expression.id, JSON.stringify(data.selection), data.wire));
      scope.postMessage({ type: "evaluated", id: data.id, ...value }, transfers(value));
    } catch (error) { scope.postMessage({ type: "evaluated", id: data.id, error: { message: String(error), code: "" } }); }
    finally { evaluationId = undefined; }
    return;
  }
  if (data.type !== "submit") return;
  run = data.run; outputChars = 0;
  let accepted = false;
  try {
    if (!call("complete", data.code)) { scope.postMessage({ type: "incomplete", run }); return; }
    accepted = true;
    restore(data.expressions);
    call("configure", "[]", JSON.stringify(data.view), JSON.stringify(data.displays), JSON.stringify(data.probe ?? null));
    scope.postMessage({ type: "started", run, code: data.code });
    const result = plainValue(await call("execute", data.code, run));
    flushOutput();
    const names = plain("outline");
    const updates = plain("updates");
    scope.postMessage({ type: "done", run, updates, names, ...result }, transfers(updates));
  } catch (error) {
    flushOutput();
    scope.postMessage({ type: "done", run, updates: [], names: accepted ? plain("outline") : [], error: { message: String(error), code: data.code } });
  }
}
