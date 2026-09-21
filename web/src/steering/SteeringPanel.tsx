import { memo, useEffect, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { highlightHTML } from "@speed-highlight/core";
import type { SteeringSession } from "./session";
import { atHistoryEdge, indentLines, insertLine, type Edit } from "./editor";
import type { CatalogSource, Completion, ConsoleError, Displays, ObjectDescription, PlotTarget } from "./model";

export function SteeringPanel({ session, open, displays }: { session: SteeringSession; open: boolean; displays: Displays }) {
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; height: number } | undefined>(undefined);
  const [height, setHeight] = useState(288);
  const [maximum, setMaximum] = useState(600);
  const [historyIndex, setHistoryIndex] = useState(0);
  const unsent = useRef("");
  const [highlight, setHighlight] = useState("");
  const [cursor, setCursor] = useState(0);
  const [completion, setCompletion] = useState<Completion>();
  const [candidate, setCandidate] = useState(0);
  const completionVersion = useRef(0);
  const [search, setSearch] = useState<string>();
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const currentDisplays = useRef(displays);
  currentDisplays.current = displays;
  const followLog = useRef(true);

  useEffect(() => {
    if (open) { void session.open(); input.current?.focus(); }
  }, [open, session]);
  useEffect(() => {
    let current = true;
    void highlightHTML(session.input, "py", { block: false }).then(html => { if (current) setHighlight(html + "\n"); });
    if (input.current) { input.current.style.height = "auto"; input.current.style.height = `${input.current.scrollHeight}px`; }
    return () => { current = false; };
  }, [session.input, open]);
  useEffect(() => { if (log.current && followLog.current) log.current.scrollTop = log.current.scrollHeight; }, [session.log.length, session.log.at(-1)?.text, session.state]);
  useEffect(() => { setHistoryIndex(session.history.length); }, [session.history.length]);
  useEffect(() => { document.getElementById(`steering-completion-${candidate}`)?.scrollIntoView({ block: "nearest" }); }, [candidate]);
  useEffect(() => {
    const shell = panel.current?.parentElement;
    if (!shell) return;
    const resize = () => {
      const max = Math.max(160, Math.floor(shell.clientHeight * .65));
      setMaximum(max); setHeight(current => Math.min(max, current));
    };
    const observer = new ResizeObserver(resize); observer.observe(shell); resize();
    return () => observer.disconnect();
  }, []);
  const resize = (value: number) => setHeight(Math.max(160, Math.min(maximum, value)));
  const edit = useCallback(({ text, start, end }: Edit) => {
    session.setInput(text);
    setCursor(start);
    setCompletion(undefined);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start, end); });
  }, [session]);
  const insert = useCallback((reference: string) => {
    const node = input.current!;
    const start = node.selectionStart;
    edit({ text: session.input.slice(0, start) + reference + session.input.slice(node.selectionEnd), start: start + reference.length, end: start + reference.length });
  }, [session, edit]);
  const requestCompletion = useCallback(async (force = false) => {
    const position = input.current?.selectionStart ?? 0;
    const version = ++completionVersion.current;
    const code = session.input;
    const before = code.slice(0, position);
    if (!force && !/(?<!\w)[A-Za-z_]\w*$|[.("'\[]$/.test(before)) { setCompletion(undefined); return; }
    const result = await session.complete(code, position, currentDisplays.current, force);
    if (result) {
      const fragment = code.slice(result.start, result.end);
      result.items = !force && result.items.some(item => item.insert === fragment)
        ? [] : result.items.filter(item => item.insert !== fragment);
    }
    if (version === completionVersion.current && session.input === code && input.current?.selectionStart === position) {
      setCompletion(result); setCandidate(0);
    }
  }, [session]);
  useEffect(() => {
    setCompletion(undefined);
    if (!open || search !== undefined) return;
    const timer = setTimeout(() => void requestCompletion(), 100);
    return () => { clearTimeout(timer); completionVersion.current++; };
  }, [session.input, cursor, session.state, open, search, requestCompletion]);
  const acceptCompletion = (index: number) => {
    const item = completion?.items[index];
    if (!completion || !item) return;
    const position = completion.start + item.insert.length;
    completionVersion.current++;
    edit({ text: session.input.slice(0, completion.start) + item.insert + session.input.slice(completion.end), start: position, end: position });
  };
  const recall = (text: string) => { edit({ text, start: text.length, end: text.length }); setHistoryIndex(session.history.length); setSearch(undefined); };
  const matches = search === undefined ? [] : session.history.map((text, index) => ({ text, index })).reverse().filter(item => item.text.toLowerCase().includes(search.toLowerCase())).slice(0, 20);

  return <section ref={panel} id="steering-panel" className="steering" aria-label="Steering terminal" hidden={!open} style={{ height }}>
    <div className="steering-resize" role="separator" tabIndex={0} aria-label="Resize Steering panel" aria-orientation="horizontal"
      aria-valuemin={160} aria-valuemax={maximum} aria-valuenow={height}
      onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); resize(event.key === "Home" ? 160 : event.key === "End" ? maximum : height + (event.key === "ArrowUp" ? 16 : -16));
      }} onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height };
      }} onPointerMove={event => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY); }}
      onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }} />
    <aside className="steering-outline" aria-label="Outline">
      <h2>Outline</h2>
      {session.catalog.map(source => <SourceOutline key={source.alias} source={source} insert={insert} />)}
      {session.names.length > 0 && <details open className="steering-group"><summary>Variables</summary>
        {session.names.map(name => <button key={name.name} title={name.summary} onClick={() => insert(name.name)}>{name.name}</button>)}
      </details>}
      <details open className="steering-group steering-displays"><summary>Displays</summary>
        <button onClick={() => insert("frame")}>frame</button>
        {session.panels.map((panel, index) => <details open key={panel.id}><summary>{`panels[${index}]`}</summary>
          {["data", "probe", "field", "curve"].map(name => <button key={name} onClick={() => insert(`panels[${index}].${name}`)}>{name}</button>)}
        </details>)}
      </details>
    </aside>
    <div className="steering-terminal">
      <div className="steering-head"><span>Python</span>
        <span className="steering-state" role="status">{session.state === "loading" ? "Loading Python…" : session.state === "busy" ? "Running…" : ""}</span>
        {(session.state === "busy" || session.state === "loading") && <button onClick={() => session.stop()}>Stop</button>}
        {(session.state === "closed" || session.state === "failed") && <button onClick={() => void session.open()}>Start Python</button>}
        <TerminalHelp />
        <details className="steering-menu"><summary aria-label="Terminal options" title="Terminal options">···</summary>
          <div><button onClick={event => { session.clearLog(); event.currentTarget.closest("details")!.open = false; }}>Clear log</button>
            <button onClick={event => { session.reset(); event.currentTarget.closest("details")!.open = false; }}>Reset workspace</button></div>
        </details>
      </div>
      <div className="steering-log" ref={log} role="log" aria-label="Python command log" aria-live="polite"
        onScroll={event => { const node = event.currentTarget; followLog.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24; }}>
        {session.log.map(line => <div className={`steering-entry ${line.kind}`} key={line.id}>
          <span aria-hidden="true">{line.kind === "command" ? ">>" : ""}</span>
          {line.kind === "command" ? <Highlighted code={line.text} />
            : line.object ? <ObjectResult value={line.object} session={session} displays={displays} />
              : line.error ? <ErrorResult error={line.error} edit={recall} /> : <pre>{line.text}</pre>}
        </div>)}
      </div>
      <div className="steering-input-area">
        {search !== undefined && <div className="steering-history">
          <input ref={searchInput} autoFocus aria-label="Search command history" placeholder="Search history" value={search}
            onChange={event => { setSearch(event.currentTarget.value); setSearchIndex(0); }} onKeyDown={event => {
              if (event.key === "Escape") { event.preventDefault(); setSearch(undefined); input.current?.focus(); }
              else if (event.key === "Enter" && matches[searchIndex]) { event.preventDefault(); recall(matches[searchIndex].text); }
              else if (["ArrowUp", "ArrowDown"].includes(event.key) || event.ctrlKey && event.key === "r") {
                event.preventDefault(); setSearchIndex(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowUp" ? -1 : 1))));
              }
            }} />
          <div role="listbox" aria-label="Matching commands">{matches.map((item, index) => <button role="option" aria-selected={index === searchIndex}
            key={item.index} onClick={() => recall(item.text)}><pre>{item.text}</pre></button>)}</div>
          {!matches.length && <span>No matching commands</span>}
        </div>}
        {completion && (completion.items.length > 0 || completion.signature) && <div className="steering-completion">
          {completion.signature && <div className="steering-signature">{completion.signature}</div>}
          <div id="steering-completions" role="listbox" aria-label="Completions">{completion.items.map((item, index) => <button
            key={item.label} id={`steering-completion-${index}`} role="option" aria-selected={candidate === index}
            onMouseDown={event => event.preventDefault()} onClick={() => acceptCompletion(index)}>
            <span>{item.label}</span><small>{item.detail}</small>
          </button>)}</div>
        </div>}
        <div className="steering-command"><label htmlFor="steering-input">&gt;&gt;</label>
          <div className="steering-input-stack"><pre aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlight }} />
            <textarea id="steering-input" ref={input} value={session.input} rows={1} spellCheck={false} autoCapitalize="off" autoComplete="off"
              aria-label="Python command" aria-autocomplete="list" aria-controls="steering-completions"
              aria-expanded={Boolean(completion?.items.length)} aria-activedescendant={completion?.items.length ? `steering-completion-${candidate}` : undefined}
              title="Enter submits; Shift+Enter inserts a line; Ctrl+Space completes; Ctrl+R searches history"
              onChange={event => { session.setInput(event.currentTarget.value); setCursor(event.currentTarget.selectionStart); }}
              onSelect={event => setCursor(event.currentTarget.selectionStart)}
              onBlur={() => { completionVersion.current++; setCompletion(undefined); }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                const node = event.currentTarget, start = node.selectionStart, end = node.selectionEnd;
                if (event.ctrlKey && event.key.toLowerCase() === "r") {
                  event.preventDefault(); setCompletion(undefined); setSearch(""); setSearchIndex(0); return;
                }
                if (event.ctrlKey && event.code === "Space") { event.preventDefault(); void requestCompletion(true); return; }
                if (event.key === "Escape") { event.preventDefault(); completionVersion.current++; setCompletion(undefined); return; }
                if (completion?.items.length && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                  event.preventDefault(); setCandidate(index => (index + (event.key === "ArrowUp" ? -1 : 1) + completion.items.length) % completion.items.length); return;
                }
                if (completion?.items.length && !event.shiftKey && (event.key === "Tab" || event.key === "Enter")) {
                  event.preventDefault(); acceptCompletion(candidate); return;
                }
                if (event.key === "Tab") { event.preventDefault(); edit(indentLines(session.input, start, end, event.shiftKey)); return; }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) edit(insertLine(session.input, start, end));
                  else { completionVersion.current++; setCompletion(undefined); followLog.current = true; void session.submit(displays); }
                } else if (["ArrowUp", "ArrowDown"].includes(event.key) && atHistoryEdge(session.input, start, end, event.key === "ArrowUp")) {
                  event.preventDefault();
                  if (historyIndex === session.history.length) unsent.current = session.input;
                  const next = Math.max(0, Math.min(session.history.length, historyIndex + (event.key === "ArrowUp" ? -1 : 1)));
                  setHistoryIndex(next);
                  const text = session.history[next] ?? unsent.current;
                  edit({ text, start: event.key === "ArrowUp" ? 0 : text.length, end: event.key === "ArrowUp" ? 0 : text.length });
                }
              }} />
          </div>
        </div>
      </div>
    </div>
  </section>;
}

