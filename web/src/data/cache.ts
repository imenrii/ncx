interface Entry<T> {
  promise: Promise<T>;
  controller: AbortController;
  bytes?: number;
}

/** Pending work is deduplicated; only completed entries participate in byte eviction. */
export class AsyncByteCache<T> {
  private entries = new Map<string, Entry<T>>();
  private pending = new Set<AbortController>();
  private retained = 0;
  private maxBytes: number;
  private sizeOf: (value: T) => number;
  private maxEntries: number;
  private maxPending: number;

  constructor(maxBytes: number, sizeOf: (value: T) => number, maxEntries = 128, maxPending = 32) {
    this.maxBytes = maxBytes;
    this.sizeOf = sizeOf;
    this.maxEntries = maxEntries;
    this.maxPending = maxPending;
  }

  get bytes(): number { return this.retained; }

  load(key: string, create: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }
    if (this.pending.size >= this.maxPending) return Promise.reject(new Error("Reader busy; retry shortly"));
    const controller = new AbortController();
    this.pending.add(controller);
    const entry: Entry<T> = { controller, promise: Promise.resolve().then(() => create(controller.signal)) };
    entry.promise = entry.promise.then(value => {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (this.entries.get(key) === entry) {
        const bytes = this.sizeOf(value);
        if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid cache size");
        entry.bytes = bytes;
        this.retained += entry.bytes;
        this.evict();
      }
      return value;
    }).catch(error => {
      if (this.entries.get(key) === entry) {
        this.retained -= entry.bytes ?? 0;
        this.entries.delete(key);
      }
      throw error;
    }).finally(() => { this.pending.delete(controller); });
    this.entries.set(key, entry);
    return entry.promise;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
    this.retained = 0;
  }

  private evict(): void {
    let completed = Array.from(this.entries.values()).filter(entry => entry.bytes !== undefined).length;
    for (const [key, entry] of this.entries) {
      if (this.retained <= this.maxBytes && completed <= this.maxEntries) break;
      if (entry.bytes === undefined) continue;
      this.retained -= entry.bytes;
      this.entries.delete(key);
      completed -= 1;
    }
  }
}
