import { useEffect, useState } from "react";
import { api, type ContentItem, type PublicEvent, type PublicEventResponse } from "../api.ts";
import { fmtDateRange, fmtTime } from "../format.ts";
import { TopNav } from "../components/TopNav.tsx";

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
        <h1>MAC Hackathon</h1>
        <p className="muted">Team up, build for a weekend, ship something you're proud of.</p>
      </section>

      <ActiveEventCard event={event} />

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

// The "active event" card on the landing page — cover image with an EVENT pill,
// title, description, date + venue chips, and a prominent "Get your ticket" CTA.
function ActiveEventCard({ event }: { event: PublicEvent }) {
  const registrationOpen = isRegistrationOpen(event);
  return (
    <section className="mt-2">
      <div className="eyebrow">Active event</div>

      <div className="mt-3 rounded-2xl border border-border bg-panel p-3">
        {/* Cover */}
        <div className="relative overflow-hidden rounded-xl">
          {event.coverImageUrl ? (
            <img
              src={event.coverImageUrl}
              alt={event.name}
              className="h-56 w-full object-cover sm:h-72"
            />
          ) : (
            <div className="flex h-56 w-full items-center justify-center bg-gradient-to-br from-accent/30 to-panel px-6 sm:h-72">
              <span className="text-center text-3xl font-bold text-text sm:text-4xl">{event.name}</span>
            </div>
          )}
          <span className="absolute left-3 top-3 rounded-full bg-accent px-3 py-1 text-xs font-bold uppercase tracking-wide text-accent-ink">
            Event
          </span>
          {registrationOpen && (
            <span className="absolute right-3 top-3 rounded-full bg-ok px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#0f2417]">
              Registration open
            </span>
          )}
        </div>

        {/* Body */}
        <h2 className="mt-4 mb-0 text-2xl font-bold">{event.name}</h2>
        {event.tagline && <p className="mt-2 line-clamp-3 text-muted">{event.tagline}</p>}

        {/* Meta chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
            <CalendarIcon />
            {fmtDateRange(event.startsAt, event.endsAt)}
          </span>
          {event.venue && (
            <span className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted">
              <PinIcon />
              {event.venue}
            </span>
          )}
        </div>

        {/* CTA */}
        {event.ticketUrl && (
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block rounded-full bg-accent px-6 py-4 text-center text-base font-bold text-accent-ink no-underline transition hover:brightness-95"
          >
            Get your ticket
          </a>
        )}

        <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
          <span>Teams of {event.minTeamSize}–{event.maxTeamSize}</span>
          {event.devpostUrl && (
            <a href={event.devpostUrl} target="_blank" rel="noreferrer" className="text-accent no-underline hover:underline">
              Devpost →
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// Registration is open server-authoritatively too, but for a badge this
// client-side check is fine — it only decides whether to show a pill.
function isRegistrationOpen(event: PublicEvent): boolean {
  const now = Date.now();
  const opens = event.registrationOpensAt ? Date.parse(event.registrationOpensAt) : null;
  const closes = event.registrationClosesAt ? Date.parse(event.registrationClosesAt) : null;
  if (opens !== null && now < opens) return false;
  if (closes !== null && now > closes) return false;
  return opens !== null || closes !== null; // only show if a window is configured
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public">
      <TopNav />
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
