import { useState } from "react";
import { api } from "../api.ts";

// Order-reference + surname claim (spec §8.2). Deliberately plain: two fields,
// one button, generic server messages (never leaks whether a reference exists).
export function ClaimForm({ onClaimed }: { onClaimed: () => void }) {
  const [orderReference, setRef] = useState("");
  const [surname, setSurname] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await api.claim(orderReference, surname);
      onClaimed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted mt-0">
        Enter the <strong>order reference</strong> from your Humanitix confirmation email (the short
        code, e.g. <code>7QVD6HEL</code>) and the <strong>surname</strong> on the ticket. If your
        whole team is on one order, each teammate claims their own seat with the same reference.
      </p>
      <div className="row">
        <div>
          <label>Order reference</label>
          <input type="text" value={orderReference} placeholder="7QVD6HEL" onChange={(e) => setRef(e.target.value)} />
        </div>
        <div>
          <label>Surname on ticket</label>
          <input type="text" value={surname} onChange={(e) => setSurname(e.target.value)} />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={submit} disabled={busy || !orderReference || !surname}>
          {busy ? "Checking…" : "Claim my ticket"}
        </button>
      </div>
    </div>
  );
}
