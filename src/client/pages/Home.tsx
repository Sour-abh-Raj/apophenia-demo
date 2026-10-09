import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function HomePage() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  return (
    <div className="page narrow">
      <div className="card join-card">
        <div className="eyebrow">Perception Lab</div>
        <h1>Join your class activity</h1>
        <label className="field">Session code
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" autoFocus
            className="code-input" data-testid="home-code" onKeyDown={(e) => e.key === "Enter" && code.length === 6 && nav(`/j/${code}`)} />
        </label>
        <button className="btn primary big" disabled={code.trim().length !== 6} onClick={() => nav(`/j/${code.trim()}`)} data-testid="home-go">Continue</button>
      </div>
      <p className="center muted small"><Link to="/host">Instructor</Link></p>
    </div>
  );
}