function TerminalHelp() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="steering-help-toggle" aria-label="Terminal help" title="Terminal help" aria-haspopup="dialog"
      onClick={() => dialog.current?.showModal()}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6 3H3v18h3M18 3h3v18h-3M9 9a3 3 0 1 1 5 2.2c-1.2.8-2 1.3-2 2.8" />
        <path d="M12 17v1" strokeWidth="2" />
      </svg>
    </button>
    <dialog ref={dialog} className="steering-help" aria-labelledby="steering-help-title">
      <header><h2 id="steering-help-title">Steering quick reference</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>Close</button>
      </header>
      <p>Click an Outline entry to insert its name. Use your file’s paths and dimension names.</p>
      <details open><summary>Quick start</summary>
        <Highlighted code={'t = sources.s1["/CLK"]\nt += 1.45\nplots.curve.show(t)'} />
        <p>Source data stays unchanged. Call <code>show()</code> again to update a plot.</p>
      </details>
      <details><summary>Fields and panels</summary>
        <Highlighted code={'u = sources.s1["/u10"]\nv = sources.s1["/v10"]\nspeed = np.hypot(u, v).rename("Wind speed")\np = frame.append(speed)'} />
        <p>Each panel binds one variable. Field shows its map; Curve shows its probe series. All fields share the time slider and overlay settings.</p>
        <Highlighted code={'panels[0].data      # Main panel\npanels[1].data      # First appended panel\np.show(speed)      # Replace this panel’s data'} />
      </details>
      <details><summary>Read and move a probe</summary>
        <Highlighted code={'panels[1].probe = panels[0].probe\np.probe.position\nawait p.probe.move(longitude=115.75, latitude=28.5)\nseries = p.probe.data\np.probe.clear()'} />
        <p>Assign a probe to copy its current selection on the same source grid. Panels remain independent. Click a field or move its probe here; its curve updates automatically. Saved series keep their selected position. An unplaced probe returns <code>None</code>.</p>
        <Highlighted code={'await p.probe.move(x=1200, y=4800)  # Native grid coordinates'} />
      </details>
      <details><summary>Select, subtract, and convert</summary>
        <Highlighted code={'normal = sources.s1["/water_level"]\ntide = sources.s2["/water_level"]\nanomaly = normal - tide\np = frame.append(anomaly)'} />
        <p>Place a probe on the anomaly field to see its curve. Operands must have compatible dimensions and coordinates.</p>
        <Highlighted code={'field = u.isel({"time": 0})\nseries = u.isel({"lat": 80, "lon": 120})\npressure = sources.s1["/msl"].to_unit("hPa")\nplots.show(pressure)'} />
        <p>Calculations use the selected data, including samples outside the visible plot. A time slice stays fixed.</p>
      </details>
      <details><summary>Manage panels</summary>
        <Highlighted code={'p = frame.append(series)\np.clear()          # Hide this panel\np.remove()         # Remove this panel\nplots.reset()      # Restore the viewer selection'} />
        <p><code>panels</code> is <code>frame.panels</code>. Indices start at zero; stored handles still refer to the same panel after another panel is removed.</p>
      </details>
      <details><summary>Inspect and load values</summary>
        <Highlighted code={'view.s1                 # Current source selection\npanels[0].data           # Bound variable\nvalues = await t.compute()'} />
        <p>Enter a variable name and expand its result to inspect metadata. Large materialized results can exceed the memory limit.</p>
      </details>
      <details><summary>Keyboard and terminal</summary>
        <dl className="steering-help-keys">
          <div><dt><kbd>Enter</kbd></dt><dd>Accept completion or execute</dd></div>
          <div><dt><kbd>Shift+Enter</kbd></dt><dd>Add a line</dd></div>
          <div><dt><kbd>Ctrl+Space</kbd> / <kbd>Tab</kbd></dt><dd>List / accept completions</dd></div>
          <div><dt><kbd>↑</kbd> / <kbd>↓</kbd></dt><dd>Recall history at the first / last line</dd></div>
          <div><dt><kbd>Ctrl+R</kbd></dt><dd>Search history</dd></div>
        </dl>
        <p>Stop interrupts a running command. Terminal options contain Clear log and Reset workspace.</p>
      </details>
    </dialog>
  </>;
}

