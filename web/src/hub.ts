const SESSION_KEY = "ncx.hub.session";
const ADDRESS_KEY = "ncx.hub.addresses";
const apiRoot = new URL("api/", document.baseURI);

export interface HubStatus {
  hub: boolean;
  active: boolean;
}

export function currentHubSession(): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function savedAddresses(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(ADDRESS_KEY) ?? "[]") as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  } catch {
    return [];
  }
}

export function rememberAddress(address: string): void {
  const value = address.trim();
  if (!value) return;
  try {
    const addresses = [value, ...savedAddresses().filter((item) => item !== value)].slice(0, 20);
    localStorage.setItem(ADDRESS_KEY, JSON.stringify(addresses));
  } catch {
    // Storage can be unavailable in a private browser context. Opening still works.
  }
}

export async function inspectHub(): Promise<HubStatus> {
  const response = await sessionFetch(new URL("session", apiRoot), { cache: "no-store" });
  if (response.status === 404) return { hub: false, active: false };
  if (!response.ok) throw new Error(await responseMessage(response));
  const status = (await response.json()) as HubStatus;
  if (status.hub && !status.active) clearSession();
  return status;
}

export async function createHubSession(address: string, save: boolean): Promise<void> {
  const response = await fetch(new URL("session", apiRoot), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const body = (await response.json()) as { session?: unknown };
  if (typeof body.session !== "string" || !/^[0-9a-f]{32}$/.test(body.session)) {
    throw new Error("ncx hub returned an invalid session ID");
  }
  sessionStorage.setItem(SESSION_KEY, body.session);
  if (save) rememberAddress(address);
}

export async function heartbeatHubSession(): Promise<boolean> {
  const response = await sessionFetch(new URL("session/heartbeat", apiRoot), {
    method: "POST",
    cache: "no-store",
  });
  if (response.ok) return true;
  if (response.status === 404) clearSession();
  return false;
}

export async function closeHubSession(keepalive = false): Promise<void> {
  const session = currentHubSession();
  clearSession();
  if (!session) return;
  const headers = new Headers({ "X-Ncx-Session": session });
  await fetch(new URL("session", apiRoot), {
    method: "DELETE",
    cache: "no-store",
    headers,
    keepalive,
  }).catch(() => undefined);
}

export function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const session = currentHubSession();
  if (session) headers.set("X-Ncx-Session", session);
  return fetch(input, { ...init, headers });
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // An unavailable session store is equivalent to no active visit.
  }
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
