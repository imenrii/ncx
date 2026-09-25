import type { FieldSettings } from "../data/fieldSettings";
import type { WindComponents } from "../data/wind";
import { PLOT_STYLE, centreMarkSize, dataStroke } from "./plotStyle";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { fetchCoordinate, fetchSlice } from "../data/api";
import type { Metadata, Variable } from "../data/model";
import { windPair, windValues, windSampleRequest, fieldWindReason } from "../data/wind";
import { pressureVariable } from "../data/pressure";
import type { MeshGeometry } from "./mesh";
import type { ViewBounds } from "./view";
import { meshWindAnchors, type FieldVector } from "./windGeometry";
import { fieldVectorMarks, gridStride, latticeSpacing } from "./fieldVectors";
import { loadPressureContours } from "./pressureLoad";
import {
  projectContours, smoothVisibleContours, contourLabels, contourInterval, projectCentres, centreBox,
  smoothMesh, smoothingPasses, pruneContours, drawnContours, projectExtrema, standardLevel, pressureContours,
  CONTOUR_WIDTH, CONTOUR_LABEL_SCALE, type ContourBox, type ContourMesh, type PressureCentre, type PressureContour,
} from "./pressureContours";

type Arrow = FieldVector;
interface Plot { left: number; top: number; width: number; height: number }
interface Loaded { key: string; scope: string; arrows?: Arrow[]; thinned?: boolean; error?: string }

