import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ContentItem, type PublicEventResponse } from "../api.ts";
import { fmtDateRange, fmtTime } from "../format.ts";

// The public face of the club. Served entirely from Postgres (the Notion cache)
// — never a live Notion proxy — so it stays up even if Notion is down. Mobile-
// first; this gets shared on socials and read on a phone.
export function Landing() {
  const [data, setData] = useState<PublicEventResponse | null>(null);
  const [state, setState] = useState<"loading" | "empty" | "ready" | "error">("loading");

  useEffect(() => {
    api
      .publicEvent()
      .then((d) => {
        if (!d) return setState("empty");
        setData(d);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <Shell><p className="muted">Loading…</p></Shell>;
  if (state === "error")
    return <Shell><p className="error">Couldn't load the event right now.</p></Shell>;
  if (state === "empty" || !data)
    return (
      <Shell>
        <div className="hero">
          <h1>MAC Hackathon</h1>
          <p className="muted">No event is published yet. Check back soon.</p>
        </div>
      </Shell>
    );

  const { event, content } = data;
  return (
    <Shell>
      <section className="hero">
        <h1>{event.name}</h1>
        {event.tagline && <p className="tagline">{event.tagline}</p>}
        <p className="muted">
          {fmtDateRange(event.startsAt, event.endsAt)}
          {event.venue ? ` · ${event.venue}` : ""}
        </p>
        <p className="muted">Teams of {event.minTeamSize}–{event.maxTeamSize}.</p>
        <div className="cta-row">
          <a className="btn" href="https://events.humanitix.com/" target="_blank" rel="noreferrer">
            Get your ticket
          </a>
          {event.devpostUrl && (
            <a className="btn secondary" href={event.devpostUrl} target="_blank" rel="noreferrer">
              Devpost
            </a>
          )}
        </div>
      </section>

      <Section title="Prizes" items={content.prize} render={(p) => <CardBody item={p} />} />
      <Section title="Judges" items={content.judge} render={(p) => <PersonBody item={p} />} />
      <Section
        title="Schedule"
        items={content.schedule_item}
        render={(p) => (
          <div>
            {p.time && <span className="badge">{fmtTime(p.time)}</span>}
            <CardBody item={p} />
          </div>
        )}
      />
      <Section
        title="Sponsors"
        items={content.sponsor}
        render={(p) => <PersonBody item={p} />}
      />
      <Section
        title="FAQ"
        items={content.faq}
        render={(p) => (
          <div>
            <strong>{p.question ?? p.title}</strong>
            {p.answerHtml && <Html html={p.answerHtml} />}
          </div>
        )}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public">
      <nav className="topnav">
        <Link to="/" className="brand">MAC Hackathon</Link>
        <div>
          <Link to="/dashboard" className="navlink">My dashboard</Link>
          <Link to="/past" className="navlink">Past events</Link>
          <Link to="/admin" className="navlink">Organisers</Link>
        </div>
      </nav>
      <div className="wrap">{children}</div>
    </div>
  );
}

function Section({
  title,
  items,
  render,
}: {
  title: string;
  items: ContentItem[];
  render: (item: ContentItem) => React.ReactNode;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section>
      <h2>{title}</h2>
      <div className="cards">
        {items.map((it, i) => (
          <div className="card" key={i}>
            {it.imageUrl && <img className="card-img" src={it.imageUrl} alt="" />}
            {render(it)}
          </div>
        ))}
      </div>
    </section>
  );
}

function CardBody({ item }: { item: ContentItem }) {
  return (
    <div>
      {item.title && <strong>{item.title}</strong>}
      {item.subtitle && <div className="muted">{item.subtitle}</div>}
      {item.bodyHtml && <Html html={item.bodyHtml} />}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="navlink">
          Learn more
        </a>
      )}
    </div>
  );
}

function PersonBody({ item }: { item: ContentItem }) {
  return (
    <div>
      {item.title && <strong>{item.title}</strong>}
      {item.subtitle && <div className="muted">{item.subtitle}</div>}
      {item.bodyHtml && <Html html={item.bodyHtml} />}
    </div>
  );
}

// Content HTML is sanitised at sync time (server-side), so it is safe to render.
// We never sanitise here — the trust boundary is the sync, not the browser.
function Html({ html }: { html: string }) {
  return <div className="rich" dangerouslySetInnerHTML={{ __html: html }} />;
}
