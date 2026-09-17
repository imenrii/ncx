import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LatestSliceLoader } from "./api";
import type { DataSlice, SliceRequest } from "./model";

export function useSlice(request: SliceRequest, enabled: boolean, callbacks: {
  ready: (slice: DataSlice) => void;
  failed: (error: Error) => void;
}) {
  const loader = useRef<LatestSliceLoader | null>(null);
  const [state, setState] = useState<{ slice?: DataSlice; loading: boolean; error?: string }>({ loading: enabled });
  const accept = useEffectEvent((slice: DataSlice) => {
    setState({ slice, loading: false });
    callbacks.ready(slice);
  });
  const reject = useEffectEvent((error: Error) => {
    setState(current => ({ ...current, loading: false, error: error.message }));
    callbacks.failed(error);
  });
  useEffect(() => {
    loader.current = new LatestSliceLoader();
    return () => { loader.current?.dispose(); };
  }, []);
  const key = JSON.stringify(request);
  useEffect(() => {
    if (!enabled) {
      loader.current?.dispose();
      loader.current = new LatestSliceLoader();
      setState(current => ({ ...current, loading: false }));
      return;
    }
    setState(current => ({ ...current, loading: true }));
    loader.current!.request({ request, accept, reject });
  }, [key, enabled]);
  return state;
}
