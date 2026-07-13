import { signIn } from "../api.ts";

// Redirect sign-in via mac-auth. Any Google/Microsoft account works — the
// sign-in identity does not need to match the ticket email (that's what the
// order-reference claim flow is for).
export function SignInPanel({ message }: { message?: string }) {
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>Sign in</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {message ?? "Sign in with your MAC account to continue."}
      </p>
      <div className="row" style={{ flex: "0 0 auto" }}>
        <button onClick={() => signIn("google")}>Sign in with Google</button>
        <button className="secondary" onClick={() => signIn("microsoft")}>
          Sign in with Microsoft
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        It doesn't need to be the email you bought your ticket with.
      </p>
    </div>
  );
}
