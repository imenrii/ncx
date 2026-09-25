import { fetchMetadata, fetchSlice } from "../data/api.ts";
import { AsyncByteCache } from "../data/cache.ts";
import { arrayBytes, registerArraySource } from "../data/arrayData.ts";
import type { DataSlice, SliceRequest, Source, Probe, Metadata, Variable } from "../data/model.ts";
import { curveSelection } from "../plots/curveSeries.ts";
import { attributeText } from "../data/model.ts";
import { comparisonFieldSelection } from "../data/selection.ts";
import { bindInput, readReference, validateField, suppliedCatalog } from "./data.ts";
import { hasField, hasFieldView, timeCoordinate, curveAlong, curveSelection as selectCurve, fieldIndices, probePosition, readCurve, resolveProbe } from "./panelData.ts";
import { LIMITS, PYODIDE_VERSION, type PanelState, type Binding, type CatalogSource, type Completion, type ConsoleError, type Displays, type Expression, type LogEntry, type OutlineName, type PlotCommand, type RuntimeMessage, type ViewSelection, type WorkspaceSnapshot } from "./model.ts";

let nextInstance = 0;

export class SteeringSession {
  private listeners = new Set<() => void>();
  private version = 0;
  private readonly instance = ++nextInstance;
  private workspaceRevision = 0;
  private sentRevision = -1;
  private displayCache?: Displays;
  private presentation: { range: string; unit: string } = { range: "automatic", unit: "" };
  private registrations = new Map<Binding, () => void>();
  private logBytes = 0;
  private worker?: Worker;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private identity = "";
  private epoch = 0;
  private run = 0;
  private logId = 0;
  private requestId = 0;
  private knownExpressions = new Set<string>();
  private completionRequest?: { id: number; resolve: (value?: Completion) => void };
  private evaluations = new Map<number, { request: SliceRequest; abort: AbortController; resolve: (slice: DataSlice) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private active?: { id: number; epoch: number; selection: string; revisions: number; code: string };
  private aliases = new Map<string, string>();
  private aliasNumber = 0;
  private sources: readonly Source[] = [];
  private supplied: (() => void)[] = [];
  private catalogRequest = 0;
  private revision = 0;
  private defaultBinding?: Binding;
  private curveCache = new AsyncByteCache<import("../plots/curveSeries.ts").CurveSeries>(LIMITS.readBytes / 2,
    curve => curve.x.byteLength + curve.y.byteLength);
  private loadedFields = new Map<string, string>();
  timestamp?: number;
  private evaluated = new AsyncByteCache<DataSlice>(LIMITS.readBytes, slice => slice.values.byteLength);
  catalog: CatalogSource[] = [];
  names: OutlineName[] = [];
  log: LogEntry[] = [];
  history: string[] = [];
  input = "";
  state: "closed" | "loading" | "ready" | "busy" | "failed" = "closed";
  selection?: ViewSelection;
  panels: PanelState[] = [
    { id: "panel1", intent: { kind: "default" } },
  ];
  bindingFor(panel: PanelState): Binding | undefined {
    return panel.intent.kind === "data" ? panel.intent.binding
      : panel.id === "panel1" && panel.intent.kind === "default" ? this.defaultBinding : undefined;
  }
  fieldKey(panel: PanelState): string {
    const binding = this.bindingFor(panel);
    const selection = panel.intent.kind === "default" ? this.selection?.indices
      : binding && timeCoordinate(binding) ? this.timestamp : undefined;
    return JSON.stringify([binding?.metadata.dataset_id, binding?.variable.path, selection]);
  }
  fieldLoaded(id: string, key: string) {
    if (this.loadedFields.get(id) === key) return;
    this.loadedFields.set(id, key);
    this.notify();
  }
  get fieldsReady(): boolean {
    return this.panels.every(panel => {
      const binding = this.bindingFor(panel);
      return !binding || !hasField(binding) || this.loadedFields.get(panel.id) === this.fieldKey(panel);
    });
  }
  async indicesFor(panel: PanelState): Promise<Record<string, number>> {
    const binding = this.bindingFor(panel);
    if (!binding) throw new Error("Panel data is unavailable");
    return fieldIndices(binding, this.timestamp, panel.intent.kind === "default" ? this.selection?.indices : undefined);
  }
  async curveFor(panel: PanelState, indices: Record<string, number>, signal: AbortSignal) {
    const binding = this.bindingFor(panel);
    if (!binding) return undefined;
    const selection = selectCurve(binding, panel, indices);
    if (!selection) return undefined;
    const key = JSON.stringify([binding.metadata.dataset_id, binding.variable.path, selection, panel.probe?.average]);
    const curve = await this.curveCache.load(key, abort => readCurve(binding, selection, panel.probe?.average, abort));
    signal.throwIfAborted();
    return curve;
  }
  get bindings(): Binding[] {
    return [...new Set(this.panels.flatMap(p => p.intent.kind === "data" ? [p.intent.binding] : []))];
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  private notify() {
    this.version++;
    this.listeners.forEach(listener => listener());
  }
  private workspaceChanged() {
    this.workspaceRevision++;
    this.displayCache = undefined;
  }
  setPresentation(range: string, unit: string) {
    if (this.presentation.range === range && this.presentation.unit === unit) return;
    this.presentation = { range, unit };
    this.workspaceChanged();
    this.notify();
  }
  setInput(value: string) { this.input = value.slice(0, LIMITS.outputChars); this.notify(); }
  clearLog() { this.log = []; this.logBytes = 0; this.notify(); }
  private measureLog(entry: Pick<LogEntry, "text" | "error" | "object">): number {
    return entry.text.length + (entry.error ? JSON.stringify(entry.error).length : 0)
      + (entry.object ? JSON.stringify(entry.object).length : 0);
  }
  private trimLog() {
    while (this.log.length > 1 && (this.logBytes > LIMITS.outputChars || this.log.length > 200)) {
      this.logBytes -= this.log.shift()!.bytes;
    }
  }
  private addLog(entry: Omit<LogEntry, "id" | "bytes">) {
    const bytes = this.measureLog(entry);
    this.log.push({ ...entry, id: ++this.logId, bytes });
    this.logBytes += bytes;
    this.trimLog();
    this.notify();
  }
  private append(kind: LogEntry["kind"], text: string) {
    const last = this.log.at(-1);
    if (kind !== "command" && last?.kind === kind && !last.error && !last.object) {
      this.logBytes -= last.bytes;
      last.text = (last.text + text).slice(-LIMITS.outputChars);
      last.bytes = this.measureLog(last);
      this.logBytes += last.bytes;
      this.trimLog();
      this.notify();
    } else this.addLog({ kind, text: text.slice(0, LIMITS.outputChars) });
  }
  reportError(error: ConsoleError) {
    error = { ...error, traceback: error.traceback?.slice(0, 16 * 1024) };
    this.addLog({ kind: "error", text: error.message, error });
  }
  describeDisplays(): Displays {
    if (this.displayCache) return this.displayCache;
    this.displayCache = Object.fromEntries(this.panels.map(panel => {
      const binding = this.bindingFor(panel);
      const page = this.selection?.kind === "curve" ? "curve" : "field";
      const domain = !binding ? "empty" : !binding.variable.dimensions.length ? "scalar"
        : hasField(binding) ? "field" : "curve";
      const eligible = page === "field" ? domain === "field" || domain === "scalar"
        : domain === "curve" || domain === "field" && Boolean(panel.probe);
      const preferred = panel.intent.kind === "default" && binding
        ? binding.variable.dimensions[this.selection?.along ?? 0]?.path : undefined;
      const spatialPaths = panel.intent.kind === "default" && binding
        ? [this.selection?.display.x, this.selection?.display.y].flatMap(axis => axis === undefined ? [] : [binding.variable.dimensions[axis]?.path]) : [];
      const fixed = panel.intent.kind === "default" ? Object.fromEntries(
        Object.entries(this.selection?.indices ?? {}).filter(([path]) => !spatialPaths.includes(path))) : {};
      return [panel.id, {
        kind: page, domain,
        visible: this.selection?.kind !== "metadata" && eligible,
        range: panel.id === "panel1" ? this.presentation.range : "automatic",
        unit: panel.id === "panel1" ? this.presentation.unit : binding ? attributeText(binding.variable, "units") ?? "" : "",
        data: binding?.expression ? { id: binding.expression.id } : binding?.origin ? { reference: binding.origin } : undefined,
        along: binding ? curveAlong(binding, preferred) : undefined,
        indices: fixed,
        probe: panel.probe,
      }];
    }));
    return this.displayCache;
  }
  private configureWorker() {
    if (!this.worker || this.sentRevision === this.workspaceRevision) return;
    const snapshot: WorkspaceSnapshot = {
      scope: `${this.instance}:${this.epoch}`,
      ...(this.sentRevision < 0 ? { catalog: this.catalog } : {}),
      panels: this.describeDisplays(), view: this.viewReferences(),
    };
    this.worker.postMessage({ type: "configure", revision: this.workspaceRevision, snapshot });
    this.sentRevision = this.workspaceRevision;
  }
  private expressionInputs(): Expression[] {
    return [...new Map(this.bindings.flatMap(b => b.expression ? [[b.expression.id, b.expression] as const] : [])).values()];
  }
  private retainExpressions() {
    const ids = this.expressionInputs().map(input => input.id);
    this.knownExpressions = new Set(ids);
    this.worker?.postMessage({ type: "retain", ids });
  }
  complete(code: string, cursor: number, force = false): Promise<Completion | undefined> {
    this.completionRequest?.resolve();
    if (this.state !== "ready" || !this.worker) return Promise.resolve(undefined);
    this.configureWorker();
    const id = ++this.requestId;
    return new Promise(resolve => {
      this.completionRequest = { id, resolve };
      this.worker!.postMessage({ type: "complete", id, code, cursor, force });
    });
  }
  private evaluateExpression = async (expression: Expression, request: SliceRequest, signal?: AbortSignal): Promise<DataSlice> => {
    signal?.throwIfAborted();
    const key = JSON.stringify([expression.id, request.selection, request.wire ?? "f32"]);
    const slice = await this.evaluated.load(key, abort => this.computeExpression(expression, request, abort));
    signal?.throwIfAborted();
    return { ...slice, request };
  };
  private computeExpression = (expression: Expression, request: SliceRequest, signal?: AbortSignal): Promise<DataSlice> => {
    if (!this.worker || this.state === "loading") return Promise.reject(new Error("Start Python to evaluate this plot"));
    if (this.evaluations.size >= LIMITS.panels * 2) return Promise.reject(new Error("Plot evaluation is busy; retry shortly"));
    signal?.throwIfAborted();
    const id = ++this.requestId;
    const abort = new AbortController();
    signal?.addEventListener("abort", () => this.cancelEvaluation(id, new DOMException("Evaluation cancelled", "AbortError")),
      { once: true, signal: abort.signal });
    this.state = "busy";
    const promise = new Promise<DataSlice>((resolve, reject) => {
      const timer = setTimeout(() => this.cancelEvaluation(id, new Error("Plot evaluation exceeded the time limit")), LIMITS.runMs);
      this.evaluations.set(id, { request, abort, resolve, reject, timer });
      const payload = this.knownExpressions.has(expression.id) ? { id: expression.id } : expression;
      this.knownExpressions.add(expression.id);
      this.worker!.postMessage({ type: "evaluate", id, expression: payload, selection: request.selection, wire: request.wire ?? "f32" });
    });
    this.notify();
    return promise;
  };
  private cancelEvaluation(id: number, reason: Error) {
    const job = this.evaluations.get(id);
    if (!job || job.abort.signal.aborted) return;
    job.abort.abort();
    clearTimeout(job.timer);
    job.reject(reason);
    this.worker?.postMessage({ type: "cancel-evaluation", id });
    // A worker blocked inside synchronous NumPy cannot service cancellation messages.
    job.timer = setTimeout(() => {
      if (!this.evaluations.has(id)) return;
      this.stop(false);
      this.append("error", "Python did not respond to cancellation. Workspace reset.\n");
    }, LIMITS.cancelMs);
  }
  configure(sources: readonly Source[], unitRevision: number, scope: string, selection?: ViewSelection, data?: { metadata: Metadata; variable: Variable }) {
    for (const source of sources) if (!this.aliases.has(source.id)) this.aliases.set(source.id, `s${++this.aliasNumber}`);
    const defaultChanged = data && (this.defaultBinding?.variable !== data.variable || this.defaultBinding.metadata !== data.metadata);
    if (defaultChanged) {
      const previous = this.defaultBinding;
      const sameSelection = previous?.metadata.dataset_id === data.metadata.dataset_id && previous.variable.path === data.variable.path &&
        JSON.stringify(previous.variable.dimensions) === JSON.stringify(data.variable.dimensions) &&
        JSON.stringify(previous.variable.view_hint) === JSON.stringify(data.variable.view_hint);
      const source = sources.find(s => "dataset" in s && s.dataset === data.metadata.dataset_id);
      const alias = source && this.aliases.get(source.id);
      this.defaultBinding = { ...data, sourceDataset: data.metadata.dataset_id, bytes: 0, geometryBytes: 0, delta: false, selectionLabel: "", read: fetchSlice,
        origin: alias ? { source: alias, path: data.variable.path,
          selection: data.variable.dimensions.map(d => ({ start: 0, stop: d.length, stride: 1 })) } : undefined };
      if (!sameSelection && this.panels[0].intent.kind === "default") this.panels[0] = { ...this.panels[0], probe: undefined };
    }
    const selectionChanged = JSON.stringify(this.selection) !== JSON.stringify(selection);
    this.selection = selection;
    if (selectionChanged || defaultChanged) this.workspaceChanged();
    this.syncBindings();
    this.sources = sources;
    const identity = JSON.stringify([scope, unitRevision, sources.map(source => {
      if ("dataset" in source) return [source.id, source.dataset];
      const { label, ...data } = source.series;
      return [source.id, data];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
    if (identity === this.identity) {
      if (selectionChanged || defaultChanged) this.notify();
      return;
    }
    this.identity = identity;
    this.epoch++;
    this.catalogRequest++;
    for (const source of sources) if (!this.aliases.has(source.id)) this.aliases.set(source.id, `s${++this.aliasNumber}`);
    this.catalog = [];
    this.supplied.forEach(release => release()); this.supplied = [];
    this.evaluated.clear();
    this.curveCache.clear();
    this.loadedFields.clear();
    this.panels = this.panels.map(panel => ({ ...panel, intent: panel.intent.kind === "data"
      ? { kind: "error", message: "Sources changed. Submit again or reset this plot." } : panel.intent }));
    this.syncBindings();
    this.workspaceChanged();
    if (this.worker || this.state !== "closed") {
      this.stop(false);
      this.append("output", "Sources changed. Workspace reset.\n");
      void this.open();
    }
    this.notify();
  }
  async open() {
    if (this.worker || this.state === "loading") return;
    this.state = "loading";
    this.notify();
    const epoch = this.epoch;
    const request = ++this.catalogRequest;
    try {
      const catalog: CatalogSource[] = [];
      for (const source of this.sources) {
        if (!("dataset" in source)) {
          const existing = this.catalog.find(entry => entry.alias === this.aliases.get(source.id));
          if (existing) { catalog.push(existing); continue; }
          const inline = suppliedCatalog(this.aliases.get(source.id)!, source.series);
          this.supplied.push(inline.release); catalog.push(inline.source);
          continue;
        }
        let metadata;
        try { metadata = await fetchMetadata(source.dataset); }
        catch (error) { this.append("error", `${this.aliases.get(source.id)}: ${String(error)}\n`); continue; }
        if (epoch !== this.epoch || request !== this.catalogRequest) return;
        catalog.push({ alias: this.aliases.get(source.id)!, label: source.label ?? metadata.dataset_label, metadata });
      }
      this.catalog = catalog;
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = event => { if (this.worker === worker) void this.message(event.data); };
      worker.onerror = event => { if (this.worker === worker) this.fail(event.message || "Python worker failed"); };
      for (const input of this.expressionInputs()) this.knownExpressions.add(input.id);
      this.sentRevision = -1;
      this.workspaceChanged();
      worker.postMessage({ type: "init", expressions: this.expressionInputs(), runtimeURL: new URL(`assets/python-${PYODIDE_VERSION}/`, document.baseURI).href });
      this.configureWorker();
      this.timer = setTimeout(() => this.fail("Python startup timed out"), LIMITS.runMs);
    } catch (cause) { if (epoch === this.epoch) this.fail(String(cause)); }
  }
  stop(report = true) {
    this.evaluated.clear();
    this.curveCache.clear();
    this.loadedFields.clear();
    this.worker?.terminate(); this.worker = undefined; this.sentRevision = -1;
    this.abort?.abort(); this.abort = undefined;
    clearTimeout(this.timer);
    this.active = undefined;
    this.knownExpressions.clear();
    this.completionRequest?.resolve(); this.completionRequest = undefined;
    for (const job of this.evaluations.values()) { job.abort.abort(); clearTimeout(job.timer); job.reject(new Error("Python stopped")); }
    this.evaluations.clear();
    this.catalogRequest++;
    this.names = [];
    this.state = "closed";
    if (report) this.append("output", "Python stopped. Workspace reset; published plots retained.\n");
    this.notify();
  }
  reset() { this.stop(false); this.append("output", "Workspace reset.\n"); void this.open(); }
  dispose() {
    this.stop(false);
    this.supplied.forEach(release => release());
    for (const release of this.registrations.values()) release();
    this.registrations.clear();
  }
  resetPanel(id: string) {
    this.replacePanels(this.panels.map(p => p.id === id ? { ...p, intent: { kind: "default" }, probe: undefined } : p));
  }
  removePanel(id: string) {
    if (id === "panel1") throw new Error("The main panel cannot be removed");
    this.replacePanels(this.panels.filter(p => p.id !== id));
  }
  private syncBindings() {
    const needed = new Set(this.selection?.kind === "field" ? this.bindings.filter(hasFieldView) : []);
    for (const [binding, release] of this.registrations) {
      if (needed.has(binding)) continue;
      release();
      this.registrations.delete(binding);
    }
    for (const binding of needed) {
      if (!this.registrations.has(binding)) this.registrations.set(binding, registerArraySource(binding));
    }
  }
  private replacePanels(panels: PanelState[]) {
    this.panels = panels;
    this.syncBindings();
    const ids = new Set(panels.map(panel => panel.id));
    for (const id of this.loadedFields.keys()) if (!ids.has(id)) this.loadedFields.delete(id);
    this.revision++;
    this.workspaceChanged();
    this.notify();
  }
  setProbe(probe: Probe | undefined, id = "panel1") {
    this.panels = this.panels.map(panel => panel.id === id ? { ...panel, probe } : panel);
    this.revision++; this.workspaceChanged(); this.notify();
  }
  private viewReferences() {
    const view: Record<string, unknown> = {};
    const current = this.selection;
    const primary = this.catalog.find(c => c.metadata.dataset_id === current?.dataset)?.metadata.variables.find(v => v.path === current?.path);
    for (const source of this.catalog) {
      const field = this.panels[0].intent;
      const binding = field.kind === "data" ? field.binding : undefined;
      const origin = current?.kind === "field" ? binding?.origin : undefined;
      if (origin?.source === source.alias && binding && field.kind === "data") {
        const original = source.metadata.variables.find(v => v.path === origin.path)!;
        view[source.alias] = { path: origin.path, selection: origin.selection.map((s, i) => {
          const axis = binding.variable.dimensions.findIndex(d => d.path === original.dimensions[i].path);
          return typeof s === "number" || axis === binding.variable.capabilities.display_x || axis === binding.variable.capabilities.display_y
            ? s : s.start + (current?.indices[original.dimensions[i].path] ?? 0) * s.stride;
        }) };
        continue;
      }
      if (source.metadata.dataset_id.startsWith("steering:inline:")) {
        const variable = source.metadata.variables[0];
        view[source.alias] = { path: variable.path, selection: [{ start: 0, stop: variable.dimensions[0].length, stride: 1 }] };
        continue;
      }
      const variable = source.metadata.variables.find(v => v.path === current?.path);
      if (!variable || !current || !primary) continue;
      try {
        const extraction = curveSelection(primary, variable, current.along, current.indices);
        const field = current.kind === "field" ? comparisonFieldSelection(primary, current.display, current.indices, variable) : undefined;
        view[source.alias] = { path: variable.path,
          selection: variable.dimensions.map((d, i) => (field ? i === field.display.x || i === field.display.y : i === extraction.along)
            ? { start: 0, stop: d.length, stride: 1 } : (field?.indices ?? extraction.indices)[d.path] ?? 0),
          average: current.average };
      } catch { /* Sources without an exact mapping remain accessible through sources. */ }
    }
    return view;
  }
  /** Show a workspace name in the main panel as an ordinary, logged command. */
  show(name: string) {
    if (/^[A-Za-z_]\w*$/.test(name)) void this.submit(`panels[0].show(${name})`);
  }
  async submit(code = this.input) {
    if (this.state === "closed" || this.state === "failed") { await this.open(); return; }
    if (this.state !== "ready" || !code.trim()) return;
    this.completionRequest?.resolve(); this.completionRequest = undefined;
    this.configureWorker();
    const id = ++this.run;
    this.active = { id, epoch: this.epoch, selection: JSON.stringify(this.selection), revisions: this.revision, code };
    this.abort = new AbortController();
    this.state = "busy";
    this.timer = setTimeout(() => { this.stop(); this.append("error", "Execution exceeded the time limit.\n"); }, LIMITS.runMs);
    this.worker!.postMessage({ type: "submit", run: id, code });
    this.notify();
  }
  private fail(message: string) {
    this.stop(false); this.state = "failed";
    this.append("error", message.slice(0, LIMITS.outputChars) + "\n");
  }
  private async message(data: RuntimeMessage) {
    if (data.type === "ready") { clearTimeout(this.timer); this.state = "ready"; this.notify(); return; }
    if (data.type === "failed") { this.fail(data.error); return; }
    if (data.type === "completion") {
      if (this.completionRequest?.id === data.id) { this.completionRequest.resolve(data.completion); this.completionRequest = undefined; }
      return;
    }
    if (data.type === "evaluated") {
      const job = this.evaluations.get(data.id);
      if (!job) return;
      this.evaluations.delete(data.id); clearTimeout(job.timer);
      const cancelled = job.abort.signal.aborted;
      job.abort.abort();
      if (cancelled) job.reject(new DOMException("Evaluation cancelled", "AbortError"));
      else if (data.error || !data.values || !data.shape || !data.dtype) {
        const error = new Error(data.error?.message ?? "Invalid evaluation result");
        if (data.error?.traceback) error.stack = data.error.traceback;
        job.reject(error);
      }
      else {
        try {
          const width = data.dtype === "f64" ? 8 : 4;
          if (data.values.byteLength !== arrayBytes(data.shape, width, LIMITS.readBytes)) throw new Error("Invalid result byte count");
          const values = data.dtype === "f64"
            ? new Float64Array(data.values.buffer, data.values.byteOffset, data.values.byteLength / width)
            : new Float32Array(data.values.buffer, data.values.byteOffset, data.values.byteLength / width);
          job.resolve({ values, shape: data.shape, dtype: data.dtype, request: job.request });
        } catch (error) { job.reject(error instanceof Error ? error : new Error(String(error))); }
      }
      if (!this.active && !this.evaluations.size) this.state = "ready";
      this.notify(); return;
    }
    if (data.type === "move-probe") {
      const worker = this.worker;
      const active = this.active;
      const signal = this.abort?.signal;
      if (!active || active.id !== data.run || !signal) return;
      try {
        const expressions = new Map(this.expressionInputs().map(e => [e.id, e]));
        for (const update of data.updates) {
          if (update.input && "expression" in update.input) expressions.set(update.input.expression.id, update.input.expression);
        }
        const update = data.updates.find(u => u.target === data.target && u.action === "show");
        const panel = this.panels.find(p => p.id === data.target);
        let binding = panel && this.bindingFor(panel);
        const input = update?.input;
        if (input) {
          const resolved = "id" in input ? { expression: expressions.get(input.id)! } : input;
          binding = bindInput(resolved, this.catalog, "auto", this.evaluateExpression);
        }
        if (!binding) throw new Error("Bind panel data before moving its probe");
        const indices = await fieldIndices(binding, this.timestamp, panel?.intent.kind === "default" ? this.selection?.indices : undefined);
        const selection = await resolveProbe(binding, data.position, indices, signal, panel?.intent.kind === "default" ? this.selection?.display : undefined);
        signal.throwIfAborted();
        worker?.postMessage({ type: "probe-result", id: data.id, result: selection });
      } catch (error) {
        worker?.postMessage({ type: "probe-result", id: data.id, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (data.type === "read") {
      const worker = this.worker;
      const signal = data.evaluation === undefined ? this.active?.id === data.run ? this.abort?.signal : undefined : this.evaluations.get(data.evaluation)?.abort.signal;
      if (!signal) { worker?.postMessage({ type: "read-result", id: data.id, error: "Request is no longer active" }); return; }
      try {
        const slice = await readReference(this.catalog, data.reference, signal);
        signal.throwIfAborted();
        worker?.postMessage({ type: "read-result", id: data.id, slice }, [slice.values.buffer as ArrayBuffer]);
      } catch (error) { worker?.postMessage({ type: "read-result", id: data.id, error: String(error) }); }
      return;
    }
    const active = this.active;
    if (!active || active.id !== data.run) return;
    if (data.type === "started") {
      if (this.input === active.code) this.input = "";
      this.history = [...this.history, active.code].slice(-LIMITS.history);
      this.append("command", active.code);
    } else if (data.type === "output") {
      this.append(data.kind === "error" ? "error" : "output", String(data.text));
    } else if (data.type === "incomplete") {
      if (this.input === active.code) {
        const last = this.input.split("\n").at(-1) ?? "";
        this.input += "\n" + (last.match(/^\s*/)?.[0] ?? "") + (last.trimEnd().endsWith(":") ? "    " : "");
      }
      this.finish();
    } else if (data.type === "done") {
      this.names = Array.isArray(data.names) ? data.names.slice(0, LIMITS.names) : [];
      for (const command of data.updates) if (command.input && "expression" in command.input) this.knownExpressions.add(command.input.expression.id);
      try {
        if (data.error) this.reportError(data.error);
        else {
          await this.publish(data.updates, active);
          if (data.result) {
            this.addLog({ kind: "result", text: data.result.summary, object: data.result });
          }
        }
      } catch (error) { this.reportError({ message: error instanceof Error ? error.message : String(error), traceback: error instanceof Error ? error.stack : undefined, code: active.code }); }
      this.workspaceChanged();
      this.configureWorker();
      this.retainExpressions();
      if (this.active === active) this.finish();
    }
  }
  private finish() { clearTimeout(this.timer); this.abort?.abort(); this.active = undefined; this.abort = undefined; this.state = this.evaluations.size ? "busy" : "ready"; this.notify(); }
  private async publish(commands: PlotCommand[], active: NonNullable<SteeringSession["active"]>) {
    const current = () => this.active === active && active.epoch === this.epoch && active.selection === JSON.stringify(this.selection) && active.revisions === this.revision;
    if (!commands.length) return;
    if (!current()) throw new Error("View changed. Plot updates discarded.");
    if (commands.length > LIMITS.panels * 2 || new Set(commands.map(c => c.target)).size !== commands.length) throw new Error("Invalid plot update");
    const prepared = new Map(this.panels.map(p => [p.id, p]));
    const expressions = new Map(this.expressionInputs().map(e => [e.id, e]));
    const reusable = new Map(this.bindings.flatMap(binding => binding.expression ? [[binding.expression.id, binding] as const] : []));
    const admitted = new Set(this.bindings);
    const created: Binding[] = [];
    const budget = () => {
      const bindings = new Set([...admitted, ...created]);
      const curveOwners = new Map<string, Binding>();
      for (const panel of [...this.panels, ...prepared.values()]) {
        if (panel.intent.kind !== "data") continue;
        const binding = panel.intent.binding;
        curveOwners.set(JSON.stringify([panel.id, binding.metadata.dataset_id, panel.probe]), binding);
      }
      const values = {
        bindings: [...bindings].reduce((sum, b) => sum + b.bytes, 0),
        geometry: [...bindings].reduce((sum, b) => sum + b.geometryBytes, 0),
        curves: [...curveOwners.values()].reduce((sum, binding) => {
          const axis = curveAlong(binding);
          const dimension = binding.variable.dimensions.find(d => d.path === axis);
          return sum + (dimension ? arrayBytes([dimension.length], 16, LIMITS.readBytes) : 0);
        }, 0),
        caches: this.evaluated.bytes + this.curveCache.bytes,
      };
      if (Object.values(values).reduce((sum, value) => sum + value, 0) > LIMITS.publishedBytes) {
        throw new Error("Published bindings, geometry, curves, and caches exceed the memory limit");
      }
      return values;
    };
    for (const command of commands) {
      if (!/^panel[1-9]\d*$/.test(command.target) ||
          !["append", "remove", "show", "clear", "reset", "probe"].includes(command.action)) throw new Error("Invalid plot command");
      if (command.action === "remove") {
        if (command.target === "panel1") throw new Error("The main panel cannot be removed");
        prepared.delete(command.target); continue;
      }
      if (command.action === "probe") {
        const panel = prepared.get(command.target);
        if (!panel) throw new Error("Panel is no longer available");
        prepared.set(command.target, { ...panel, probe: command.probe ?? undefined });
        continue;
      }
      if (command.action !== "show") {
        prepared.set(command.target, { id: command.target,
          intent: { kind: command.action === "reset" ? "default" : "hidden" } });
        continue;
      }
      if (!command.input) throw new Error("A panel binds one Variable");
      const supplied = command.input;
      const expression = "id" in supplied ? expressions.get(supplied.id) : undefined;
      if ("id" in supplied && !expression) throw new Error("Published expression is no longer available");
      const input = "id" in supplied ? { expression: expression! } : supplied;
      if ("expression" in input) expressions.set(input.expression.id, input.expression);
      const key = "expression" in input ? input.expression.id : "";
      let binding = reusable.get(key);
      if (!binding) {
        binding = bindInput(input, this.catalog, "auto", this.evaluateExpression);
        created.push(binding);
        if (key) reusable.set(key, binding);
      }
      const previousPanel = prepared.get(command.target);
      const previous = previousPanel?.intent;
      const same = previous?.kind === "data" && previous.binding === binding;
      prepared.set(command.target, { id: command.target, probe: command.probe === null ? undefined : command.probe ?? (same ? previousPanel?.probe : undefined),
        intent: same ? previous : { kind: "data", binding } });
    }
    if (prepared.size > LIMITS.panels) throw new Error("Panel limit reached; remove an unused panel");
    budget();
    for (const binding of created) if (hasField(binding)) await validateField(binding, this.abort!.signal);
    budget();
    if (!current()) throw new Error("View changed. Plot updates discarded.");
    this.replacePanels([...prepared.values()]);
  }
}
