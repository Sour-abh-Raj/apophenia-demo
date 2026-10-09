import { useState, type ReactNode } from "react";

/** Confirmation dialog for consequential actions. Optional typed confirmation word. */
export function Confirm({ title, body, confirmLabel, typeWord, danger, onConfirm, onCancel, busy }: {
  title: string; body: ReactNode; confirmLabel: string; typeWord?: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ok = !typeWord || typed.trim().toUpperCase() === typeWord;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <h3>{title}</h3>
        <div className="modal-body">{body}</div>
        {typeWord && (
          <label className="field">Type <b>{typeWord}</b> to confirm
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} disabled={!ok || busy} data-testid="confirm-btn">
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
