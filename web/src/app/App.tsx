import { useEffect, useState, useRef } from "react";
import { fetchDatasets, fetchMetadata } from "../data/api";
import { defaultVariable, type DatasetSummary, type Metadata } from "../data/model";
import { Viewer } from "./Viewer";

/** Dataset selection stays mounted while the viewer changes variables and plots. */
export function App({ allowComparison = true }: { allowComparison?: boolean }) {
  const [metadata, setMetadata] = useState<Metadata>();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [collection, setCollection] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [startupError, setStartupError] = useState<string>();
  const [status, setStatus] = useState("opening dataset…");
  const requestedVariable = useRef<{ dataset: string; path: string } | undefined>(undefined);

  const ready = (id: string, next: Metadata) => setDatasets((current) => current.map((dataset) =>
    dataset.id === id ? inspectedDataset(dataset, next) : dataset));
  const unavailable = (id: string, error: string) => setDatasets((current) => current.map((dataset) =>
    dataset.id === id ? { id: dataset.id, label: dataset.label, state: "unavailable", error } : dataset));

  useEffect(() => {
    fetchDatasets()
      .then(({ datasets: nextDatasets, collection: nextCollection }) => {
        setDatasets(nextDatasets);
        setCollection(nextCollection);
        setSelectedDataset(nextDatasets[0].id);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setStartupError(message);
        setStatus(message);
      });
  }, []);

  useEffect(() => {
    if (!selectedDataset) return;
    let active = true;
    setStartupError(undefined);
    setStatus(`opening ${selectedDataset}…`);
    fetchMetadata(selectedDataset)
      .then((nextMetadata) => {
        if (!active) return;
        ready(selectedDataset, nextMetadata);
        setMetadata(nextMetadata);
        const requested = requestedVariable.current?.dataset === selectedDataset
          ? requestedVariable.current.path
          : undefined;
        requestedVariable.current = undefined;
        const initial = requested && nextMetadata.variables.some((candidate) => candidate.path === requested)
          ? requested
          : defaultVariable(nextMetadata)?.path ?? "";
        setSelectedPath(initial);
        setStatus(`${nextMetadata.variables.length} variables · metadata ready`);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        unavailable(selectedDataset, message);
        const next = collection
          ? datasets.find((dataset) => dataset.id !== selectedDataset && dataset.state !== "unavailable")
          : undefined;
        if (next) {
          setSelectedDataset(next.id);
          return;
        }
        setStartupError(message);
        setStatus(message);
      });
    return () => { active = false; };
  }, [selectedDataset]);

  return <Viewer
    allowComparison={allowComparison}
    metadata={metadata} datasets={datasets} collection={collection}
    selectedDataset={selectedDataset} selectedPath={selectedPath}
    startupError={startupError} status={status} onStatus={setStatus}
    onSelectDataset={setSelectedDataset}
    onDatasetReady={ready} onDatasetUnavailable={unavailable}
    onSelectVariable={(dataset, path) => {
      if (dataset === selectedDataset) setSelectedPath(path);
      else {
        requestedVariable.current = { dataset, path };
        setSelectedDataset(dataset);
      }
    }}
  />;
}

function inspectedDataset(dataset: DatasetSummary, metadata: Metadata): DatasetSummary {
  return {
    id: dataset.id,
    label: dataset.label,
    state: "ready",
    name: metadata.dataset.name,
    variables: metadata.variables.length,
    dimensions: metadata.dimensions.length,
    warnings: metadata.warnings.length,
  };
}
