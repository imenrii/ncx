export function PlotStatus({ loading, message, error }: { loading: boolean; message: string; error?: string }) {
  return <>
    {loading && <span className="plot-loading">{message}</span>}
    {error && <div className="plot-error">{error}</div>}
  </>;
}
