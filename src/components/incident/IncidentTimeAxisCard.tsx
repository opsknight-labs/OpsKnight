import Link from 'next/link';
import { Clock } from 'lucide-react';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  getIncidentTimeAxisForActor,
  type TimeAxisKind,
} from '@/lib/intelligence/timeline/service';
import IntelligenceEmptyState from './IntelligenceEmptyState';

const KIND_LABEL: Record<TimeAxisKind, string> = {
  INCIDENT: 'Incident',
  ALERT: 'Alert',
  CHANGE: 'Change',
  UPSTREAM_INCIDENT: 'Upstream incident',
  NOISE_DECISION: 'Noise control',
};

const KIND_CLASS: Record<TimeAxisKind, string> = {
  INCIDENT: 'bg-foreground',
  ALERT: 'bg-muted-foreground',
  CHANGE: 'bg-amber-500',
  UPSTREAM_INCIDENT: 'bg-sky-500',
  NOISE_DECISION: 'bg-violet-500',
};

const formatOffset = (minutes: number) => {
  const abs = Math.abs(minutes);
  const text =
    abs < 60
      ? `${abs} min`
      : abs < 60 * 48
        ? `${Math.round((abs / 60) * 10) / 10} h`
        : `${Math.round(abs / 1440)} d`;
  return minutes === 0 ? 'at onset' : minutes < 0 ? `${text} before` : `${text} after`;
};

/**
 * One time axis for the incident: its alerts, changes on it and its upstream services, upstream incidents
 * and noise decisions, each relative to onset. Read-only; renders nothing at all on any failure.
 */
export default async function IncidentTimeAxisCard({ incidentId }: { incidentId: string }) {
  let axis;
  try {
    axis = await getIncidentTimeAxisForActor(incidentId, await getCurrentAuthorizationActor());
  } catch (error) {
    logger.warn('[Intelligence] Incident time axis unavailable', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!axis || axis.entries.length <= 1) return <IntelligenceEmptyState incidentId={incidentId} />;
  return (
    <section
      aria-labelledby="incident-time-axis-heading"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="incident-time-axis-heading" className="text-sm font-semibold">
            What happened around this incident
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Alerts, changes, upstream incidents and noise decisions on one timeline, relative to when
          the incident opened.
          {axis.truncated ? ' Showing the first 50 of each kind.' : ''}
        </p>
      </div>
      <ol className="space-y-2" aria-label="Incident time axis">
        {axis.entries.map((entry, index) => (
          <li
            key={`${entry.kind}-${entry.at.toISOString()}-${index}`}
            className="flex gap-3 text-sm"
          >
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${KIND_CLASS[entry.kind]}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {entry.href ? (
                  entry.href.startsWith('/') ? (
                    <Link href={entry.href} className="hover:underline">
                      {entry.title}
                    </Link>
                  ) : (
                    <a
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {entry.title}
                    </a>
                  )
                ) : (
                  entry.title
                )}
                {entry.riskPercent !== undefined && entry.riskPercent !== null && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                    risk {entry.riskPercent}%
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[entry.kind]} · {formatOffset(entry.offsetMinutes)}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </p>
            </div>
            <time
              dateTime={entry.at.toISOString()}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {entry.at.toISOString().slice(11, 16)} UTC
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
