import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();
  get length() { return this.#values.size; }
  clear() { this.#values.clear(); }
  getItem(key: string) { return this.#values.get(key) ?? null; }
  key(index: number) { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string) { this.#values.delete(key); }
  setItem(key: string, value: string) { this.#values.set(key, value); }
}

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: { baseURI: "http://host/ncx/" },
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: new MemoryStorage(),
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

const {
  closeHubSession,
  createHubSession,
  inspectHub,
  rememberAddress,
  savedAddresses,
  sessionFetch,
} = await import("./hub.ts");

test("addresses persist only after explicit saving", () => {
  assert.deepEqual(savedAddresses(), []);
  rememberAddress("user@host:/data/a.nc");
  rememberAddress("user@host:/data/a.nc");
  assert.deepEqual(savedAddresses(), ["user@host:/data/a.nc"]);
});

test("hub session creation stores an opaque session and relayed fetches send it", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("api/session") && init?.method === "POST") {
      return Response.json({ session: "0123456789abcdef0123456789abcdef" }, { status: 201 });
    }
    return new Response("ok");
  };
  try {
    await createHubSession("/data/a.nc", false);
    await sessionFetch("http://host/ncx/api/datasets", { cache: "no-store" });
    const headers = new Headers(requests.at(-1)?.init?.headers);
    assert.equal(headers.get("X-Ncx-Session"), "0123456789abcdef0123456789abcdef");
    await closeHubSession();
    assert.equal(sessionStorage.getItem("ncx.hub.session"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hub detection distinguishes a viewer and clears an expired session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("missing", { status: 404 });
  assert.deepEqual(await inspectHub(), { hub: false, active: false });

  sessionStorage.setItem("ncx.hub.session", "expired");
  globalThis.fetch = async () => Response.json({ hub: true, active: false });
  assert.deepEqual(await inspectHub(), { hub: true, active: false });
  assert.equal(sessionStorage.getItem("ncx.hub.session"), null);
  globalThis.fetch = originalFetch;
});
