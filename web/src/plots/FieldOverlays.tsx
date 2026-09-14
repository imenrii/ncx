import { PLOT_STYLE, centreMarkSize } from "./plotStyle";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { fetchCoordinate, fetchSlice } from "../data/api";
import type { Metadata, Variable } from "../data/model";
import { windPair, windValues, windSampleRequest, fieldWindReason } from "../data/wind";
import { pressureVariable } from "../data/pressure";
import type { MeshGeometry } from "./mesh";
import type { ViewBounds } from "./view";
import { meshWindAnchors, type FieldVector } from "./windGeometry";
import { fieldVectorMarks } from "./fieldVectors";
import { loadPressureContours } from "./pressureLoad";
import {
  projectContours, smoothVisibleContours, contourLabels, contourInterval, projectCentres, centreBox,
  CONTOUR_WIDTH, CONTOUR_LABEL_SCALE, type ContourBox, type PressureCentre, type PressureContour,
} from "./pressureContours";

type Arrow = FieldVector;
interface Plot { left: number; top: number; width: number; height: number }
interface Loaded { key: string; arrows?: Arrow[]; error?: string }

export function FieldOverlays({ metadata, variable, wind = false, pressure, indices, bounds, plot, labelSize, geometry, spatialDimension, reserve, onStatus, children }: {
  metadata: Metadata; variable: Variable; wind?: boolean; pressure?: Variable;
  indices: Record<string, number>; bounds: ViewBounds; plot: Plot; labelSize: number;
  geometry?: MeshGeometry; spatialDimension?: string; reserve?: ContourBox;
  onStatus: (message: string) => void;
  children?: ReactNode;
}) {
  const id = `vectors-${useId().replaceAll(":", "")}`;
  // One size drives the glyphs and the break they sit in; drifting them apart
  // leaves the label either crowded or floating in a hole.
  const textSize = labelSize * CONTOUR_LABEL_SCALE;
  const markSize = centreMarkSize();
  const maskId = `contour-mask-${id}`;
  const [loadedWind, setLoadedWind] = useState<Loaded>();
  const [loadedPressure, setLoadedPressure] = useState<{
    key: string; contours?: PressureContour[]; extrema?: PressureCentre[]; error?: string;
  }>();
  const key = JSON.stringify([metadata.dataset_id, variable.path, variable.view_hint, indices, bounds, spatialDimension]);
  const source = useMemo(() => pressure && pressureVariable(metadata, pressure), [metadata, pressure]);
  const pressureKey = `${key}:${source?.path}:${JSON.stringify(source?.attributes)}`;
  useEffect(() => {
    if (!wind) return;
    const controller = new AbortController();
    void loadArrows(metadata, variable, indices, bounds, geometry, spatialDimension, controller.signal)
      .then(arrows => { if (!controller.signal.aborted) setLoadedWind({ key, arrows }); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setLoadedWind({ key, error }); onStatus(`Wind: ${error}. Turn Wind off and on to retry.`);
      });
    return () => controller.abort();
  }, [wind, key, geometry, metadata, variable, onStatus]);
  useEffect(() => {
    if (!pressure) return;
    const controller = new AbortController();
    const load = source ? loadPressureContours(metadata, variable, source, indices, bounds, geometry, controller.signal)
      : Promise.reject(new Error("No matching pressure field in this source"));
    void load.then(field => { if (!controller.signal.aborted) setLoadedPressure({ key: pressureKey, ...field }); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setLoadedPressure({ key: pressureKey, error }); onStatus(`Pressure contours: ${error}. Turn the layer off and on to retry.`);
      });
    return () => controller.abort();
  }, [Boolean(pressure), pressureKey, source, geometry, metadata, variable, onStatus]);
  const currentWind = wind && loadedWind?.key === key ? loadedWind : undefined;
  const currentPressure = pressure && loadedPressure?.key === pressureKey ? loadedPressure : undefined;
  const view = [bounds.minimumX, bounds.maximumX, bounds.minimumY, bounds.maximumY,
    plot.left, plot.top, plot.width, plot.height];
  const { contours: candidates, centres } = useMemo(() => {
    const all = projectContours(currentPressure?.contours ?? [], bounds, plot);
    const centres = projectCentres(currentPressure?.extrema ?? [], all, bounds, plot, textSize, markSize);
    const interval = contourInterval(all, plot);
    const drawn = smoothVisibleContours(all.filter(contour => contour.level % interval === 0), plot);
    return { contours: drawn, centres };
  }, [currentPressure, textSize, markSize, ...view]);
  const centreBoxes = useMemo(() => centres.map(centre => centreBox(centre, textSize, markSize)),
    [centres, textSize, markSize]);
  const reserved = useMemo(() => [...centreBoxes, ...(reserve ? [reserve] : [])],
    [centreBoxes, reserve?.left, reserve?.right, reserve?.top, reserve?.bottom]);
  const labels = useMemo(() => contourLabels(candidates, plot, textSize, reserved),
    [candidates, reserved, textSize, ...view]);
  // Each visible run must earn its own label, including disconnected runs at the same level.
  const contours = useMemo(() => [...new Set(labels.map(label => label.contour))], [labels]);
  // Labels name specific lines; arrows yield any slot that overlaps a label.
  const marks = useMemo(() => fieldVectorMarks(currentWind?.arrows ?? [], bounds, plot,
    [...reserved, ...labels.map(label => label.box)]),
    [currentWind, reserved, labels, ...view]);
  const contourPaths = useMemo(() => {
    const levels = new Map<number, string[]>();
    for (const contour of contours) {
      const path = contour.points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join("");
      if (!levels.has(contour.level)) levels.set(contour.level, []);
      levels.get(contour.level)!.push(path);
    }
    return [...levels].map(([level, paths]) => ({ level, path: paths.join("") }));
  }, [contours]);
  const windPath = marks.map(mark => mark.path).join("");
  return <g className="field-overlays" pointerEvents="none">
    <defs>
      <clipPath id={id}><rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} /></clipPath>
      {/* The label sits in a break in the line, not under a halo: a halo ring
          reads as a second, paler contour. */}
      <mask id={maskId} maskUnits="userSpaceOnUse"
        x={plot.left} y={plot.top} width={plot.width} height={plot.height}>
        <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} fill="white" />
        {labels.map((label, index) => <rect key={`label-${index}`} fill="black"
          x={label.x - label.half} y={label.y - (textSize + 2) / 2}
          width={label.half * 2} height={textSize + 2}
          transform={`rotate(${label.angle} ${label.x} ${label.y})`} />)}
        {centreBoxes.map((box, index) => <rect key={`centre-${index}`} fill="black"
          x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} />)}
      </mask>
    </defs>
    {pressure && <g className="pressure-contours" data-pressure={currentPressure?.error ? "error" : currentPressure?.contours ? "ready" : "loading"}>
      {currentPressure?.error && <text className="wind-key pressure-key" x={8} y={plot.top - 20}>Contours unavailable</text>}
      <g clipPath={`url(#${id})`} mask={`url(#${maskId})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {contourPaths.map(contour => <path key={contour.level} className="pressure-contour"
          data-level={contour.level} d={contour.path} strokeDasharray={contour.level < 0 ? "5 3" : undefined}
          stroke={PLOT_STYLE.ink} strokeWidth={CONTOUR_WIDTH} />)}
      </g>
    </g>}
    {children}
    {wind && <g className="wind-field" data-wind={currentWind?.error ? "error" : currentWind?.arrows ? "ready" : "loading"}>
      {currentWind?.error && <text className="wind-key" x={8} y={plot.top - 20}>Wind unavailable</text>}
      <g clipPath={`url(#${id})`} strokeLinecap="round" strokeLinejoin="round">
        {/* A wider casing makes the arrow read white on a dark colour map. */}
        <path d={windPath} fill="none" stroke={PLOT_STYLE.paper} strokeWidth={PLOT_STYLE.wind.casing} opacity={PLOT_STYLE.wind.casingOpacity} />
        <path className="wind-arrows" d={windPath} fill="none" stroke={PLOT_STYLE.ink} strokeWidth={PLOT_STYLE.wind.width} />
      </g>
    </g>}
    <g className="pressure-contour-labels" clipPath={`url(#${id})`}>
      {labels.map((label, index) => <text key={index} className="pressure-contour-label"
        x={label.x} y={label.y} fontSize={textSize} transform={`rotate(${label.angle} ${label.x} ${label.y})`}
        textAnchor="middle" dominantBaseline="central" fill={PLOT_STYLE.ink}>{label.text}</text>)}
      {centres.map((centre, index) => <g key={`centre-${index}`} className="pressure-centre">
        <text x={centre.x} y={centre.y - (textSize + PLOT_STYLE.pressure.centreGap) / 2} textAnchor="middle" dominantBaseline="central"
          fill={PLOT_STYLE.ink} className="pressure-centre-mark">{centre.kind}</text>
        <text x={centre.x} y={centre.y + (markSize + PLOT_STYLE.pressure.centreGap) / 2} textAnchor="middle" dominantBaseline="central"
          fontSize={textSize} fill={PLOT_STYLE.ink} className="pressure-centre-value">{Math.round(centre.value)}</text>
      </g>)}
    </g>
  </g>;
}

async function loadArrows(metadata: Metadata, variable: Variable, indices: Record<string, number>, bounds: ViewBounds, geometry: MeshGeometry | undefined, spatialDimension: string | undefined, signal: AbortSignal): Promise<Arrow[]> {
  const reason = fieldWindReason(metadata, variable);
  if (reason) throw new Error(reason);
  const match = windPair(metadata, variable);
  if (!match.pair) throw new Error(match.reason);
  const pair = match.pair, hint = pair.u.view_hint;
  if (hint.kind === "plain") throw new Error("Wind requires geographic coordinates");
  const xVariable = metadata.variables.find(item => item.path === hint.x)!;
  const yVariable = metadata.variables.find(item => item.path === hint.y)!;

  const [x, y] = await Promise.all([fetchCoordinate(xVariable), fetchCoordinate(yVariable)]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const inside = (longitude: number, latitude: number) => longitude >= bounds.minimumX && longitude <= bounds.maximumX && latitude >= bounds.minimumY && latitude <= bounds.maximumY;
  let spatial: string[];
  const mesh = hint.kind === "ugrid2d" && geometry ? meshWindAnchors(geometry, hint.location === "face", bounds) : undefined;
  if (hint.kind === "ugrid2d") {
    if (!mesh) throw new Error("Wind mesh geometry is not ready");
    spatial = spatialDimension ? [spatialDimension] : [];
  } else spatial = [...new Set([...xVariable.dimensions, ...yVariable.dimensions].map(dim => dim.path))];
  if (!spatial.length || spatial.length > 2 || spatial.some(path => !pair.u.dimensions.some(dim => dim.path === path))) throw new Error("Wind spatial dimensions are not available");
  const ranges = new Map<string, { start: number; stop: number; stride: number }>();
  const visible = new Map<string, { min: number; max: number }>();
  const record = (path: string, index: number) => {
    const entry = visible.get(path);
    if (entry) { entry.min = Math.min(entry.min, index); entry.max = Math.max(entry.max, index); }
    else visible.set(path, { min: index, max: index });
  };
  if (hint.kind === "rectilinear") {
    for (let i = 0; i < x.length; i += 1) if (x[i] >= bounds.minimumX && x[i] <= bounds.maximumX) record(xVariable.dimensions[0].path, i);
    for (let i = 0; i < y.length; i += 1) if (y[i] >= bounds.minimumY && y[i] <= bounds.maximumY) record(yVariable.dimensions[0].path, i);
  } else if (hint.kind === "curvilinear") {
    const columns = xVariable.dimensions[1]?.length;
    if (!columns || x.length !== y.length) throw new Error("Wind coordinate dimensions differ");
    for (let i = 0; i < x.length; i += 1) if (inside(x[i], y[i])) {
      record(xVariable.dimensions[0].path, Math.floor(i / columns)); record(xVariable.dimensions[1].path, i % columns);
    }
  } else if (mesh?.range) visible.set(spatial[0], mesh.range);
  if (spatial.some(path => !visible.has(path))) return [];
  for (const path of spatial) {
    const range = visible.get(path)!;
    ranges.set(path, { start: range.min, stop: range.max + 1, stride: Math.max(1, Math.ceil((range.max - range.min + 1) / (spatial.length === 2 ? 31 : 1000))) });
  }
  const { request, shape } = windSampleRequest(pair.u, ranges, indices, metadata.limits.max_response_bytes);
  const u = await fetchSlice(request, signal);
  const v = await fetchSlice({ ...request, path: pair.v.path }, signal);
  if (u.shape.join() !== shape.join() || v.shape.join() !== shape.join()) throw new Error("Wind response differs from its sample plan");
  const values = windValues(u.values, v.values, pair);
  const ordered = pair.u.dimensions.filter(dim => ranges.has(dim.path));
  return Array.from(values.u, (east, slot) => {
    const native: Record<string, number> = {};
    let remaining = slot;
    for (let axis = ordered.length - 1; axis >= 0; axis -= 1) {
      const range = ranges.get(ordered[axis].path)!;
      native[ordered[axis].path] = range.start + remaining % u.shape[axis] * range.stride;
      remaining = Math.floor(remaining / u.shape[axis]);
    }
    let position: [number, number] | undefined;
    if (hint.kind === "rectilinear") position = [x[native[xVariable.dimensions[0].path]], y[native[yVariable.dimensions[0].path]]];
    else if (hint.kind === "curvilinear") {
      const index = native[xVariable.dimensions[0].path] * xVariable.dimensions[1].length + native[xVariable.dimensions[1].path];
      position = [x[index], y[index]];
    } else position = mesh?.anchors.get(native[spatial[0]]);
    return { longitude: position?.[0] ?? NaN, latitude: position?.[1] ?? NaN, u: east, v: values.v[slot] };
  });
}
