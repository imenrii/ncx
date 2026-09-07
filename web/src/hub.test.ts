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
  value: {
    baseURI: "http://host/ncx/",
    querySelector(selector: string) {
      return selector === "base[href]"
        ? { href: "http://host/ncx/", getAttribute: () => "/ncx/" }
        : null;
    },
  },
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
  currentHubCacheKey,
  currentHubSessionRecord,
  inspectHub,
  isRemoteAddress,
  parseHubDeepLink,
  rememberAddress,
  retargetHubSession,
  savedAddresses,
  sessionDestination,
  sessionFetch,
  sessionTransition,
} = await import("./hub.ts");

test("deep links use the hub base path and decode one URL layer", () => {
  assert.equal(
    parseHubDeepLink("/ncx/snd2%40hkss11%3A%2Fpath%2Frun%2520.nc", "/ncx"),
    "snd2@hkss11:/path/run%20.nc",
  );
  assert.equal(
    parseHubDeepLink("/ncx/snd2%40hkss11%3A%2Fpath%2Frun.nc"),
    "snd2@hkss11:/path/run.nc",
  );
  assert.equal(parseHubDeepLink("/ncx/", "/ncx"), undefined);
  assert.throws(
    () => parseHubDeepLink("/ncx/snd2%40hkss11%3A%2Fbad%", "/ncx"),
    /URL encoding/,
  );
  assert.throws(
    () => parseHubDeepLink("/ncx/snd2%40hkss11%3A%2Fbad%00.nc", "/ncx"),
    /control character/,
  );
  assert.throws(() => parseHubDeepLink("/ncx/data%2Frun.nc", "/ncx"), /remote/);
});

test("remote addresses are the only password-bearing targets", () => {
  assert.equal(isRemoteAddress("user@host:/data/a.nc"), true);
  assert.equal(isRemoteAddress("/data/a.nc"), false);
  assert.equal(sessionDestination("user@host:/data/a.nc"), "user@host");
  assert.equal(sessionDestination("/data/a.nc"), "local");
  assert.equal(sessionTransition(undefined, "user@host:/data/a.nc"), "new");
  const active = { id: "0123456789abcdef0123456789abcdef", destination: "user@host", address: "user@host:/data/a.nc" };
  assert.equal(sessionTransition(active, active.address), "same");
  assert.equal(sessionTransition(active, "user@host:/data/b.nc"), "retarget");
  assert.equal(sessionTransition(active, "other@host:/data/b.nc"), "new");
});

test("addresses persist only after explicit saving", () => {
  sessionStorage.clear();
  localStorage.clear();
  assert.deepEqual(savedAddresses(), []);
  rememberAddress("user@host:/data/a.nc");
  rememberAddress("user@host:/data/a.nc");
  assert.deepEqual(savedAddresses(), ["user@host:/data/a.nc"]);
  assert.equal(sessionStorage.length, 0);
});

test("hub session creation stores only a structured address record", async () => {
  sessionStorage.clear();
  localStorage.clear();
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
    await createHubSession("user@host:/data/a.nc", { password: "secret", save: true });
    const record = currentHubSessionRecord();
    assert.deepEqual(record, {
      id: "0123456789abcdef0123456789abcdef",
      destination: "user@host",
      address: "user@host:/data/a.nc",
    });
    assert.doesNotMatch(sessionStorage.getItem("ncx.hub.session") ?? "", /secret/);
    assert.deepEqual(savedAddresses(), ["user@host:/data/a.nc"]);
    const body = JSON.parse(String(requests[0].init?.body));
    assert.deepEqual(body, { address: "user@host:/data/a.nc", password: "secret" });

    await sessionFetch("http://host/ncx/api/datasets", { cache: "no-store" });
    const headers = new Headers(requests.at(-1)?.init?.headers);
    assert.equal(headers.get("X-Ncx-Session"), "0123456789abcdef0123456789abcdef");
    await closeHubSession();
    assert.equal(sessionStorage.getItem("ncx.hub.session"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("same-destination retarget sends no password and changes the cache key", async () => {
  sessionStorage.setItem("ncx.hub.session", JSON.stringify({
    id: "0123456789abcdef0123456789abcdef",
    destination: "user@host",
    address: "user@host:/data/a.nc",
  }));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ session: "0123456789abcdef0123456789abcdef" }, { status: 200 });
  };
  try {
    const previousKey = currentHubCacheKey();
    await retargetHubSession("user@host:/data/b.nc");
    const request = requests[0];
    assert.equal(new Headers(request.init?.headers).get("X-Ncx-Session"), "0123456789abcdef0123456789abcdef");
    assert.deepEqual(JSON.parse(String(request.init?.body)), { address: "user@host:/data/b.nc" });
    assert.equal(currentHubSessionRecord()?.address, "user@host:/data/b.nc");
    assert.notEqual(currentHubCacheKey(), previousKey);
    assert.doesNotMatch(String(request.init?.body), /password|secret/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refresh inspection reuses the stored address without creating a session", async () => {
  sessionStorage.setItem("ncx.hub.session", JSON.stringify({
    id: "0123456789abcdef0123456789abcdef",
    destination: "user@host",
    address: "user@host:/data/a.nc",
  }));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ hub: true, active: true });
  };
  try {
    assert.deepEqual(await inspectHub(), { hub: true, active: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init?.method, undefined);
    assert.match(String(requests[0].url), /api\/session$/);
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
