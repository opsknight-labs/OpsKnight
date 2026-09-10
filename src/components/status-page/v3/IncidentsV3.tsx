'use client';

import { useMemo, useState } from 'react';
import type { PublicIncident } from '@/lib/status-pages/public-contract';
import { formatDateTime } from '@/lib/timezone';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import StatusBadgeV3 from './StatusBadgeV3';

const INITIAL_VISIBLE = 8;

function IncidentCard({
  incident,
  timeZone,
  postmortemHref,
  defaultOpen,
}: {
  incident: PublicIncident;
  timeZone: string;
  postmortemHref?: (postmortemId: string) => string;
  defaultOpen: boolean;
}) {
  const token = incident.publicImpact ? statusPresentation(incident.publicImpact).token : undefined;
  return (
    <details
      className="status-v3-incident status-incident-card"
      data-status={token}
      open={defaultOpen}
    >
      <summary className="status-v3-incident__summary">
        <span className="status-v3-incident__summary-main">
          {token && <span className={`status-v3-dot status-${token}`} aria-hidden="true" />}
          {incident.title ? (
            <span className="status-v3-incident__title">{incident.title}</span>
          ) : null}
          {incident.service?.name && (
            <span className="status-v3-chip status-v3-chip--muted">{incident.service.name}</span>
          )}
        </span>
        <span className="status-v3-incident__summary-meta">
          {incident.createdAt && (
            <span className="status-muted" suppressHydrationWarning>
              {formatDateTime(incident.createdAt, timeZone, { format: 'short', hour12: true })}
            </span>
          )}
          <span className="status-v3-incident__chevron" aria-hidden="true" />
        </span>
      </summary>
      <div className="status-v3-incident__body">
        {incident.publicImpact && <StatusBadgeV3 status={incident.publicImpact} size="sm" />}
        {incident.urgency ? <span className="status-v3-chip">{incident.urgency}</span> : null}
        {incident.createdAt && (
          <span className="status-muted" suppressHydrationWarning>
            Started{' '}
            {formatDateTime(incident.createdAt, timeZone, { format: 'short', hour12: true })}
          </span>
        )}
        {incident.description && <p className="status-v3-incident__desc">{incident.description}</p>}
        {incident.updates && incident.updates.length > 0 && (
          <ol className="status-v3-incident__updates">
            {incident.updates.map(update => (
              <li key={update.id} className="status-v3-update">
                <span
                  className={`status-v3-update__type status-v3-update--${update.type.toLowerCase()}`}
                >
                  {update.type}
                </span>
                <span className="status-v3-update__message">{update.message}</span>
                {update.createdAt && (
                  <span className="status-muted" suppressHydrationWarning>
                    {formatDateTime(update.createdAt, timeZone, { format: 'short', hour12: true })}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {incident.postmortem &&
          (postmortemHref && (incident.postmortem.id || incident.id) ? (
            <a
              className="status-v3-incident__pir"
              href={postmortemHref(incident.postmortem.id || incident.id || '')}
            >
              {incident.postmortem.title ?? 'View post-incident review'}
            </a>
          ) : (
            <span className="status-v3-incident__pir status-muted">
              {incident.postmortem.title ?? 'Post-incident review available'}
            </span>
          ))}
      </div>
    </details>
  );
}

/**
 * Incident timeline from V3. Impact, status and structured updates are supplied by the projector;
 * this only formats, filters and paginates them. Cards collapse natively (no JS to expand) so a long
 * history stays compact, and the service filter/"show more" run entirely client-side over the
 * already-sanitized payload.
 */
export default function IncidentsV3({
  incidents,
  timeZone,
  postmortemHref,
}: {
  incidents: PublicIncident[];
  timeZone: string;
  postmortemHref?: (postmortemId: string) => string;
}) {
  const [service, setService] = useState('all');
  const [visible, setVisible] = useState(INITIAL_VISIBLE);

  const services = useMemo(() => {
    const byId = new Map<string, string>();
    for (const incident of incidents) {
      if (incident.service?.id && incident.service.name)
        byId.set(incident.service.id, incident.service.name);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [incidents]);

  const filtered = useMemo(
    () =>
      service === 'all'
        ? incidents
        : incidents.filter(incident => incident.service?.id === service),
    [incidents, service]
  );
  const shown = filtered.slice(0, visible);

  if (incidents.length === 0) {
    return (
      <section
        className="status-v3-incidents"
        id="incidents"
        aria-labelledby="status-v3-incidents-heading"
      >
        <h2 id="status-v3-incidents-heading">Incidents</h2>
        <p className="status-muted">No incidents reported.</p>
      </section>
    );
  }

  return (
    <section
      className="status-v3-incidents"
      id="incidents"
      aria-labelledby="status-v3-incidents-heading"
    >
      <div className="status-v3-incidents__bar">
        <h2 id="status-v3-incidents-heading">Incidents</h2>
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
      {shown.length === 0 ? (
        <p className="status-muted">No incidents for this service.</p>
      ) : (
        <ul className="status-v3-incidents__list">
          {shown.map((incident, index) => (
            <li key={incident.id ?? index}>
              <IncidentCard
                incident={incident}
                timeZone={timeZone}
                postmortemHref={postmortemHref}
                defaultOpen={index === 0 && service === 'all'}
              />
            </li>
          ))}
        </ul>
      )}
      {filtered.length > visible && (
        <button
          type="button"
          className="status-v3-showmore"
          onClick={() => setVisible(count => count + INITIAL_VISIBLE)}
        >
          Show {Math.min(INITIAL_VISIBLE, filtered.length - visible)} more
        </button>
      )}
    </section>
  );
}
