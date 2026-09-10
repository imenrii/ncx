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
  replaceHubSession,
  retargetHubSession,
  savedAddresses,
  sessionDestination,
  sessionFetch,
  sessionTransition,
  splitHubAddress,
  withHubSessionTransition,
} = await import("./hub.ts");

if (false) {
  // @ts-expect-error The removed boolean form could hide a password-bearing call.
  void createHubSession("/data/a.nc", false);
}

test("deep links use the hub base path and decode one URL layer", () => {
  assert.equal(
    parseHubDeepLink("/ncx/user%40compute.test%3A%2Fpath%2Frun%2520.nc", "/ncx"),
    "user@compute.test:/path/run%20.nc",
  );
  assert.equal(
    parseHubDeepLink("/ncx/user%40compute.test%3A%2Fpath%2Frun.nc"),
    "user@compute.test:/path/run.nc",
  );
  assert.equal(parseHubDeepLink("/ncx/", "/ncx"), undefined);
  assert.throws(
    () => parseHubDeepLink("/ncx/user%40compute.test%3A%2Fbad%", "/ncx"),
    /URL encoding/,
  );
  assert.throws(
    () => parseHubDeepLink("/ncx/user%40compute.test%3A%2Fbad%00.nc", "/ncx"),
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

test("hub form separates SSH credentials from dataset paths", () => {
  assert.deepEqual(splitHubAddress("user@host:/data/a.nc"), { credential: "user@host", path: "/data/a.nc" });
  assert.deepEqual(splitHubAddress("cluster:/data/a.nc"), { credential: "cluster", path: "/data/a.nc" });
  assert.deepEqual(splitHubAddress("/data/a.nc"), { credential: "", path: "/data/a.nc" });
  assert.deepEqual(splitHubAddress(""), { credential: "", path: "" });
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

test("a session transition aborts active API work and holds new work until resume", async () => {
  sessionStorage.setItem("ncx.hub.session", JSON.stringify({
    id: "0123456789abcdef0123456789abcdef",
    destination: "local",
    address: "/data/a.nc",
  }));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let activeAborted = false;
  globalThis.fetch = (input, init) => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          activeAborted = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }
    return Promise.resolve(new Response(String(input), { status: 200 }));
  };
  try {
    const active = sessionFetch("http://host/ncx/api/data");
    void active.catch(() => undefined);
    await Promise.resolve();
    let held: Promise<Response> | undefined;
    await withHubSessionTransition(async () => {
      held = sessionFetch("http://host/ncx/api/meta");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(activeAborted, true);
      assert.equal(calls, 1);
    });
    await assert.rejects(active, { name: "AbortError" });
    assert.equal((await held!).status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sessionFetch combines a caller abort signal and removes the tracked request", async () => {
  const originalFetch = globalThis.fetch;
  const caller = new AbortController();
  globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
  try {
    const request = sessionFetch("http://host/ncx/api/data", { signal: caller.signal });
    caller.abort();
    await assert.rejects(request, { name: "AbortError" });
    await withHubSessionTransition(async () => undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed close keeps the active session record", async () => {
  const record = {
    id: "0123456789abcdef0123456789abcdef",
    destination: "local",
    address: "/data/a.nc",
  };
  sessionStorage.setItem("ncx.hub.session", JSON.stringify(record));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: { message: "close failed" } },
    { status: 503 },
  );
  try {
    await assert.rejects(closeHubSession(), /close failed/);
    assert.deepEqual(currentHubSessionRecord(), record);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("replacement creates first and reports old-session cleanup failure", async () => {
  const old = {
    id: "0123456789abcdef0123456789abcdef",
    destination: "user@old",
    address: "user@old:/a.nc",
  };
  const replacement = "fedcba9876543210fedcba9876543210";
  sessionStorage.setItem("ncx.hub.session", JSON.stringify(old));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method?: string; body?: string; session?: string | null }> = [];
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      session: headers.get("X-Ncx-Session"),
    });
    if (init?.method === "POST") {
      return Response.json({ session: replacement }, { status: 201 });
    }
    return Response.json({ error: { message: "old close failed" } }, { status: 503 });
  };
  try {
    const result = await replaceHubSession("user@new:/b.nc", { password: "secret", save: false });
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].session, null);
    assert.equal(requests[1].method, "DELETE");
    assert.equal(requests[1].session, old.id);
    assert.match(result.cleanupWarning ?? "", /old close failed/);
    assert.deepEqual(currentHubSessionRecord(), {
      id: replacement,
      destination: "user@new",
      address: "user@new:/b.nc",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed replacement creation leaves the old session active", async () => {
  const old = {
    id: "0123456789abcdef0123456789abcdef",
    destination: "user@old",
    address: "user@old:/a.nc",
  };
  sessionStorage.setItem("ncx.hub.session", JSON.stringify(old));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: { message: "authentication failed" } },
    { status: 502 },
  );
  try {
    await assert.rejects(
      replaceHubSession("user@new:/b.nc", { password: "secret" }),
      /authentication failed/,
    );
    assert.deepEqual(currentHubSessionRecord(), old);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
