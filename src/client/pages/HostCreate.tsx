import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, hostKey, hostSessions, screenKeyStore, store } from "../api";

export function HostCreatePage() {
  const nav = useNavigate();
  const [title, setTitle] = useState("Apophenia Perception Lab — MTM");
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sessions = hostSessions.list().filter((s) => store.get(hostKey(s.sessionId)));

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ sessionId: string; code: string; hostKey: string; screenKey: string }>("POST", "/api/sessions", { title, passcode });
      store.set(hostKey(r.sessionId), r.hostKey);
      store.set(screenKeyStore(r.sessionId), r.screenKey);
      hostSessions.add({ sessionId: r.sessionId, code: r.code, title, createdAt: new Date().toISOString() });
      nav(`/host/${r.sessionId}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="page narrow">
      <div className="card">
        <div className="eyebrow">Instructor</div>
        <h1>Create a session</h1>
        {err && <p className="alert">{err}</p>}
        <label className="field">Session title (shown to students)
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} data-testid="session-title" />
        </label>
        <label className="field">Instructor passcode (set by INSTRUCTOR_PASSCODE on the server)
          <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} data-testid="passcode" onKeyDown={(e) => e.key === "Enter" && create()} />
        </label>
        <button className="btn primary big" onClick={create} disabled={busy || !passcode} data-testid="create-session">{busy ? "Creating…" : "Create session"}</button>
        <p className="muted small">Tip: create a separate session to rehearse. Each session has its own join code and data.</p>
      </div>
      {sessions.length > 0 && (
        <div className="card">
          <h3>Sessions on this browser</h3>
          <ul className="session-list">
            {sessions.map((s) => (
              <li key={s.sessionId}><Link to={`/host/${s.sessionId}`}>{s.title}</Link> <span className="muted">· {s.code} · {new Date(s.createdAt).toLocaleString()}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
