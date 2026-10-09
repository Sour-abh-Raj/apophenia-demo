import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a server-scoped view fresh: initial fetch, refetch on every SSE "update" ping,
 * plus a polling fallback (for networks/proxies that buffer SSE) and refetch on tab focus.
 */
export function useLive<T>(fetcher: () => Promise<T>, sseUrl: string | null, pollMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [connected, setConnected] = useState(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return inflight.current; }
    const run = (async () => {
      try { setData(await fetchRef.current()); setError(null); }
      catch (e) { setError(e as Error); }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    if (again.current) { again.current = false; void refresh(); }
  }, []);

  useEffect(() => {
    void refresh();
    let es: EventSource | null = null;
    if (sseUrl) {
      es = new EventSource(sseUrl);
      es.addEventListener("update", () => void refresh());
      es.onopen = () => { setConnected(true); void refresh(); };
      es.onerror = () => setConnected(false);
    }
    const t = setInterval(() => void refresh(), pollMs);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onVis);
    return () => {
      es?.close();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onVis);
    };
  }, [sseUrl, pollMs, refresh]);

  return { data, setData, error, connected, refresh };
}