function ObjectResult({ value, session, displays }: { value: ObjectDescription; session: SteeringSession; displays: Displays }) {
  const state = value.target && displays[value.target];
  const active = state && state.kind === value.reference?.split(".").at(-1);
  const intent = session.panels.find(p => p.id === value.target)?.intent;
  const binding = intent?.kind === "data" ? intent.binding : undefined;
  const data = binding ? session.names.find(name => name.objectId === binding.expression?.id)?.name
    ?? binding.expression?.summary ?? binding.variable.name
    : intent?.kind === "hidden" ? "none" : "viewer selection";
  const fields = state ? [{ name: "data", value: active ? data : "none" }, { name: "visible", value: String(Boolean(active && state.visible)) },
    { name: "range", value: active ? state.range : "automatic" }, { name: "unit", value: active && state.unit || "unspecified" }] : value.fields;
  if (!fields.length) return <pre>{value.summary}</pre>;
  return <details className="steering-result"><summary>{value.summary}{state && <small>current</small>}</summary>
    <dl>{fields.map(field => <div key={field.name}><dt>{field.name}</dt><dd>{field.value}</dd></div>)}</dl>
  </details>;
}

function ErrorResult({ error, edit }: { error: ConsoleError; edit: (code: string) => void }) {
  return <div className="steering-error">
    <div><strong>{error.message}</strong><button onClick={() => edit(error.code)}>Edit command</button></div>
    {error.source && <pre className="steering-error-source"><span>{error.line ?? ""}</span><code>{error.source.slice(0, error.column ?? 0)}<mark>{error.source.slice(error.column ?? 0, (error.column ?? 0) + 1) || " "}</mark>{error.source.slice((error.column ?? 0) + 1)}</code></pre>}
    {error.traceback && <details><summary>Traceback</summary><pre>{error.traceback}</pre></details>}
  </div>;
}

