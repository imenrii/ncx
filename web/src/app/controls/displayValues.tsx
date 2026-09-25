/**
 * Samples behind the Display range histogram. Plots inside the primary pane
 * publish what they draw; appended Steering panels have their own ranges and
 * sit outside the provider, so they publish nothing. Keep the immutable parts
 * separate so publishing a frame does not copy every pane's samples.
 */
import { createContext, useContext, useEffect, useId, useMemo, useSyncExternalStore } from "react";

export type DisplaySamples = readonly Float32Array[];

export function createDisplayValues() {
  let owners = new Map<string, DisplaySamples>();
  let parts: DisplaySamples | undefined;
  const listeners = new Set<() => void>();
  const store = {
    publish(owner: string, values: DisplaySamples | undefined) {
      if (owners.get(owner) === values) return;
      owners = new Map(owners);
      if (values) owners.set(owner, values); else owners.delete(owner);
      parts = owners.size ? [...owners.values()].flat() : undefined;
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => parts,
  };
  return store;
}

export type DisplayValues = ReturnType<typeof createDisplayValues>;
export const DisplayValuesContext = createContext<DisplayValues | undefined>(undefined);

export function useDisplayValues(store: DisplayValues): DisplaySamples | undefined {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Publish the samples this plot draws, while it is mounted. */
export function usePublishDisplayValues(values: Float32Array | DisplaySamples | undefined): void {
  const store = useContext(DisplayValuesContext);
  const owner = useId();
  const parts = useMemo(() => values instanceof Float32Array ? [values] : values, [values]);
  useEffect(() => { store?.publish(owner, parts); }, [store, owner, parts]);
  useEffect(() => () => store?.publish(owner, undefined), [store, owner]);
}
