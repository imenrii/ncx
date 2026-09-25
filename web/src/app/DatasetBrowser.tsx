import { useMemo, useState, type ReactNode } from "react";

import type { DatasetSummary, Metadata } from "../data/model";
import type { OutlineName } from "../steering/model";
import { supportingVariablePaths, variableLabel } from "../data/model";
import { Swatch, type StripSource } from "./SourceStrip";

export function DatasetBrowser({
  footer,
  workspace,
  metadata,
  selectedPath,
  search,
  onSearch,
  onSelect,
}: {
  metadata: Metadata;
  selectedPath: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (path: string) => void;
  footer?: ReactNode;
  workspace?: ReactNode;
}) {
  const [showSupporting, setShowSupporting] = useState(false);
  const query = search.trim().toLowerCase();
  const supportingPaths = useMemo(() => supportingVariablePaths(metadata), [metadata]);
  const visibleCount = countVisible(metadata, supportingPaths, showSupporting);
  return (
    <aside className="sidebar">
      <div className="variable-filter">
        <input
          className="field variable-search"
          type="search"
          placeholder={`Filter variables (${visibleCount} variables)`}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        {supportingPaths.size > 0 && (
          <label className="tick-label">
            <input
              type="checkbox"
              checked={showSupporting}
              onChange={(event) => setShowSupporting(event.target.checked)}
            />
            <span className="tick-box" />
            Show Mesh/Coordinates ({supportingPaths.size})
          </label>
        )}
      </div>
      <div className="tree">
        {workspace}
        <VariableGroups
          metadata={metadata}
          supportingPaths={supportingPaths}
          showSupporting={showSupporting}
          query={query}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      </div>
      <MetadataWarnings metadata={metadata} />
      {footer}
    </aside>
  );
}

/**
 * Several datasets: one row per file. Names wrap in full; a plotted file shows
 * its line; the primary file opens in place to its variables. Choosing another
 * file makes it primary.
 */
