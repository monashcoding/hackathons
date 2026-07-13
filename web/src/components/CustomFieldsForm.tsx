import { useState } from "react";
import type { FieldWithValue } from "../api.ts";

// Renders organiser-defined custom fields with the subject's current answers and
// saves them as a { fieldId: value } map. Shared by the participant form and the
// team-lead form on the dashboard.
export function CustomFieldsForm({
  title,
  fields,
  onSave,
}: {
  title: string;
  fields: FieldWithValue[];
  onSave: (responses: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(
    Object.fromEntries(fields.map((f) => [f.id, f.value ?? (f.type === "multiselect" ? [] : f.type === "checkbox" ? false : "")])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  if (fields.length === 0) return null;
  const set = (id: string, v: unknown) => setValues((prev) => ({ ...prev, [id]: v }));

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await onSave(values);
      setMsg("Saved.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {fields.map((f) => (
        <div key={f.id} style={{ marginBottom: 10 }}>
          <label>
            {f.label}
            {f.required && <span className="error"> *</span>}
          </label>
          {f.type === "text" && (
            <input type="text" value={String(values[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)} />
          )}
          {f.type === "checkbox" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
              <input type="checkbox" checked={values[f.id] === true} onChange={(e) => set(f.id, e.target.checked)} />
              Yes
            </label>
          )}
          {f.type === "select" && (
            <select value={String(values[f.id] ?? "")} onChange={(e) => set(f.id, e.target.value)}>
              <option value="">— choose —</option>
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          )}
          {f.type === "multiselect" && (
            <div>
              {f.options.map((o) => {
                const arr = Array.isArray(values[f.id]) ? (values[f.id] as string[]) : [];
                return (
                  <label key={o} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 12, color: "var(--text)" }}>
                    <input
                      type="checkbox"
                      checked={arr.includes(o)}
                      onChange={(e) => set(f.id, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
                    />
                    {o}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <button onClick={save} disabled={busy}>Save answers</button>
      {msg && <span className={msg === "Saved." ? "ok" : "error"} style={{ marginLeft: 12 }}>{msg}</span>}
    </div>
  );
}