export function FieldOverlays({ metadata, variable, wind = false, pressure, settings, indices, bounds, plot, labelSize, geometry, spatialDimension, reserve, onStatus, children }: {
  metadata: Metadata; variable: Variable; wind?: boolean; pressure?: Variable; settings: FieldSettings;
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
    key: string; scope: string; contours?: PressureContour[]; extrema?: PressureCentre[]; mesh?: ContourMesh; error?: string;
  }>();
  const scope = JSON.stringify([metadata.dataset_id, variable.path, variable.view_hint, bounds, spatialDimension]);
  const source = useMemo(() => pressure && pressureVariable(metadata, pressure), [metadata, pressure]);
  const components = settings.components[metadata.dataset_id!];
  const pair = windPair(metadata, variable, undefined, components).pair;
  const windScope = JSON.stringify([scope, components, pair?.u.path, pair?.v.path, pair?.uUnit, pair?.vUnit]);
  const pressureScope = `${scope}:${source?.path}:${JSON.stringify(source?.attributes)}:${settings.pressureInterval}`;
  // A resize changes the index stride but not the source, so it refetches
  // without clearing the drawn lattice.
  const slots = windSlots(plot);
  const windKey = `${windScope}:${JSON.stringify(indices)}:${slots.x}x${slots.y}`;
  const pressureKey = `${pressureScope}:${JSON.stringify(indices)}`;
  useEffect(() => {
    if (!wind) return;
    const controller = new AbortController();
    void loadArrows(metadata, variable, indices, bounds, plot, geometry, spatialDimension, controller.signal, components)
      .then(field => { if (!controller.signal.aborted) setLoadedWind({ key: windKey, scope: windScope, ...field }); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setLoadedWind({ key: windKey, scope: windScope, error }); onStatus(`Wind: ${error}. Turn Wind off and on to retry.`);
      });
    return () => controller.abort();
  }, [wind, windKey, geometry, metadata, variable, onStatus]);
  useEffect(() => {
    if (!pressure) return;
    const controller = new AbortController();
    const load = source ? loadPressureContours(metadata, variable, source, indices, bounds, geometry, controller.signal, settings.pressureInterval)
      : Promise.reject(new Error("No matching pressure field in this source"));
    void load.then(field => { if (!controller.signal.aborted) setLoadedPressure({ key: pressureKey, scope: pressureScope, ...field }); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setLoadedPressure({ key: pressureKey, scope: pressureScope, error }); onStatus(`Pressure contours: ${error}. Turn the layer off and on to retry.`);
      });
    return () => controller.abort();
  }, [Boolean(pressure), pressureKey, source, geometry, metadata, variable, onStatus]);
  const currentWind = wind && loadedWind?.key === windKey ? loadedWind : undefined;
  const currentPressure = pressure && loadedPressure?.key === pressureKey ? loadedPressure : undefined;
  // Retain marks during a sample change, but never reuse them for another
  // source or viewport. Readiness still requires the requested sample for export.
  const visibleWind = wind && loadedWind?.scope === windScope ? loadedWind : undefined;
  const visiblePressure = pressure && loadedPressure?.scope === pressureScope ? loadedPressure : undefined;
  const view = [bounds.minimumX, bounds.maximumX, bounds.minimumY, bounds.maximumY,
    plot.left, plot.top, plot.width, plot.height];
  // Display smoothing is a fraction of the glyph spacing, so it follows the
  // drawn scale; the traced copy is kept until the number of passes changes.
  const passes = visiblePressure?.mesh
    ? smoothingPasses(visiblePressure.mesh, bounds, plot, PLOT_STYLE.pressure.smoothing * latticeSpacing(plot)) : 0;
  const traced = useMemo(() => visiblePressure?.mesh && passes
    ? pressureContours(smoothMesh(visiblePressure.mesh, passes), settings.pressureInterval)
    : visiblePressure?.contours ?? [], [visiblePressure, passes, settings.pressureInterval]);
  const { contours: candidates, centres, extrema, interval } = useMemo(() => {
    const all = projectContours(traced, bounds, plot);
    const centres = projectCentres(visiblePressure?.extrema ?? [], all, bounds, plot, textSize, markSize);
    const extrema = projectExtrema(visiblePressure?.extrema ?? [], bounds, plot);
    const interval = contourInterval(all, plot, settings.pressureInterval);
    const drawn = pruneContours(smoothVisibleContours(all.filter(contour =>
      Math.abs(contour.level / interval - Math.round(contour.level / interval)) < 1e-7), plot), textSize, extrema, interval);
    return { contours: drawn, centres, extrema, interval };
  }, [traced, visiblePressure, settings.pressureInterval, textSize, markSize, ...view]);
  const centreBoxes = useMemo(() => centres.map(centre => centreBox(centre, textSize, markSize)),
    [centres, textSize, markSize]);
  const reserved = useMemo(() => [...centreBoxes, ...(reserve ? [reserve] : [])],
    [centreBoxes, reserve?.left, reserve?.right, reserve?.top, reserve?.bottom]);
  // The wind lattice is the fixed scaffold, as on a station plot: a label can
  // slide along its own line, a glyph cannot move, and a hole punched in a
  // regular lattice is more visible than the collision it avoids.
  const marks = useMemo(() => fieldVectorMarks(visibleWind?.arrows ?? [], bounds, plot,
    reserved, settings.windStyle, textSize * PLOT_STYLE.wind.labelClearance, visibleWind?.thinned),
    [visibleWind, reserved, settings.windStyle, textSize, ...view]);
  // The wind lattice is complete: labels find gaps in its ink and never move a glyph.
  const labels = useMemo(() => contourLabels(candidates, plot, textSize, reserved, marks),
    [candidates, reserved, marks, textSize, ...view]);
  const contours = useMemo(() => drawnContours(candidates, labels, extrema, interval), [candidates, labels, extrema, interval]);
  const glyphs = marks;
  const standard = standardLevel([...new Set(contours.map(contour => contour.level))]);
  const contourPaths = useMemo(() => {
    const levels = new Map<number, string[]>();
    for (const contour of contours) {
      const path = contour.points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join("");
      if (!levels.has(contour.level)) levels.set(contour.level, []);
      levels.get(contour.level)!.push(path);
    }
    return [...levels].map(([level, paths]) => ({ level, path: paths.join("") }));
  }, [contours]);
  const barbs = settings.windStyle === "barb";
  // Calm rings carry no fill; every other glyph does, so a pennant knocks the
  // field out along with its outline.
  const windPath = glyphs.filter(mark => !mark.calm).map(mark => mark.path).join("");
  const calmPath = glyphs.filter(mark => mark.calm).map(mark => mark.path).join("");
  return <g className="field-overlays" pointerEvents="none">
    <defs>
      <clipPath id={id}><rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} /></clipPath>
      {/* The label sits in a break in the line, not under a halo: a halo ring
          reads as a second, paler contour. The break follows the digits. */}
      <mask id={maskId} maskUnits="userSpaceOnUse"
        x={plot.left} y={plot.top} width={plot.width} height={plot.height}>
        <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} fill="white" />
        {labels.map((label, index) => <text key={`label-${index}`} className="pressure-contour-knockout"
          x={label.x} y={label.y} fontSize={textSize} transform={`rotate(${label.angle} ${label.x} ${label.y})`}
          textAnchor="middle" dominantBaseline="central" fill="black" stroke="black"
          strokeWidth={PLOT_STYLE.pressure.labelKnockout * 2} strokeLinejoin="round">{label.text}</text>)}
        {centreBoxes.map((box, index) => <rect key={`centre-${index}`} fill="black"
          x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} />)}
      </mask>
    </defs>
    {pressure && <g className="pressure-contours" data-pressure={currentPressure?.error ? "error" : currentPressure?.contours ? "ready" : "loading"}>
      {currentPressure?.error && <text className="wind-key pressure-key" x={8} y={plot.top - 20}>Contours unavailable</text>}
      <g clipPath={`url(#${id})`} mask={`url(#${maskId})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {contourPaths.map(contour => <path key={contour.level} className="pressure-contour"
          data-level={contour.level} data-standard={contour.level === standard || undefined} d={contour.path} strokeDasharray={contour.level < 0 ? "5 3" : undefined}
          stroke={PLOT_STYLE.ink} style={{ strokeWidth: dataStroke(contour.level === standard ? PLOT_STYLE.pressure.standardWidth : CONTOUR_WIDTH) }} />)}
      </g>
    </g>}
    {children}
    {wind && <g className="wind-field" data-wind={currentWind?.error ? "error" : currentWind?.arrows ? "ready" : "loading"}>
      {currentWind?.error && <text className="wind-key" x={8} y={plot.top - 20}>Wind unavailable</text>}
      {/* The glyph carries a transparent halo, not a painted casing: the halo
          keeps labels and centre marks off the glyph, and leaves the isobar it
          crosses whole. One pass per fill keeps a dense field to two paths. */}
      <g className={barbs ? "wind-field-barbs" : undefined} clipPath={`url(#${id})`}
        strokeLinecap="round" strokeLinejoin="round">
        <path className={barbs ? undefined : "wind-arrows"} d={windPath}
          fill={barbs ? PLOT_STYLE.ink : "none"} stroke={PLOT_STYLE.ink}
          style={{ strokeWidth: dataStroke(barbs ? PLOT_STYLE.wind.fieldBarbWidth : PLOT_STYLE.wind.width) }} />
        <path d={calmPath} fill="none" stroke={PLOT_STYLE.ink} style={{ strokeWidth: dataStroke(PLOT_STYLE.wind.fieldBarbWidth) }} />
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

/** Glyph slots across and down the pane, and so the number of grid points a
    regular source is thinned to. */
function windSlots(plot: Plot) {
  const spacing = latticeSpacing(plot);
  return { x: Math.max(1, Math.round(plot.width / spacing)), y: Math.max(1, Math.round(plot.height / spacing)) };
}

const MAX_WIND_SAMPLES = 31;

async function loadArrows(metadata: Metadata, variable: Variable, indices: Record<string, number>, bounds: ViewBounds, plot: Plot, geometry: MeshGeometry | undefined, spatialDimension: string | undefined, signal: AbortSignal, components?: WindComponents): Promise<{ arrows: Arrow[]; thinned: boolean }> {
  const reason = fieldWindReason(metadata, variable, components);
  if (reason) throw new Error(reason);
  const match = windPair(metadata, variable, undefined, components);
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
  if (spatial.some(path => !visible.has(path))) return { arrows: [], thinned: false };
  // A rectilinear source is a regular lattice already. Thinning it by index
  // keeps the drawn field regular and keeps a grid point in place across zoom
  // and resize; a curvilinear or mesh source has no such regularity and is
  // fetched densely, then thinned by screen bins where it is drawn.
  const thinned = hint.kind === "rectilinear";
  const slots = windSlots(plot);
  for (const path of spatial) {
    const range = visible.get(path)!;
    if (thinned) {
      ranges.set(path, gridStride(range, path === xVariable.dimensions[0].path ? slots.x : slots.y, MAX_WIND_SAMPLES));
      continue;
    }
    ranges.set(path, { start: range.min, stop: range.max + 1, stride: Math.max(1, Math.ceil((range.max - range.min + 1) / (spatial.length === 2 ? MAX_WIND_SAMPLES : 1000))) });
  }
  const { request, shape } = windSampleRequest(pair.u, ranges, indices, metadata.limits.max_response_bytes);
  const u = await fetchSlice(request, signal);
  const v = await fetchSlice({ ...request, path: pair.v.path }, signal);
  if (u.shape.join() !== shape.join() || v.shape.join() !== shape.join()) throw new Error("Wind response differs from its sample plan");
  const values = windValues(u.values, v.values, pair);
  const ordered = pair.u.dimensions.filter(dim => ranges.has(dim.path));
  const arrows = Array.from(values.u, (east, slot) => {
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

  return { arrows, thinned };
}
