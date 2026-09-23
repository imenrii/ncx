/**
 * Samples behind the Display range histogram. Plots inside the primary pane
 * publish what they draw; appended Steering panels have their own ranges and
 * sit outside the provider, so they publish nothing. Only the Display panel
 * subscribes, so a publish does not re-render the plots.
 */
import { createContext, useContext, useEffect, useId, useSyncExternalStore } from "react";

export function createDisplayValues() {
  let owners = new Map<string, ArrayLike<number>>();
  let union: ArrayLike<number> | undefined;
  const listeners = new Set<() => void>();
  const store = {
    publish(owner: string, values: ArrayLike<number> | undefined) {
      if (owners.get(owner) === values) return;
      owners = new Map(owners);
      if (values) owners.set(owner, values); else owners.delete(owner);
      const parts = [...owners.values()];
      // ponytail: one union copy per publish; bin per owner if large meshes make this slow.
      if (parts.length < 2) union = parts[0];
      else {
        const joined = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
        let offset = 0;
        for (const part of parts) { joined.set(part, offset); offset += part.length; }
        union = joined;
      }
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => union,
  };
  return store;
}

export type DisplayValues = ReturnType<typeof createDisplayValues>;
export const DisplayValuesContext = createContext<DisplayValues | undefined>(undefined);

export function useDisplayValues(store: DisplayValues): ArrayLike<number> | undefined {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Publish the samples this plot draws, while it is mounted. */
export function usePublishDisplayValues(values: ArrayLike<number> | undefined): void {
  const store = useContext(DisplayValuesContext);
  const owner = useId();
  useEffect(() => { store?.publish(owner, values); }, [store, owner, values]);
  useEffect(() => () => store?.publish(owner, undefined), [store, owner]);
}
