import { Link } from "react-router-dom";

// 👉 EXERCISE 2 — see FRONTEND_GUIDE.md ("Exercise 2: the Find-a-Team page").
//
// A step up from Exercise 1: this page both READS and WRITES data, so you'll
// practise the full loop — load data, let the user change something, send that
// change to the server, then re-load so the screen matches reality.
//
// Rebuild it so it:
//   1. Loads the pool of people looking for a team:  api.findTeam()
//   2. Handles being signed out: if the fetch throws a NotSignedInError,
//      show the <SignInPanel/> component instead of the pool.
//   3. Has a checkbox to opt in / out of the pool:
//         api.updateProfile({ lookingForTeam: true|false })
//   4. If the signed-in user leads a team with a free slot, shows an
//      "Invite to my team" button next to each person:
//         api.inviteFromPool(myTeamId, participantId)
//   5. After ANY write, re-fetches so the UI reflects the new state.
//
// Things you'll use (all already built):
//   • api.findTeam / updateProfile / inviteFromPool, the FindTeamResponse type,
//     and NotSignedInError            → web/src/api.ts
//   • <SignInPanel/>                  → web/src/components/SignInPanel.tsx
//   • The "load → mutate → refresh" pattern, done in full:
//                                       web/src/pages/Dashboard.tsx
//
// Delete this placeholder and the TODO note once your version works.
export function FindTeam() {
  return (
    <div className="public">
      <nav className="topnav">
        <Link to="/" className="brand">MAC Hackathon</Link>
        <div>
          <Link to="/dashboard" className="navlink">My dashboard</Link>
        </div>
      </nav>
      <div className="wrap">
        <h1>Find a team</h1>
        <p className="muted">🚧 TODO: build this page — see FRONTEND_GUIDE.md (Exercise 2).</p>
      </div>
    </div>
  );
}
