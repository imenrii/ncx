const SESSION_KEY = "ncx.hub.session";
const ADDRESS_KEY = "ncx.hub.addresses";
const apiRoot = new URL("api/", document.baseURI);

export interface HubStatus {
  hub: boolean;
  active: boolean;
}

export interface HubSessionRecord {
  id: string;
  destination: string;
  address: string;
}

export type SessionTransition = "new" | "same" | "retarget";

interface CreateHubSessionOptions {
  password?: string;
  save?: boolean;
}

export function hubBasePath(): string | undefined {
  const base = document.querySelector("base[href]") as HTMLBaseElement | null;
  if (!base) return undefined;
  try {
    const path = new URL(base.getAttribute("href") ?? base.href, document.baseURI).pathname;
    if (!path.startsWith("/") || path === "/") return undefined;
    return path.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** Parse a remote target from the path after the configured hub base. */
export function parseHubDeepLink(
  pathname = window.location.pathname,
  basePath = hubBasePath(),
): string | undefined {
  if (!basePath || basePath === "/") return undefined;
  const prefix = `${basePath}/`;
  if (pathname === basePath || pathname === prefix) return undefined;
  if (!pathname.startsWith(prefix)) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (!encoded) return undefined;

  let address: string;
  try {
    address = decodeURIComponent(encoded);
  } catch {
    throw new Error("The deep-link address has invalid URL encoding");
  }
  if (hasControlCharacter(address)) {
    throw new Error("The deep-link address contains a control character");
  }
  if (!isRemoteAddress(address)) {
    throw new Error("Deep links must contain a remote SSH address");
  }
  return address;
}

export function isRemoteAddress(address: string): boolean {
  const separator = address.lastIndexOf(":/");
  if (separator <= 0) return false;
  const destination = address.slice(0, separator);
  const path = address.slice(separator + 1);
  return (
    destination.length <= 255
    && !destination.startsWith("-")
    && /^[A-Za-z0-9@._-]+$/.test(destination)
    && path.startsWith("/")
    && !hasControlCharacter(address)
  );
}

export function sessionDestination(address: string): string {
  if (isRemoteAddress(address)) {
    return address.slice(0, address.lastIndexOf(":/"));
  }
  return "local";
}

export function sessionTransition(
  current: HubSessionRecord | undefined,
  address: string,
): SessionTransition {
  if (!current || current.address !== address) {
    return current && current.destination === sessionDestination(address) ? "retarget" : "new";
  }
  return "same";
}

export function currentHubSessionRecord(): HubSessionRecord | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as unknown;
    if (!isSessionRecord(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export function currentHubSession(): string | undefined {
  return currentHubSessionRecord()?.id;
}

export function currentHubCacheKey(): string {
  const record = currentHubSessionRecord();
  return record ? `${record.id}:${record.address}` : "viewer";
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
  if (response.status === 404) {
    clearHubSession();
    return { hub: false, active: false };
  }
  if (!response.ok) throw new Error(await responseMessage(response));
  const status = (await response.json()) as HubStatus;
  if (status.hub && !status.active) clearHubSession();
  return status;
}

export async function createHubSession(
  address: string,
  options: CreateHubSessionOptions | boolean = {},
): Promise<HubSessionRecord> {
  const { password, save } = typeof options === "boolean" ? { save: options } : options;
  const body: { address: string; password?: string } = { address };
  if (password !== undefined) body.password = password;
  const response = await fetch(new URL("session", apiRoot), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await responseMessage(response, password));
  const session = await responseSession(response);
  const record = { id: session, destination: sessionDestination(address), address };
  storeHubSession(record);
  if (save) rememberAddress(address);
  return record;
}

export async function retargetHubSession(address: string, save = false): Promise<HubSessionRecord> {
  const current = currentHubSessionRecord();
  if (!current) throw new Error("No active ncx hub session");
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Ncx-Session": current.id,
  });
  const response = await fetch(new URL("session", apiRoot), {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify({ address }),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  const session = await responseSession(response);
  const record = { id: session, destination: sessionDestination(address), address };
  storeHubSession(record);
  if (save) rememberAddress(address);
  return record;
}

export async function heartbeatHubSession(): Promise<boolean> {
  const response = await sessionFetch(new URL("session/heartbeat", apiRoot), {
    method: "POST",
    cache: "no-store",
  });
  if (response.ok) return true;
  if (response.status === 404) clearHubSession();
  return false;
}

export async function closeHubSession(): Promise<void> {
  const session = currentHubSession();
  clearHubSession();
  if (!session) return;
  const headers = new Headers({ "X-Ncx-Session": session });
  await fetch(new URL("session", apiRoot), {
    method: "DELETE",
    cache: "no-store",
    headers,
  }).catch(() => undefined);
}

export function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const session = currentHubSession();
  if (session) headers.set("X-Ncx-Session", session);
  return fetch(input, { ...init, headers });
}

export function clearHubSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // An unavailable session store is equivalent to no active visit.
  }
}

function storeHubSession(record: HubSessionRecord): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
  } catch {
    throw new Error("ncx cannot store the active hub session in this browser");
  }
}

function isSessionRecord(value: unknown): value is HubSessionRecord {
  return Boolean(
    value
    && typeof value === "object"
    && "id" in value
    && typeof value.id === "string"
    && /^[0-9a-f]{32}$/.test(value.id)
    && "destination" in value
    && typeof value.destination === "string"
    && "address" in value
    && typeof value.address === "string"
    && value.address.length > 0
    && !hasControlCharacter(value.address),
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

async function responseSession(response: Response): Promise<string> {
  const body = (await response.json()) as { session?: unknown };
  if (typeof body.session !== "string" || !/^[0-9a-f]{32}$/.test(body.session)) {
    throw new Error("ncx hub returned an invalid session ID");
  }
  return body.session;
}

async function responseMessage(response: Response, secret?: string): Promise<string> {
  let message: string;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    message = body.error?.message ?? `${response.status} ${response.statusText}`;
  } catch {
    message = `${response.status} ${response.statusText}`;
  }
  return secret && message.includes(secret) ? "SSH authentication failed" : message;
}
