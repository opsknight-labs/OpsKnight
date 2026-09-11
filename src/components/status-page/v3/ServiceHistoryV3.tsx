'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicStatusService } from '@/lib/status-pages/public-contract';
import { buildPublicHistoryDays } from '@/lib/status-pages/history-presentation';
import { statusPresentation } from '@/lib/status-pages/status-presentation';
import { describeUptimeWindow } from '@/lib/status-pages/presentation';
import StatusBadge from '@/components/incident/StatusBadge';

const GRADE_LABEL: Record<string, string> = {
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  BELOW_TARGET: 'Below target',
};

const HOUR_TICKS = ['00:00', '06:00', '12:00', '18:00', '24:00'];

/**
 * Interactive 90-day uptime card. Every bar opens an inspector with that day's 24-hour breakdown,
 * availability and SLA grade — all read from the projector's per-day timeline, so there is no
 * client-side status computation. Dismisses on outside click or Escape.
 */
export default function ServiceHistoryV3({
  service,
  timeZone,
}: {
  service: PublicStatusService;
  timeZone: string;
}) {
  const days = useMemo(
    () => (service.history ? buildPublicHistoryDays(service.history, timeZone) : []),
    [service.history, timeZone]
  );
  const [selected, setSelected] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected === null) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setSelected(null);
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [selected]);

  if (days.length === 0) return null;

  const uptime90 = describeUptimeWindow(service.uptime?.days90);
  const grade = service.sla?.grade ?? service.uptime?.days90?.grade;
  const day = selected != null ? days[selected] : null;
  const dayTotal = day?.timeline?.at(-1)?.endMinute ?? 1440;

  return (
    <div className="status-v3-uptime" ref={ref}>
      <div className="status-v3-uptime__head">
        <span className="status-v3-uptime__value">
          {uptime90.value}
          <span className="status-v3-uptime__unit"> · 90-day uptime</span>
        </span>
        {grade && (
          <span className={`status-v3-grade status-v3-grade--${grade.toLowerCase()}`}>
            {GRADE_LABEL[grade]}
          </span>
        )}
      </div>

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
        <span>{uptime90.coverage ?? '90 days'}</span>
        <span>Today</span>
      </div>

      {day && (
        <div
          className="status-v3-inspector"
          role="dialog"
          aria-label={`Status detail for ${day.date}`}
        >
          <div className="status-v3-inspector__head">
            <span className="status-v3-inspector__lead">
              <strong className="status-v3-inspector__date">{day.date}</strong>
              <StatusBadge
                status={day.status}
                label={statusPresentation(day.status).label}
                size="sm"
                showDot
              />
            </span>
            <button
              type="button"
              className="status-v3-inspector__close"
              aria-label="Close"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
          </div>

          <dl className="status-v3-inspector__stats">
            <div>
              <dt>Availability</dt>
              <dd>
                {day.availabilityPercent != null ? `${day.availabilityPercent}%` : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt>Incidents</dt>
              <dd>{day.incidentCount}</dd>
            </div>
            {grade && (
              <div>
                <dt>SLA</dt>
                <dd>{GRADE_LABEL[grade]}</dd>
              </div>
            )}
          </dl>

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
                title={statusPresentation(slice.status).label}
              />
            ))}
          </div>
          <div className="status-v3-hours__axis" aria-hidden="true">
            {HOUR_TICKS.map(tick => (
              <span key={tick}>{tick}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
