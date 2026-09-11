'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicStatusService, PublicHistorySlice } from '@/lib/status-pages/public-contract';
import { buildPublicHistoryDays } from '@/lib/status-pages/history-presentation';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import { describeUptimeWindow } from '@/lib/status-pages/presentation';
import { formatDateTime } from '@/lib/timezone';
import StatusBadge from '@/components/incident/StatusBadge';

const GRADE_LABEL: Record<string, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  BELOW_TARGET: 'Below target',
};

const HOUR_TICKS = ['00:00', '06:00', '12:00', '18:00', '24:00'];

function minuteToClock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

const StatusBreakdownBar = memo(function StatusBreakdownBar({
  timeline,
}: {
  timeline: PublicHistorySlice[];
}) {
  const total = timeline.at(-1)?.endMinute ?? 1440;
  if (total === 0) return null;

  const buckets = new Map<string, number>();
  for (const slice of timeline) {
    const dur = slice.endMinute - slice.startMinute;
    buckets.set(slice.status, (buckets.get(slice.status) ?? 0) + dur);
  }

  return (
    <div className="status-v3-inspector__breakdown" role="img" aria-label="Status time breakdown">
      {[...buckets.entries()]
        .filter(([, mins]) => mins > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([status, mins]) => (
          <span
            key={status}
            className={`status-v3-inspector__breakdown-seg status-${statusPresentation(status as any).token}`}
            style={{ inlineSize: `${(mins / total) * 100}%` }}
            title={`${statusPresentation(status as any).label}: ${Math.round((mins / total) * 1440)} min`}
          />
        ))}
    </div>
  );
});

/**
 * Interactive 90-day uptime card. Every bar opens an inspector with that day's 24-hour breakdown,
 * availability and SLA grade — all read from the projector's per-day timeline, so there is no
 * client-side status computation. Dismisses on outside click or Escape.
 */
function meterTier(grade: string | undefined): string {
  if (grade === 'EXCELLENT') return 'excellent';
  if (grade === 'GOOD') return 'good';
  if (grade === 'BELOW_TARGET') return 'poor';
  return 'unknown';
}