export function CollectionBrowser({
  workspace,
  datasets,
  metadata,
  selectedDataset,
  selectedPath,
  search,
  plotted,
  footer,
  onSearch,
  onSelect,
}: {
  datasets: DatasetSummary[];
  metadata: Metadata;
  selectedDataset: string;
  selectedPath: string;
  search: string;
  plotted: readonly StripSource[];
  footer?: ReactNode;
  workspace?: ReactNode;
  onSearch: (value: string) => void;
  onSelect: (dataset: string, path: string) => void;
}) {
  const [showSupporting, setShowSupporting] = useState(false);
  const query = search.trim().toLowerCase();
  const supportingPaths = useMemo(() => supportingVariablePaths(metadata), [metadata]);
  const plottedCount = datasets.filter(dataset => plotted.some(source => source.id === dataset.id)).length;
  const files = datasets.filter(dataset => !query || dataset.id === selectedDataset ||
    fileName(dataset).toLowerCase().includes(query));
  return (
    <aside className="sidebar collection-sidebar">
      <div className="variable-filter">
        <input
          className="field variable-search"
          type="search"
          placeholder="Filter files and variables"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        {supportingPaths.size > 0 && (
          <label className="tick-label">
            <input type="checkbox" checked={showSupporting} onChange={(event) => setShowSupporting(event.target.checked)} />
            <span className="tick-box" />
            Show Mesh/Coordinates ({supportingPaths.size})
          </label>
        )}
      </div>
      <div className="tree files" role="list" aria-label="Files">
        {workspace}
        <div className="files-head">
          <span className="key-label">Files</span>
          <span className="val">{datasets.length}{plottedCount > 1 ? ` · ${plottedCount} plotted` : ""}</span>
        </div>
        {files.map((dataset) => {
          const selected = dataset.id === selectedDataset;
          const source = plotted.find(item => item.id === dataset.id);
          // A named dataset (`--dataset id=file`) keeps its ID beside the file name.
          const alias = dataset.state === "ready" && !dataset.label.endsWith(dataset.name) ? dataset.label : undefined;
          const facts = [alias, dataset.state === "unavailable" ? "unavailable"
            : dataset.state === "ready" ? `${dataset.variables} variable${dataset.variables === 1 ? "" : "s"}` : undefined,
          ].filter(Boolean).join(" · ") || undefined;
          return (
            <div key={dataset.id} role="listitem" className="file" data-state={dataset.state}>
              <button className="file-row" aria-current={selected || undefined} disabled={dataset.state === "unavailable" && !selected}
                title={dataset.state === "unavailable" ? dataset.error : dataset.label}
                onClick={() => { if (!selected) onSelect(dataset.id, selectedPath); }}>
                {source ? <Swatch style={source.style} /> : <span aria-hidden="true" />}
                <span className="name">{fileName(dataset)}</span>
                {facts && <small>{facts}</small>}
              </button>
              {selected && metadata.dataset_id === dataset.id && (
                <div className="file-variables">
                  <VariableGroups
                    metadata={metadata}
                    supportingPaths={supportingPaths}
                    showSupporting={showSupporting}
                    query={fileName(dataset).toLowerCase().includes(query) ? "" : query}
                    selectedPath={selectedPath}
                    onSelect={(path) => onSelect(dataset.id, path)}
                  />
                  <MetadataWarnings metadata={metadata} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {footer}
    </aside>
  );
}

/** Derived Variables bound to workspace names; source lookups already appear under their file. */
export function WorkspaceGroup({ names, search, selectedId, onSelect }: {
  names: readonly OutlineName[];
  search: string;
  selectedId?: string;
  onSelect: (name: string) => void;
}) {
  const query = search.trim().toLowerCase();
  const rows = names.filter(item => item.variable?.derived && (!query || item.name.toLowerCase().includes(query)));
  if (!rows.length) return null;
  return (
    <details className="variable-group" open>
      <summary>[Workspace]</summary>
      {rows.map(({ name, objectId, variable }) => (
        <button key={name} className="row-item variable-row" aria-selected={objectId === selectedId}
          title={`${variable!.name} · shown with panels[0].show(${name})`} onClick={() => onSelect(name)}>
          <span>{name}</span>
          <small>{variable!.dtype} · {variable!.shape.join("×") || "scalar"}</small>
        </button>
      ))}
    </details>
  );
}

function fileName(dataset: DatasetSummary): string {
  return dataset.state === "ready" ? dataset.name : dataset.label;
}

function VariableGroups({
  metadata,
  supportingPaths,
  showSupporting,
  query,
  selectedPath,
  onSelect,
}: {
  metadata: Metadata;
  supportingPaths: Set<string>;
  showSupporting: boolean;
  query: string;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  return metadata.groups.map((group) => {
    const variables = metadata.variables.filter((variable) => {
      const parent = variable.path.slice(0, variable.path.lastIndexOf("/")) || "/";
      return (
        parent === group.path &&
        (showSupporting || !supportingPaths.has(variable.path)) &&
        (!query || variable.path.toLowerCase().includes(query))
      );
    });
    if (!variables.length) return null;
    return (
      <details className="variable-group" key={group.path} open>
        <summary>{group.path === "/" ? "root group" : group.path}</summary>
        {variables.map((variable) => (
          <button
            key={variable.path}
            className="row-item variable-row"
            data-supporting={supportingPaths.has(variable.path) || undefined}
            aria-selected={variable.path === selectedPath}
            title={`${variableLabel(variable)} · ${variable.dimensions.map((dimension) => dimension.name).join(", ") || "scalar"}`}
            onClick={() => onSelect(variable.path)}
          >
            <span>{variable.name}</span>
            <small>{variable.dtype} · {variable.dimensions.map((dimension) => dimension.length).join("×") || "scalar"}</small>
          </button>
        ))}
      </details>
    );
  });
}

function countVisible(
  metadata: Metadata,
  supportingPaths: Set<string>,
  showSupporting: boolean,
): number {
  return metadata.variables.filter(
    (variable) => showSupporting || !supportingPaths.has(variable.path),
  ).length;
}

function MetadataWarnings({ metadata }: { metadata: Metadata }) {
  if (!metadata.warnings.length) return null;
  return (
    <details className="warnings">
      <summary>{metadata.warnings.length} metadata warning{metadata.warnings.length === 1 ? "" : "s"}</summary>
      {metadata.warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </details>
  );
}
