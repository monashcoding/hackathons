import { Link } from "react-router-dom";

// 👉 EXERCISE 1 — see FRONTEND_GUIDE.md ("Exercise 1: the Past Events page").
//
// This is your warm-up: a read-only page. Rebuild it so it:
//   1. Fetches the list of past events when the page loads.
//   2. Shows a "Loading…" message while the request is in flight.
//   3. Renders each event: name, dates, venue, tagline, and (if present) a
//      link to its Devpost.
//   4. Says something friendly if there are no past events yet.
//
// Everything you need already exists — you are only writing the React part:
//   • Data:   api.pastEvents()   →   { events: PublicEvent[] } | null
//             (defined in web/src/api.ts — go read it)
//   • Dates:  fmtDateRange(startsAt, endsAt)
//             (defined in web/src/format.ts)
//   • A page that already does exactly this shape of fetch-then-render:
//             web/src/pages/Landing.tsx  ← copy this pattern
//
// Delete this placeholder and the TODO note once your version works.
export function Past() {
  return (
    <div className="public">
      <nav className="topnav">
        <Link to="/" className="brand">MAC Hackathon</Link>
        <div>
          <Link to="/past" className="navlink">Past events</Link>
          <Link to="/admin" className="navlink">Organisers</Link>
        </div>
      </nav>
      <div className="wrap">
        <h1>Past events</h1>
        <p className="muted">🚧 TODO: build this page — see FRONTEND_GUIDE.md (Exercise 1).</p>
      </div>
    </div>
  );
}
