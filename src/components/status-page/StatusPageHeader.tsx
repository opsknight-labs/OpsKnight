'use client';

import { useEffect, useState } from 'react';
import { formatDateTime } from '@/lib/timezone';

interface StatusPageHeaderProps {
  statusPage: {
    name: string;
    contactEmail?: string | null;
    contactUrl?: string | null;
  };
  branding?: Record<string, unknown>;
  rssHref?: string | null;
  apiHref?: string | null;
  /** Visitor browser IANA zone. All visible timestamps on the page use this same value. */
  timeZone: string;
}

function offsetLabel(timeZone: string, at: Date) {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find(part => part.type === 'timeZoneName')?.value ?? timeZone
  );
}

function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.18 17.82a2.18 2.18 0 1 1-3.08 0 2.18 2.18 0 0 1 3.08 0ZM2 10.18v3.02A8.8 8.8 0 0 1 10.8 22h3.02A11.82 11.82 0 0 0 2 10.18ZM2 3v3.02A17.98 17.98 0 0 1 17.98 22H21A21 21 0 0 0 2 3Z" />
    </svg>
  );
}

function ApiIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M8 8 4 12l4 4M16 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Slim public top bar. The clock and every timestamp on the page use the visitor's browser zone.
 */
export default function StatusPageHeader({
  statusPage,
  branding = {},
  rssHref,
  apiHref,
  timeZone,
}: StatusPageHeaderProps) {
  const logoUrl =
    (typeof branding.logoUrl === 'string' && branding.logoUrl) ||
    (typeof branding.logo === 'string' && branding.logo) ||
    '/logo.svg';
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);

  const contactHref =
    statusPage.contactUrl || (statusPage.contactEmail ? `mailto:${statusPage.contactEmail}` : null);
  const localTime = now ? formatDateTime(now, timeZone, { format: 'time', hour12: true }) : null;
  const offset = now ? offsetLabel(timeZone, now) : null;
  const zoneName = timeZone.replace(/_/g, ' ');

  return (
    <header className="status-topbar status-page-header">
      <div className="status-topbar__inner">
        <a className="status-topbar__brand" href="https://opsknight.com/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl}
            alt=""
            onError={event => {
              (event.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <span>{statusPage.name}</span>
        </a>
        <div className="status-topbar__actions">
          {localTime && offset && (
            <span
              className="status-topbar__chip status-topbar__chip--time"
              title={`Times on this page use your browser time zone (${zoneName})`}
            >
              <ClockIcon />
              <span className="status-topbar__time" suppressHydrationWarning>
                {localTime}
              </span>
              <span className="status-topbar__offset" suppressHydrationWarning>
                {offset}
              </span>
            </span>
          )}
          {rssHref && (
            <a className="status-topbar__chip" href={rssHref}>
              <RssIcon />
              RSS
            </a>
          )}
          {apiHref && (
            <a className="status-topbar__chip" href={apiHref}>
              <ApiIcon />
              JSON
            </a>
          )}
          {contactHref && (
            <a className="status-topbar__chip status-topbar__chip--accent" href={contactHref}>
              <MailIcon />
              Contact
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
