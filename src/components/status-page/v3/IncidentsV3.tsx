'use client';

import { memo, useMemo, useState } from 'react';
import type { PublicIncident } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadge from '@/components/incident/StatusBadge';

const INITIAL_VISIBLE = 8;
const DESC_CLAMP_AT = 180;
// Industry standard (Atlassian Statuspage, GitHub, Cloudflare): inline feed is
// Active + Recent ~14d. Full 90d is History — paginated / on-demand.
const RECENT_DISPLAY_DAYS = 14;

function formatDuration(start?: string, end?: string): string | null {
  if (!start) return null;
  const s = Date.parse(start);
  if (Number.isNaN(s)) return null;
  const e = end ? Date.parse(end) : Date.now();
  if (Number.isNaN(e) || e < s) return null;
  const mins = Math.max(1, Math.floor((e - s) / 60000));
  const ongoing = !end;
  if (mins < 60) return ongoing ? `Ongoing · ${mins}m` : `Resolved in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) {
    const tail = m ? ` ${m}m` : '';
    return ongoing ? `Ongoing · ${h}h${tail}` : `Resolved in ${h}h${tail}`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return ongoing ? `Ongoing · ${d}d${rh ? ` ${rh}h` : ''}` : `Resolved in ${d}d${rh ? ` ${rh}h` : ''}`;
}

function IncidentImpactIcon({ impact }: { impact?: string }) {
  const t = (impact ?? '').toUpperCase();
  if (t === 'MAJOR_OUTAGE') {
    return (
      <svg
        className="status-v3-incident-pill__icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (t === 'PARTIAL_OUTAGE') {
    return (
      <svg
        className="status-v3-incident-pill__icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (t === 'DEGRADED') {
    return (
      <svg
        className="status-v3-incident-pill__icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2" />
      </svg>
    );
  }
  return (
    <svg
      className="status-v3-incident-pill__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ClampedDesc({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsClamp = text.length > DESC_CLAMP_AT;
  return (
    <>
      <p
        className={`status-v3-incident-pill__desc${needsClamp && !expanded ? ' status-v3-incident-pill__desc--clamped' : ''}`}
      >
        {text}
      </p>
      {needsClamp && (
        <button
          type="button"
          className="status-v3-pill__expand"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

const IncidentCard = memo(function IncidentCard({
  incident,
  timeZone,
  postmortemHref,
  defaultOpen = false,
}: {
  incident: PublicIncident;
  timeZone: string;
  postmortemHref?: (postmortemId: string) => string;
  defaultOpen?: boolean;
}) {
  const isActive = incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED';
  const impactToken = incident.publicImpact
    ? statusPresentation(incident.publicImpact as unknown as never).token
    : undefined;
  const impactLabel = incident.publicImpact
    ? statusPresentation(incident.publicImpact as unknown as never).label
    : undefined;

  // Privacy-safe title fallback — title may be stripped by showIncidentTitles.
  const title = incident.title?.trim()
    ? incident.title
    : incident.publicEventId
      ? `Incident ${incident.publicEventId.slice(0, 8)}`
      : incident.service?.name
        ? `${incident.service.name} incident`
        : 'Incident';

  const createdAbsolute = incident.createdAt
    ? formatDateTime(incident.createdAt, timeZone, { format: 'short', hour12: true })
    : null;
  const createdRelative = incident.createdAt
    ? formatDateTime(incident.createdAt, timeZone, { format: 'relative' })
    : null;
  const durationLabel = incident.createdAt
    ? formatDuration(incident.createdAt, incident.resolvedAt ?? undefined)
    : null;

  const hasService = Boolean(incident.service?.name);
  const hasRegions = Boolean(incident.service?.regions?.length);
  const hasUpdates = Boolean(incident.updates?.length);
  const hasDescription = Boolean(incident.description);
  const isRedacted = incident.redacted === true;

  return (
    <details
      className={`status-v3-incident-pill${isActive ? ' status-v3-incident-pill--active' : ' status-v3-incident-pill--resolved'}${isRedacted ? ' status-v3-incident-pill--redacted' : ''}`}
      data-status={isActive && impactToken ? impactToken : undefined}
      data-active={isActive ? 'true' : 'false'}
      open={defaultOpen}
    >
      <summary className="status-v3-incident-pill__summary">
        <span className="status-v3-incident-pill__summary-main">
          {isActive && <span className="status-v3-incident-pill__live" aria-hidden="true" />}
          <IncidentImpactIcon impact={incident.publicImpact} />
          <span className="status-v3-incident-pill__title">{title}</span>
          {createdRelative && (
            <>
              <span className="status-v3-incident-pill__divider" aria-hidden="true" />
              <span className="status-v3-incident-pill__time" suppressHydrationWarning title={createdAbsolute ?? undefined}>
                {createdRelative}
              </span>
            </>
          )}
          {hasService && <span className="status-v3-chip status-v3-chip--muted">{incident.service!.name}</span>}
        </span>
        <span className="status-v3-incident-pill__summary-meta">
          {isRedacted && (
            <span
              className="status-v3-chip status-v3-incident-pill__redacted-badge"
              title="Older incidents show limited detail."
            >
              Limited detail
            </span>
          )}
          {incident.publicImpact && impactLabel && (
            <StatusBadge status={incident.publicImpact} label={impactLabel} size="xs" showDot pulse={isActive} />
          )}
          {incident.urgency && <StatusBadge status={incident.urgency} size="xs" />}
          {durationLabel && (
            <span className="status-v3-incident-pill__duration" suppressHydrationWarning>
              {durationLabel}
            </span>
          )}
          <span className="status-v3-incident-pill__chevron" aria-hidden="true" />
        </span>
      </summary>

      <div className="status-v3-incident-pill__body">
        {/* Second line in body for deep meta — keeps summary scannable */}
        {(hasService || hasRegions || createdAbsolute) && (
          <div className="status-v3-incident-pill__subtle" suppressHydrationWarning>
            {hasService && <span>{incident.service!.name}</span>}
            {hasRegions && (
              <>
                {hasService && <span aria-hidden="true"> · </span>}
                <span>{incident.service!.regions!.join(', ')}</span>
              </>
            )}
            {createdAbsolute && (
              <>
                {(hasService || hasRegions) && <span aria-hidden="true"> · </span>}
                <span>Started {createdAbsolute}</span>
              </>
            )}
          </div>
        )}

        {isRedacted ? (
          <p className="status-v3-incident-pill__redacted">Detailed update is hidden for older history.</p>
        ) : (
          hasDescription && <ClampedDesc text={incident.description!} />
        )}

        {!isRedacted && hasUpdates && (
          <ol className="status-v3-incident-pill__updates" role="list">
            {incident.updates!.map(update => {
              const updAbsolute = update.createdAt
                ? formatDateTime(update.createdAt, timeZone, { format: 'short', hour12: true })
                : null;
              const updRelative = update.createdAt
                ? formatDateTime(update.createdAt, timeZone, { format: 'relative' })
                : null;
              return (
                <li key={update.id} className="status-v3-update" role="listitem">
                  <StatusBadge status={update.type} size="xs" />
                  <span className="status-v3-update__message">{update.message}</span>
                  {updRelative && (
                    <span className="status-v3-update__time" suppressHydrationWarning title={updAbsolute ?? undefined}>
                      {updRelative}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {incident.postmortem && (
          <div className="status-v3-incident-pill__pir-row">
            {postmortemHref && (incident.postmortem.id || incident.id) ? (
              <a
                className="status-v3-incident-pill__pir"
                href={postmortemHref(incident.postmortem.id || incident.id || '')}
              >
                <svg
                  className="status-v3-incident-pill__pir-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span className="status-v3-incident-pill__pir-label">
                  {incident.postmortem.title ?? 'View post-incident review'}
                </span>
                <svg
                  className="status-v3-incident-pill__pir-arrow"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </a>
            ) : (
              <span className="status-v3-incident-pill__pir status-v3-incident-pill__pir--muted">
                <svg
                  className="status-v3-incident-pill__pir-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="status-v3-incident-pill__pir-label">
                  {incident.postmortem.title ?? 'Post-incident review available'}
                </span>
              </span>
            )}
          </div>
        )}

        {(hasService || hasRegions) && (
          <div className="status-v3-incident-pill__affects">
            <span className="status-v3-incident-pill__affected-label">Affects:</span>
            {hasService && <span className="status-v3-chip status-v3-chip--muted">{incident.service!.name}</span>}
            {incident.service?.regions?.map(region => (
              <span key={region} className="status-v3-chip status-v3-chip--muted">
                {region}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
});

/**
 * Incident feed — settings-compatible, best-in-class presentation.
 *
 * No new settings are introduced. Every field is optional in the contract because
 * `serializePublicStatusIncident` may strip it; the component hides that row when
 * the data is absent. Pagination and service filter run client-side over the
 * already-sanitized snapshot payload.
 */
export default function IncidentsV3({
  incidents,
  timeZone,
  postmortemHref,
  historyDays,
}: {
  incidents: PublicIncident[];
  timeZone: string;
  postmortemHref?: (postmortemId: string) => string;
  historyDays?: number;
}) {
  const [service, setService] = useState('all');
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const [showHistory, setShowHistory] = useState(false);

  const services = useMemo(() => {
    const byId = new Map<string, string>();
    for (const incident of incidents) {
      if (incident.service?.id && incident.service.name) byId.set(incident.service.id, incident.service.name);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [incidents]);

  const filtered = useMemo(
    () => (service === 'all' ? incidents : incidents.filter(incident => incident.service?.id === service)),
    [incidents, service]
  );

  // Industry: main feed = Active + Recent 14d. Older (14d→90d) lives behind "Incident history".
  // Fixed at mount — feed is ≤ 50 items; re-parsing bounds on every render is wasteful.
  const [nowMs] = useState(() => Date.now());
  const recentCutoffMs = nowMs - RECENT_DISPLAY_DAYS * 86_400_000;

  const { active, recentPast, olderPast } = useMemo(() => {
    const a: PublicIncident[] = [];
    const r: PublicIncident[] = [];
    const o: PublicIncident[] = [];
    for (const item of filtered) {
      const isActive = item.status === 'OPEN' || item.status === 'ACKNOWLEDGED';
      if (isActive) a.push(item);
      else {
        const t = item.createdAt ? Date.parse(item.createdAt) : NaN;
        if (Number.isNaN(t) || t >= recentCutoffMs) r.push(item);
        else o.push(item);
      }
    }
    return { active: a, recentPast: r, olderPast: o };
  }, [filtered, recentCutoffMs]);

  // Industry: main feed = active + recent; older is behind "Incident history".
  const feedBase = useMemo(() => [...active, ...recentPast], [active, recentPast]);
  const feed = showHistory ? filtered : feedBase;
  const hiddenOlderCount = olderPast.length;

  const shown = feed.slice(0, visible);
  const shownActive = shown.filter(i => i.status === 'OPEN' || i.status === 'ACKNOWLEDGED');
  const shownPast = shown.filter(i => i.status !== 'OPEN' && i.status !== 'ACKNOWLEDGED');

  if (incidents.length === 0) {
    return (
      <section className="status-v3-incidents-inline" id="incidents" aria-labelledby="status-v3-incidents-heading">
        <div className="status-v3-incidents-inline__head">
          <div className="status-v3-incidents-inline__title-wrap">
            <h2 id="status-v3-incidents-heading" className="status-v3-incidents-inline__title">
              Incidents
            </h2>
            <span className="status-v3-incidents-inline__subtitle">Active & recent</span>
          </div>
        </div>
        <p className="status-v3-incidents-inline__empty">No incidents reported.</p>
      </section>
    );
  }

  const windowLabel = showHistory
    ? historyDays
      ? `Past ${historyDays}d`
      : 'All time'
    : `Past ${RECENT_DISPLAY_DAYS}d`;
  const tallyTotal = feed.length;
  const subtitlePastCount = showHistory ? filtered.filter(i => i.status !== 'OPEN' && i.status !== 'ACKNOWLEDGED').length : recentPast.length;

  return (
    <section className="status-v3-incidents-inline" id="incidents" aria-labelledby="status-v3-incidents-heading">
      <div className="status-v3-incidents-inline__head">
        <div className="status-v3-incidents-inline__title-wrap">
          <h2 id="status-v3-incidents-heading" className="status-v3-incidents-inline__title">
            Incidents
          </h2>
          <span className="status-v3-incidents-inline__subtitle">
            {windowLabel} · {active.length} active · {subtitlePastCount} resolved
            {hiddenOlderCount > 0 && !showHistory ? ` · +${hiddenOlderCount} in history` : ''}
          </span>
        </div>
        <div className="status-v3-incidents-inline__tally" aria-label={`${tallyTotal} incidents in view`}>
          {active.length > 0 ? (
            <span className="status-v3-incidents-inline__tally-pill status-v3-incidents-inline__tally-pill--active">
              <span className="status-v3-incidents-inline__dot" aria-hidden="true" />
              {active.length} active
            </span>
          ) : subtitlePastCount > 0 ? (
            <span className="status-v3-incidents-inline__tally-pill status-v3-incidents-inline__tally-pill--resolved">
              <span className="status-v3-incidents-inline__dot" aria-hidden="true" />
              {subtitlePastCount} resolved
            </span>
          ) : (
            <span className="status-v3-incidents-inline__tally-pill">
              <span className="status-v3-incidents-inline__dot" aria-hidden="true" />
              {tallyTotal} total
            </span>
          )}
          {services.length > 1 && (
            <label className="status-v3-filter">
              <span className="sr-only">Filter incidents by service</span>
              <select
                value={service}
                onChange={event => {
                  setService(event.target.value);
                  setVisible(INITIAL_VISIBLE);
                }}
              >
                <option value="all">All services ({incidents.length})</option>
                {services.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="status-v3-incidents-inline__empty">
          <p className="status-v3-incidents-inline__empty-title">No incidents for this service.</p>
          <button type="button" className="status-v3-pill__more" onClick={() => setService('all')}>
            Clear filter
          </button>
        </div>
      ) : (
        <div className="status-v3-incidents-inline__list" role="list">
          {/* Collapsed by default — scannable feed; active + past both start closed */}
          {shownActive.map((incident, index) => (
            <div key={incident.id ?? incident.publicEventId ?? `active-${index}`} role="listitem">
              <IncidentCard incident={incident} timeZone={timeZone} postmortemHref={postmortemHref} />
            </div>
          ))}
          {shownPast.map((incident, index) => (
            <div key={incident.id ?? incident.publicEventId ?? `past-${index}`} role="listitem">
              <IncidentCard incident={incident} timeZone={timeZone} postmortemHref={postmortemHref} />
            </div>
          ))}
        </div>
      )}

      {feed.length > visible && (
        <button
          type="button"
          className="status-v3-showmore"
          onClick={() => setVisible(count => count + INITIAL_VISIBLE)}
        >
          Show {Math.min(INITIAL_VISIBLE, feed.length - visible)} more · {feed.length - visible} remaining
        </button>
      )}

      {hiddenOlderCount > 0 && !showHistory && (
        <button
          type="button"
          className="status-v3-incidents-inline__history-toggle"
          onClick={() => {
            setShowHistory(true);
            setVisible(count => Math.max(count, feedBase.length + Math.min(INITIAL_VISIBLE, hiddenOlderCount)));
          }}
          aria-expanded={showHistory}
        >
          <span>View incident history</span>
          <span className="status-v3-incidents-inline__history-count">
            {hiddenOlderCount} older {hiddenOlderCount === 1 ? 'incident' : 'incidents'}
            {historyDays ? ` · past ${historyDays}d` : ''}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}
      {showHistory && hiddenOlderCount > 0 && (
        <button
          type="button"
          className="status-v3-incidents-inline__history-toggle status-v3-incidents-inline__history-toggle--active"
          onClick={() => {
            setShowHistory(false);
            setVisible(INITIAL_VISIBLE);
          }}
          aria-expanded={showHistory}
        >
          <span>Show recent only</span>
          <span className="status-v3-incidents-inline__history-count">Back to past {RECENT_DISPLAY_DAYS}d</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: 'rotate(180deg)' }}>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}
    </section>
  );
}
