import { useEffect, useId, useMemo, useState } from "react";
import { fetchCoordinate, fetchSlice } from "../data/api";
import type { Metadata, Variable } from "../data/model";
import { windPair, windValues, windSampleRequest, fieldWindReason } from "../data/wind";
import type { MeshGeometry } from "./mesh";
import type { ViewBounds } from "./view";
import { arrowVector, meshWindAnchors } from "./windGeometry";

interface Arrow { longitude: number; latitude: number; u: number; v: number }
interface Plot { left: number; top: number; width: number; height: number }

export function WindFieldOverlay({ metadata, variable, indices, bounds, plot, geometry, spatialDimension, onStatus }: {
  metadata: Metadata; variable: Variable; indices: Record<string, number>; bounds: ViewBounds;
  plot: Plot; geometry?: MeshGeometry; spatialDimension?: string; onStatus: (message: string) => void;
}) {
  const id = `wind-${useId().replaceAll(":", "")}`;
  const [loaded, setLoaded] = useState<{ key: string; arrows?: Arrow[]; error?: string }>();
  const key = JSON.stringify([metadata.dataset_id, variable.path, variable.view_hint, indices, bounds, spatialDimension]);
  useEffect(() => {
    const controller = new AbortController();
    void loadArrows(metadata, variable, indices, bounds, geometry, spatialDimension, controller.signal)
      .then(arrows => { if (!controller.signal.aborted) setLoaded({ key, arrows }); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setLoaded({ key, error }); onStatus(`Wind: ${error}. Turn Wind off and on to retry.`);
      });
    return () => controller.abort();
  }, [key, geometry, metadata, variable, onStatus]);
  const current = loaded?.key === key ? loaded : undefined;
  const paths = useMemo(() => {
    const bins = new Set<string>();
    const result: string[] = [];
    const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
    for (const arrow of current?.arrows ?? []) {
      const x = plot.left + (arrow.longitude - bounds.minimumX) * sx;
      const y = plot.top + plot.height - (arrow.latitude - bounds.minimumY) * sy;
      const bin = `${Math.floor((x - plot.left) / 40)}:${Math.floor((y - plot.top) / 40)}`;
      if (x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height || bins.has(bin)) continue;
      const direction = arrowVector(arrow.u, arrow.v, arrow.latitude, sx, sy);
      if (!direction) continue;
      bins.add(bin);
      const dx = direction.x / 2, dy = direction.y / 2;
      result.push(`M${x - dx} ${y - dy}L${x + dx} ${y + dy}m${-dx * 0.45 - dy * 0.3} ${-dy * 0.45 + dx * 0.3}L${x + dx} ${y + dy}l${-dx * 0.45 + dy * 0.3} ${-dy * 0.45 - dx * 0.3}`);
      if (result.length === 1000) break;
    }
    return result;
  }, [current, bounds, plot]);
  return <g className="wind-field" data-wind={current?.error ? "error" : current?.arrows ? "ready" : "loading"} pointerEvents="none">
    <text className="wind-key" x={8} y={plot.top - 20}>{current?.error ? "Wind unavailable · see status" : "10 m wind · equal-length arrows"}</text>
    <defs><clipPath id={id}><rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} /></clipPath></defs>
    <g clipPath={`url(#${id})`} fill="none">
      <path d={paths.join("")} stroke="white" strokeWidth={2.5} strokeOpacity={0.8} />
      <path className="wind-arrows" d={paths.join("")} stroke="#101418" strokeWidth={1} />
    </g>
  </g>;
}

async function loadArrows(metadata: Metadata, variable: Variable, indices: Record<string, number>, bounds: ViewBounds, geometry: MeshGeometry | undefined, spatialDimension: string | undefined, signal: AbortSignal): Promise<Arrow[]> {
  const reason = fieldWindReason(metadata, variable);
  if (reason) throw new Error(reason);
  const match = windPair(metadata, variable);
  if (!match.pair) throw new Error(match.reason);
  const pair = match.pair, hint = variable.view_hint;
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
