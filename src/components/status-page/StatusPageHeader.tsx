'use client';

import { useEffect, useState } from 'react';
import type { PublicStatusBranding } from '@/lib/status-pages/public-contract';

interface StatusPageHeaderProps {
  statusPage: {
    name: string;
    contactEmail?: string | null;
    contactUrl?: string | null;
  };
  branding?: (PublicStatusBranding & { logo?: string }) | null;
  rssHref?: string | null;
  apiHref?: string | null;
  onSubscribeClick?: (() => void) | null;
  /** Visitor browser IANA zone. All visible timestamps on the page use this same value. */
  timeZone: string;
  generatedAt?: string;
  refreshIntervalSeconds?: number | null;
}

function offsetLabel(timeZone: string, at: Date) {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find(part => part.type === 'timeZoneName')?.value ?? timeZone
  );
}

function formatLocalClock(timeZone: string, at: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(at);
}

function formatCountdown(totalSeconds: number) {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function ClockIcon() {
  return (
    <svg
      width="16"
      height="16"
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

function RefreshIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.3-6" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.18 17.82a2.18 2.18 0 1 1-3.08 0 2.18 2.18 0 0 1 3.08 0ZM2 10.18v3.02A8.8 8.8 0 0 1 10.8 22h3.02A11.82 11.82 0 0 0 2 10.18ZM2 3v3.02A17.98 17.98 0 0 1 17.98 22H21A21 21 0 0 0 2 3Z" />
    </svg>
  );
}

function ApiIcon() {
  return (
    <svg
      width="16"
      height="16"
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
      width="16"
      height="16"
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

function SubscribeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 9a2.5 2.5 0 0 1 2.5-2.5H17A2.5 2.5 0 0 1 19.5 9V16A2.5 2.5 0 0 1 17 18.5H6.5A2.5 2.5 0 0 1 4 16V9Z" />
      <path d="m5 7.5 7 5 7-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Slim public top bar. Clock, countdown, and timestamps all use the visitor's browser zone.
 */
export default function StatusPageHeader({
  statusPage,
  branding = {},
  rssHref,
  apiHref,
  onSubscribeClick,
  timeZone,
  generatedAt,
  refreshIntervalSeconds = null,
}: StatusPageHeaderProps) {
  const brand = branding ?? undefined;
  const logoUrl =
    (typeof brand?.logoUrl === 'string' && brand.logoUrl) ||
    (typeof brand?.logo === 'string' && brand.logo) ||
    '/logo.svg';
  const [now, setNow] = useState<Date | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const nextDeadline =
      refreshIntervalSeconds != null && refreshIntervalSeconds > 0
        ? Date.now() + refreshIntervalSeconds * 1000
        : null;
    const id = window.setTimeout(() => setDeadlineMs(nextDeadline), 0);
    return () => window.clearTimeout(id);
  }, [refreshIntervalSeconds, generatedAt]);

  const contactHref =
    statusPage.contactUrl || (statusPage.contactEmail ? `mailto:${statusPage.contactEmail}` : null);
  const localTime = now ? formatLocalClock(timeZone, now) : null;
  const offset = now ? offsetLabel(timeZone, now) : null;
  const zoneName = timeZone.replace(/_/g, ' ');
  const remainingSeconds =
    now && deadlineMs != null ? Math.max(0, Math.ceil((deadlineMs - now.getTime()) / 1000)) : null;

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
          {remainingSeconds != null && (
            <span
              className="status-topbar__chip status-topbar__chip--time"
              title="Seconds until this page fetches the latest published status"
            >
              <RefreshIcon />
              <span className="status-topbar__time" suppressHydrationWarning>
                {formatCountdown(remainingSeconds)}
              </span>
            </span>
          )}
          {onSubscribeClick && (
            <button type="button" className="status-topbar__chip status-topbar__chip--accent" onClick={onSubscribeClick} aria-haspopup="dialog">
              <SubscribeIcon />
              Subscribe
            </button>
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
