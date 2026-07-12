import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PublicEvent } from "../api.ts";
import { fmtDateRange } from "../format.ts";

// Archive of previous events. Grows for free every year.
export function Past() {
  const [events, setEvents] = useState<PublicEvent[] | null>(null);

  useEffect(() => {
    api.pastEvents().then((d) => setEvents(d?.events ?? [])).catch(() => setEvents([]));
  }, []);

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
        {events === null && <p className="muted">Loading…</p>}
        {events && events.length === 0 && <p className="muted">No past events yet.</p>}
        {events?.map((e) => (
          <div className="panel" key={e.slug}>
            <strong>{e.name}</strong> <span className="muted">/{e.slug}</span>
            <div className="muted">{fmtDateRange(e.startsAt, e.endsAt)}{e.venue ? ` · ${e.venue}` : ""}</div>
            {e.tagline && <div className="muted">{e.tagline}</div>}
            {e.devpostUrl && (
              <a className="navlink" href={e.devpostUrl} target="_blank" rel="noreferrer">
                Projects on Devpost
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