function ServiceHistoryV3Inner({
  service,
  timeZone,
  showGrade = true,
  showUptimeInline = true,
}: {
  service: PublicStatusService;
  timeZone: string;
  showGrade?: boolean;
  showUptimeInline?: boolean;
}) {
  const days = useMemo(
    () => (service.history ? buildPublicHistoryDays(service.history, timeZone) : []),
    [service.history, timeZone]
  );
  const [selected, setSelected] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const navigateDay = useCallback(
    (direction: -1 | 1) => {
      setSelected(prev => {
        if (prev === null) return null;
        const next = prev + direction;
        if (next < 0 || next >= days.length) return prev;
        return next;
      });
    },
    [days.length]
  );

  useEffect(() => {
    if (selected === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateDay(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateDay(1);
      }
    };
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [selected, navigateDay]);

  const hasUptime = Boolean(service.uptime?.days30 || service.uptime?.days90);
  const hasDays = days.length > 0;
  if (!hasDays && !(showUptimeInline && hasUptime)) return null;

  const uptime30 = describeUptimeWindow(service.uptime?.days30);
  const uptime90 = describeUptimeWindow(service.uptime?.days90);
  const grade = service.sla?.grade ?? service.uptime?.days90?.grade;
  const day = selected != null ? days[selected] : null;
  const dayTotal = day?.timeline?.at(-1)?.endMinute ?? 1440;
  const w30 = service.uptime?.days30;
  const w90 = service.uptime?.days90;

  return (
    <div className="status-v3-uptime" ref={ref}>
      {hasDays ? (
        <div className="status-v3-uptime__head">
          <span className="status-v3-uptime__value">
            {uptime90.value}
            <span className="status-v3-uptime__unit"> · 90-day uptime</span>
          </span>
          {showGrade && grade && (
            <StatusBadge status={grade} label={GRADE_LABEL[grade]} size="xs" showDot />
          )}
        </div>
      ) : null}

      {hasDays && (
        <>
          <svg
            className="status-v3-history"
            viewBox={`0 0 ${days.length} 10`}
            preserveAspectRatio="none"
            role="group"
            aria-label={`Daily status history for ${service.name}`}
          >
            {days.map((entry, index) => {
              const token = statusPresentation(entry.status).token;
              return (
                <rect
                  key={entry.date}
                  className={`status-v3-history__day status-${token}`}
                  x={index + 0.08}
                  y={0}
                  width={0.84}
                  height={10}
                  rx={0.22}
                  fill="currentColor"
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected === index}
                  aria-label={`${entry.date}: ${statusPresentation(entry.status).label}${entry.availabilityPercent != null ? `, ${entry.availabilityPercent}%` : ''}`}
                  onClick={() => setSelected(selected === index ? null : index)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(selected === index ? null : index);
                    }
                  }}
                >
                  <title>
                    {`${entry.date}: ${statusPresentation(entry.status).label}${entry.availabilityPercent != null ? ` · ${entry.availabilityPercent}%` : ''}`}
                  </title>
                </rect>
              );
            })}
          </svg>

          <div className="status-v3-history__axis" aria-hidden="true">
            <span>90 days ago</span>
            <span>60 days ago</span>
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </>
      )}

      {day && (
        <div
          className="status-v3-inspector status-v3-service"
          role="dialog"
          aria-label={`Status detail for ${day.date}`}
          data-status={statusPresentation(day.status).token}
        >
          <div className="status-v3-inspector__head">
            <div className="status-v3-inspector__lead">
              <svg
                className="status-v3-inspector__icon"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <strong className="status-v3-inspector__date">{day.date}</strong>
              <span className="status-v3-inspector__relative">
                {formatDateTime(day.date, timeZone, { format: 'relative' })}
              </span>
              <span className="status-v3-inspector__divider" aria-hidden="true" />
              <StatusBadge
                status={day.status}
                label={statusPresentation(day.status).label}
                size="sm"
                showDot
                pulse={day.status !== 'OPERATIONAL'}
              />
            </div>
            <div className="status-v3-inspector__actions">
              <button
                type="button"
                className="status-v3-inspector__nav"
                aria-label="Previous day"
                disabled={selected === 0}
                onClick={() => navigateDay(-1)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                className="status-v3-inspector__nav"
                aria-label="Next day"
                disabled={selected === days.length - 1}
                onClick={() => navigateDay(1)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <button
                type="button"
                className="status-v3-inspector__close"
                aria-label="Close"
                onClick={() => setSelected(null)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="status-v3-inspector__chips">
            <span className="status-v3-chip">
              <span className="status-v3-inspector__chip-label">Availability</span>
              {day.availabilityPercent != null ? `${day.availabilityPercent}%` : '—'}
            </span>
            <span className="status-v3-chip">
              <span className="status-v3-inspector__chip-label">Incidents</span>
              {day.incidentCount}
            </span>
            {grade && (
              <span className="status-v3-chip">
                <span className="status-v3-inspector__chip-label">SLA</span>
                {GRADE_LABEL[grade]}
              </span>
            )}
          </div>

          {day.timeline && day.timeline.length > 1 && (
            <StatusBreakdownBar timeline={day.timeline} />
          )}

          <div className="status-v3-inspector__timeline-wrap">
            <div
              className="status-v3-hours"
              role="img"
              aria-label={`24-hour timeline for ${day.date}`}
            >
              {(day.timeline ?? []).map((slice, index) => (
                <span
                  key={index}
                  className={`status-v3-hours__slice status-${statusPresentation(slice.status).token}`}
                  style={{
                    insetInlineStart: `${(slice.startMinute / dayTotal) * 100}%`,
                    inlineSize: `${((slice.endMinute - slice.startMinute) / dayTotal) * 100}%`,
                  }}
                  title={`${minuteToClock(slice.startMinute)} – ${minuteToClock(slice.endMinute)} · ${statusPresentation(slice.status).label}`}
                />
              ))}
            </div>
            <div className="status-v3-hours__axis" aria-hidden="true">
              {HOUR_TICKS.map(tick => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {showUptimeInline && hasUptime ? (
        <div className="status-v3-uptime-metrics-inline" role="group" aria-label={`Uptime for ${service.name}`}>
          {[
            { label: '30 days', described: uptime30, win: w30 },
            { label: '90 days', described: uptime90, win: w90 },
          ].map(({ label, described, win }) => {
            const tier = meterTier(win?.grade);
            const partial = described.partial;
            const incidents = win?.incidentCount;
            return (
              <div key={label} className="status-v3-uptime-cell">
                <div className="status-v3-uptime-cell__head">
                  <span className="status-v3-uptime-cell__label">{label}</span>
                  <span className="status-v3-uptime-cell__value">{described.value}</span>
                </div>
                <div
                  className="status-v3-uptime-cell__meter"
                  data-tier={tier}
                  role="img"
                  aria-label={`${service.name} ${label} availability ${described.value}`}
                >
                  <span style={{ inlineSize: `${described.meterPercent}%` }} />
                </div>
                <span className="status-v3-uptime-cell__meta">
                  <span className="status-v3-uptime-cell__meta-main">
                    {typeof incidents === 'number'
                      ? `${incidents} ${incidents === 1 ? 'incident' : 'incidents'}`
                      : described.coverage ?? ''}
                    {described.coverage && typeof incidents === 'number' ? ` · ${described.coverage}` : ''}
                  </span>
                  {partial && <span className="status-v3-uptime-cell__partial"> · Partial history</span>}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const ServiceHistoryV3 = memo(ServiceHistoryV3Inner);
export default ServiceHistoryV3;
