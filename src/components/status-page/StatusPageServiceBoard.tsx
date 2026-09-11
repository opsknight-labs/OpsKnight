'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PublicServiceStatus,
  PublicStatusHistoryDay,
  PublicStatusService,
} from '@/lib/status-pages/public-contract';
import { buildPublicHistoryDays } from '@/lib/status-pages/history-presentation';
import { getWorstPublicStatus, statusPresentation } from '@/lib/status-pages/status-presentation';
import {
  describeUptimeWindow,
  groupServicesByRegion,
  serviceSearchKey,
  HISTORY_LEGEND,
} from '@/lib/status-pages/presentation';

/** Days shown at the widest breakpoint. Narrower containers hide the older columns via CSS. */
const HISTORY_WINDOW = 90;

/** Filter chips, in the order a reader scans for trouble. */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'OPERATIONAL', label: 'Operational' },
  { key: 'DEGRADED', label: 'Degraded' },
  { key: 'PARTIAL_OUTAGE', label: 'Partial outage' },
  { key: 'MAJOR_OUTAGE', label: 'Major outage' },
  { key: 'MAINTENANCE', label: 'Maintenance' },
  { key: 'UNKNOWN', label: 'Unknown' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

type PreparedService = PublicStatusService & {
  searchKey: string;
  days: PublicStatusHistoryDay[];
};

type OpenDay = { serviceId: string; date: string };

export default function StatusPageServiceBoard({
  services,
  groupByRegion,
  thresholds,
  timeZone,
}: {
  services: PublicStatusService[];
  groupByRegion: boolean;
  thresholds: { excellent: number; good: number };
  /** Starts at UTC on both server and first client render, then becomes the reader's own zone. */
  timeZone: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [grouped, setGrouped] = useState(groupByRegion);
  const [open, setOpen] = useState<OpenDay | null>(null);

  useEffect(() => setGrouped(groupByRegion), [groupByRegion]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  // Day arrays are rebuilt only when the resolved time zone changes, not per keystroke or hover.
  const prepared = useMemo<PreparedService[]>(
    () =>
      services.map(service => ({
        ...service,
        searchKey: serviceSearchKey(service),
        days: service.history ? buildPublicHistoryDays(service.history, timeZone) : [],
      })),
    [services, timeZone]
  );

  const counts = useMemo(() => {
    const tally = new Map<PublicServiceStatus, number>();
    for (const service of prepared) {
      tally.set(service.status, (tally.get(service.status) ?? 0) + 1);
    }
    return tally;
  }, [prepared]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      prepared.filter(
        service =>
          (filter === 'all' || service.status === filter) &&
          (needle.length === 0 || service.searchKey.includes(needle))
      ),
    [prepared, filter, needle]
  );

  const groups = useMemo(
    () => (grouped ? groupServicesByRegion<PreparedService>(visible, getWorstPublicStatus) : null),
    [grouped, visible]
  );

  if (services.length === 0) {
    return (
      <section className="status-section" aria-labelledby="service-health-heading">
        <div className="status-section__head">
          <h2 id="service-health-heading">Services</h2>
        </div>
        <div className="status-empty">
          <strong>No services configured for this status page</strong>
          <span className="status-muted">
            Choose which services appear here in the status page settings.
          </span>
        </div>
      </section>
    );
  }

  const renderList = (items: PreparedService[]) => (
    <div className="status-services">
      {items.map(service => (
        <ServiceCard
          key={service.id}
          service={service}
          thresholds={thresholds}
          openDate={open?.serviceId === service.id ? open.date : null}
          onToggleDay={date =>
            setOpen(current =>
              current?.serviceId === service.id && current.date === date
                ? null
                : { serviceId: service.id, date }
            )
          }
          onFocusDay={date => setOpen({ serviceId: service.id, date })}
        />
      ))}
    </div>
  );

  return (
    <section className="status-section" aria-labelledby="service-health-heading">
      <div className="status-section__head">
        <h2 id="service-health-heading">Services</h2>
        <span className="status-section__count">
          {visible.length} of {services.length} services
        </span>
      </div>

      <div className="status-toolbar">
        <div className="status-toolbar__row">
          <div className="status-toolbar__search">
            <label className="sr-only" htmlFor="status-service-search">
              Search services
            </label>
            <input
              id="status-service-search"
              className="status-input"
              type="search"
              placeholder="Search services"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="status-chip"
            aria-pressed={grouped}
            onClick={() => setGrouped(value => !value)}
          >
            Group by region
          </button>
        </div>
        <div className="status-toolbar__row" role="group" aria-label="Filter services by status">
          {FILTERS.map(({ key, label }) => {
            const count = key === 'all' ? services.length : (counts.get(key) ?? 0);
            return (
              <button
                key={key}
                type="button"
                className="status-chip"
                aria-pressed={filter === key}
                // Kept visible but inert, so the set of possible statuses stays legible.
                disabled={count === 0 && key !== 'all'}
                onClick={() => setFilter(key)}
              >
                {label} <span className="status-chip__count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="status-empty">
          <strong>No services match your filters</strong>
          <span className="status-muted">Try a different search term or status filter.</span>
        </div>
      ) : groups ? (
        groups.map(group => (
          <section
            key={group.region}
            className="status-region-group"
            aria-label={`${group.region} services`}
          >
            <h3>
              {group.region} · {statusPresentation(group.status).label}
            </h3>
            {renderList(group.services)}
          </section>
        ))
      ) : (
        renderList(visible)
      )}
    </section>
  );
}

/**
 * Memoized per service: without this, opening one day's inspector re-renders every other card,
 * which is what makes a 500-service page feel broken.
 */
const ServiceCard = memo(function ServiceCard({
  service,
  thresholds,
  openDate,
  onToggleDay,
  onFocusDay,
}: {
  service: PreparedService;
  thresholds: { excellent: number; good: number };
  openDate: string | null;
  onToggleDay: (date: string) => void;
  onFocusDay: (date: string) => void;
}) {
  const current = statusPresentation(service.status);
  const uptime90 = describeUptimeWindow(service.uptime?.days90);

  return (
    <article className="status-service">
      <div className="status-service__head">
        <div>
          <h3 className="status-service__name">{service.name}</h3>
          <div className="status-service__meta">
            {service.team && <span className="status-tag">Owned by {service.team.name}</span>}
            {service.slaTier && <span className="status-tag">Service tier: {service.slaTier}</span>}
            {service.regions?.length ? (
              <span className="status-tag">{service.regions.join(' · ')}</span>
            ) : null}
          </div>
        </div>
        <span className={`status-badge status-${current.token}`}>
          <span aria-hidden="true">{current.icon}</span> {current.label}
        </span>
      </div>

      {service.description && <p className="status-service__description">{service.description}</p>}

      <div className="status-service__facts">
        {service.uptime && (
          <span>
            <b>{uptime90.value}</b> uptime (90d)
            {uptime90.coverage ? ` · ${uptime90.coverage}` : ''}
          </span>
        )}
        <span>
          <b>{service.activeIncidentCount}</b>{' '}
          {service.activeIncidentCount === 1 ? 'active incident' : 'active incidents'}
        </span>
      </div>

      {service.days.length > 0 && (
        <ServiceHistory
          service={service}
          openDate={openDate}
          onToggleDay={onToggleDay}
          onFocusDay={onFocusDay}
          thresholds={thresholds}
        />
      )}
    </article>
  );
});

function ServiceHistory({
  service,
  openDate,
  onToggleDay,
  onFocusDay,
}: {
  service: PreparedService;
  openDate: string | null;
  onToggleDay: (date: string) => void;
  onFocusDay: (date: string) => void;
  thresholds: { excellent: number; good: number };
}) {
  const days = service.days.slice(-HISTORY_WINDOW);
  const stripRef = useRef<HTMLDivElement>(null);
  // Distinguishes a click that closes an already-open day from focus arriving on a new one.
  const pointerDown = useRef<{ date: string; wasOpen: boolean } | null>(null);

  const moveFocus = (index: number, delta: number) => {
    const cells = stripRef.current?.querySelectorAll<HTMLButtonElement>(
      '.status-history__cell:not([hidden])'
    );
    cells?.[Math.max(0, Math.min((cells?.length ?? 1) - 1, index + delta))]?.focus();
  };

  return (
    <div className="status-history">
      <div
        className="status-history__strip"
        role="group"
        aria-label={`${service.name} status history`}
        ref={stripRef}
      >
        {days.map((day, index) => {
          const presentation = statusPresentation(day.status);
          const selected = openDate === day.date;
          const tooltipId = `status-history-${service.id}-${day.date}`;
          // Older columns are dropped by container query, so the strip fits without scrolling.
          const window = index < days.length - 30 ? (index < days.length - 60 ? '90' : '60') : '30';
          return (
            <div key={day.date} className="status-history__item" data-window={window}>
              <button
                type="button"
                className={`status-history__cell status-${presentation.token}`}
                aria-label={dayLabel(service.name, day)}
                aria-expanded={selected}
                aria-describedby={selected ? tooltipId : undefined}
                onPointerDown={() => {
                  pointerDown.current = { date: day.date, wasOpen: selected };
                }}
                onClick={() => {
                  pointerDown.current = null;
                  onToggleDay(day.date);
                }}
                onFocus={() => {
                  if (pointerDown.current?.date !== day.date) onFocusDay(day.date);
                }}
                onKeyDown={event => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    moveFocus(index, 1);
                  }
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    moveFocus(index, -1);
                  }
                }}
              >
                <span className="sr-only">{presentation.label}</span>
              </button>
              {selected && <DayInspector day={day} tooltipId={tooltipId} />}
            </div>
          );
        })}
      </div>
      <div className="status-history__scale">
        <span>{days.length} days ago</span>
        <span>Today</span>
      </div>
    </div>
  );
}

/**
 * Built only for the focused day. Reconstructing every day's intraday timeline up front is what
 * a page with hundreds of services cannot afford.
 */
function DayInspector({ day, tooltipId }: { day: PublicStatusHistoryDay; tooltipId: string }) {
  const presentation = statusPresentation(day.status);
  return (
    <div id={tooltipId} role="tooltip" className="status-history__tooltip">
      <div className="status-history__tooltip-head">
        <strong>{day.date}</strong>
        <span className={`status-badge status-${presentation.token}`}>{presentation.label}</span>
      </div>
      <span className="status-muted">
        {day.availabilityPercent === null
          ? 'Availability unavailable'
          : `${day.availabilityPercent.toFixed(2)}% availability`}
        {' · '}
        {day.incidentCount} {day.incidentCount === 1 ? 'incident' : 'incidents'}
      </span>
      {day.timeline && day.timeline.length > 0 && (
        <>
          <div className="status-history__timeline" aria-label="Intraday status timeline">
            {day.timeline.map(slice => (
              <span
                key={`${slice.startMinute}-${slice.endMinute}-${slice.status}`}
                className={`status-${statusPresentation(slice.status).token}`}
                style={{ flexGrow: Math.max(1, slice.endMinute - slice.startMinute) }}
                title={`${minuteLabel(slice.startMinute)}–${minuteLabel(slice.endMinute)}: ${statusPresentation(slice.status).label}`}
              />
            ))}
          </div>
          <div className="status-history__axis">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
          <div className="status-legend">
            {HISTORY_LEGEND.map(entry => (
              <span
                key={entry.status}
                className={`status-${statusPresentation(entry.status).token}`}
              >
                <i aria-hidden="true" />
                {entry.label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function minuteLabel(minute: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(minute)));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dayLabel(serviceName: string, day: PublicStatusHistoryDay): string {
  const presentation = statusPresentation(day.status);
  const availability =
    day.availabilityPercent === null
      ? 'availability unavailable'
      : `${day.availabilityPercent.toFixed(2)}% availability`;
  return `${day.date}, ${serviceName}, ${presentation.label}, ${availability}, ${day.incidentCount} incidents`;
}