const SourceOutline = memo(function SourceOutline({ source, insert }: { source: CatalogSource; insert: (reference: string) => void }) {
  const [page, setPage] = useState(0);
  const variables = source.metadata.variables.filter(variable => variable.capabilities.numeric);
  return <details open className="steering-group"><summary title={source.label}>Sources{source.alias.slice(1)}</summary>
    {variables.slice(page * 100, (page + 1) * 100).map(variable => <button key={variable.path}
      title={`${variable.dimensions.map(d => d.length).join(" × ") || "scalar"} · ${variable.dtype} · source`}
      onClick={() => insert(`sources.${source.alias}[${JSON.stringify(variable.path)}]`)}>{variable.path}</button>)}
    {variables.length > 100 && <div className="steering-pages"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <button disabled={(page + 1) * 100 >= variables.length} onClick={() => setPage(page + 1)}>Next</button></div>}
  </details>;
});

function Highlighted({ code }: { code: string }) {
  const [html, setHTML] = useState<string>();
  useEffect(() => {
    let active = true;
    void highlightHTML(code, "py", { block: false }).then(html => { if (active) setHTML(html); });
    return () => { active = false; };
  }, [code]);
  return html === undefined ? <pre>{code}</pre> : <pre dangerouslySetInnerHTML={{ __html: html }} />;
}
