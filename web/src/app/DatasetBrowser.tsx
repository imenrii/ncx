import { useEffect, useMemo, useState, type ReactNode } from "react";

import { fetchMetadata } from "../data/api";
import type { DatasetSummary, Metadata } from "../data/model";
import { supportingVariablePaths, variableLabel } from "../data/model";

export function DatasetBrowser({
  navigation,
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
  navigation?: ReactNode;
}) {
  const [showSupporting, setShowSupporting] = useState(false);
  const query = search.trim().toLowerCase();
  const supportingPaths = useMemo(() => supportingVariablePaths(metadata), [metadata]);
  const visibleCount = countVisible(metadata, supportingPaths, showSupporting);
  return (
    <aside className="sidebar">
      {navigation && <div className="dataset-head">{navigation}</div>}
      <div className="variable-filter">
        <input
          className="variable-search"
          type="search"
          placeholder={`Filter variables (${visibleCount} variables)`}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        {supportingPaths.size > 0 && (
          <label>
            <input
              type="checkbox"
              checked={showSupporting}
              onChange={(event) => setShowSupporting(event.target.checked)}
            />
            Show coordinates and mesh geometry ({supportingPaths.size})
          </label>
        )}
      </div>
      <div className="tree">
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
    </aside>
  );
}

type LoadedCollectionFile = {
  metadata: Metadata;
  supportingPaths: Set<string>;
};

export function CollectionBrowser({
  datasets,
  metadata,
  selectedDataset,
  selectedPath,
  search,
  onSearch,
  onReady,
  onUnavailable,
  onSelect,
}: {
  datasets: DatasetSummary[];
  metadata: Metadata;
  selectedDataset: string;
  selectedPath: string;
  search: string;
  onSearch: (value: string) => void;
  onReady: (dataset: string, metadata: Metadata) => void;
  onUnavailable: (dataset: string, error: string) => void;
  onSelect: (dataset: string, path: string) => void;
}) {
  const [showSupporting, setShowSupporting] = useState(false);
  const [loaded, setLoaded] = useState<Map<string, LoadedCollectionFile>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const query = search.trim().toLowerCase();

  useEffect(() => {
    const id = metadata.dataset_id || selectedDataset;
    setLoaded((current) => {
      if (current.get(id)?.metadata === metadata) return current;
      const next = new Map(current);
      next.set(id, { metadata, supportingPaths: supportingVariablePaths(metadata) });
      return next;
    });
  }, [metadata, selectedDataset]);

  const load = (dataset: DatasetSummary) => {
    if (dataset.state === "unavailable" || loaded.has(dataset.id) || loading.has(dataset.id)) return;
    setLoading((current) => new Set(current).add(dataset.id));
    void fetchMetadata(dataset.id)
      .then((nextMetadata) => {
        setLoaded((current) => new Map(current).set(dataset.id, {
          metadata: nextMetadata,
          supportingPaths: supportingVariablePaths(nextMetadata),
        }));
        onReady(dataset.id, nextMetadata);
      })
      .catch((error: unknown) => {
        onUnavailable(dataset.id, error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setLoading((current) => {
          const next = new Set(current);
          next.delete(dataset.id);
          return next;
        });
      });
  };

  const supportingCount = [...loaded.values()].reduce(
    (total, file) => total + file.supportingPaths.size,
    0,
  );
  return (
    <aside className="sidebar collection-sidebar">
      <div className="dataset-head">
        <span>{datasets.length} files</span>
      </div>
      <div className="variable-filter">
        <input
          className="variable-search"
          type="search"
          placeholder="Filter loaded variables"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        {supportingCount > 0 && (
          <label>
            <input
              type="checkbox"
              checked={showSupporting}
              onChange={(event) => setShowSupporting(event.target.checked)}
            />
            Show coordinates and mesh geometry ({supportingCount})
          </label>
        )}
      </div>
      <div className="tree collection-tree">
        {datasets.map((dataset) => {
          const file = loaded.get(dataset.id);
          const fileSelectedPath = dataset.id === selectedDataset ? selectedPath : "";
          const visibleCount = file
            ? countVisible(file.metadata, file.supportingPaths, showSupporting)
            : dataset.state === "ready" ? dataset.variables : undefined;
          return (
            <details
              className={`collection-file ${dataset.state}`}
              key={dataset.id}
              open={dataset.id === selectedDataset || undefined}
              onToggle={(event) => event.currentTarget.open && load(dataset)}
            >
              <summary>
                <strong>{dataset.state === "ready" ? dataset.name : dataset.label}</strong>
                <span>{dataset.state === "unavailable"
                  ? "unavailable"
                  : visibleCount === undefined ? "not inspected" : `${visibleCount} variables`}</span>
              </summary>
              {loading.has(dataset.id) && !file && <p className="collection-note">Loading metadata…</p>}
              {dataset.state === "unavailable" && <p className="collection-error">{dataset.error}</p>}
              {file && (
                <>
                  <VariableGroups
                    metadata={file.metadata}
                    supportingPaths={file.supportingPaths}
                    showSupporting={showSupporting}
                    query={query}
                    selectedPath={fileSelectedPath}
                    onSelect={(path) => onSelect(dataset.id, path)}
                  />
                  <MetadataWarnings metadata={file.metadata} />
                </>
              )}
            </details>
          );
        })}
      </div>
    </aside>
  );
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
            className="variable-row"
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
