import { useState } from "react";
import { DEV_AUTH, devSignIn, signIn } from "../api.ts";

// Sign in via mac-auth. In production this is the redirect SSO flow (any
// Google/Microsoft account — the sign-in identity need not match the ticket
// email; that's what order-reference claiming is for). Under the local Vite dev
// server it becomes a fake dev login, since real SSO only works on a
// *.monashcoding.com origin.
export function SignInPanel({ message }: { message?: string }) {
  if (DEV_AUTH) return <DevSignIn message={message} />;
  return (
    <div className="panel">
      <h2>Sign in</h2>
      <p className="muted mt-0">
        {message ?? "Sign in with your MAC account to continue."}
      </p>
      <div className="actions">
        <button onClick={() => signIn("google")}>Sign in with Google</button>
        <button className="secondary" onClick={() => signIn("microsoft")}>
          Sign in with Microsoft
        </button>
      </div>
      <p className="muted mb-0 mt-3">
        It doesn't need to be the email you bought your ticket with.
      </p>
    </div>
  );
}

// DEV ONLY: fake sign-in so auth-gated pages work on localhost without real
// mac-auth. Pick a name/email and whether this dev user is an organiser.
function DevSignIn({ message }: { message?: string }) {
  const [name, setName] = useState("Dev User");
  const [email, setEmail] = useState("dev@example.com");
  const [organiser, setOrganiser] = useState(false);

  function go() {
    // Stable id per name so re-signing in maps to the same participant.
    const macUserId = "dev-" + name.trim().toLowerCase().replace(/\s+/g, "-");
    devSignIn({ macUserId, email: email.trim(), name: name.trim(), organiser });
    window.location.reload();
  }

  return (
    <div className="panel border-accent">
      <h2>Dev sign-in</h2>
      <p className="muted mt-0">
        {message ?? "Local dev mode — real mac-auth SSO only works on hackathons.monashcoding.com."}
      </p>
      <div className="row">
        <div>
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Email</label>
          <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-text">
        <input type="checkbox" checked={organiser} onChange={(e) => setOrganiser(e.target.checked)} />
        Organiser (committee role)
      </label>
      <div className="actions">
        <button onClick={go} disabled={!name.trim() || !email.trim()}>Sign in (dev)</button>
      </div>
    </div>
  );
}
