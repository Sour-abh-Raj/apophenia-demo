/** Minimal fetch wrapper. Credentials are sent as headers (never cookies). */
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) { super(message); }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, (data.error as string) ?? `Request failed (${res.status})`, data);
  return data as T;
}

/* ---------- local credential storage (per browser) ---------- */
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
export const store = {
  get: (k: string) => safe(() => localStorage.getItem(k), null),
  set: (k: string, v: string) => safe(() => localStorage.setItem(k, v), undefined),
  del: (k: string) => safe(() => localStorage.removeItem(k), undefined),
};
export const participantKey = (code: string) => `apl:p:${code.toUpperCase()}`;
export const hostKey = (sid: string) => `apl:host:${sid}`;
export const screenKeyStore = (sid: string) => `apl:screen:${sid}`;

export interface HostSessionRef { sessionId: string; code: string; title: string; createdAt: string }
export const hostSessions = {
  list: (): HostSessionRef[] => safe(() => JSON.parse(localStorage.getItem("apl:host:sessions") ?? "[]"), []),
  add: (s: HostSessionRef) => store.set("apl:host:sessions", JSON.stringify([s, ...hostSessions.list().filter((x) => x.sessionId !== s.sessionId)].slice(0, 20))),
  remove: (sid: string) => store.set("apl:host:sessions", JSON.stringify(hostSessions.list().filter((x) => x.sessionId !== sid))),
};
