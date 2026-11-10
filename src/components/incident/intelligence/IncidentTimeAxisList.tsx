import Link from 'next/link';
import type { IncidentTimeAxis, TimeAxisKind } from '@/lib/intelligence/timeline/service';
import UngroupButton from './UngroupButton';

export const TIME_AXIS_KIND_LABEL: Record<TimeAxisKind, string> = {
  INCIDENT: 'Incident',
  ALERT: 'Alert',
  CHANGE: 'Change',
  UPSTREAM_INCIDENT: 'Upstream incident',
  NOISE_DECISION: 'Noise control',
  GROUPING: 'Grouping',
  SUGGESTION: 'Suggestion',
  TRIAGE: 'Triage',
};

const KIND_CLASS: Record<TimeAxisKind, string> = {
  INCIDENT: 'bg-foreground',
  ALERT: 'bg-muted-foreground',
  CHANGE: 'bg-status-elevated',
  UPSTREAM_INCIDENT: 'bg-status-info',
  NOISE_DECISION: 'bg-status-shift',
  GROUPING: 'bg-status-shift',
  SUGGESTION: 'bg-status-ok',
  TRIAGE: 'bg-status-ok',
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

/** Presentational list for the incident time axis; the data function decides what the viewer may see. */
export default function IncidentTimeAxisList({
  incidentId,
  axis,
}: {
  incidentId: string;
  axis: IncidentTimeAxis;
}) {
  return (
    <ol className="space-y-2" aria-label="Incident time axis">
      {axis.entries.map((entry, index) => (
        <li
          key={`${entry.kind}-${entry.at.toISOString()}-${index}`}
          className="flex gap-3 text-sm"
          data-kind={entry.kind}
        >
          <span
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${KIND_CLASS[entry.kind]}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 space-y-1">
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
              {TIME_AXIS_KIND_LABEL[entry.kind]} · {formatOffset(entry.offsetMinutes)}
              {entry.detail ? ` · ${entry.detail}` : ''}
            </p>
            {entry.why && entry.why.length > 0 && (
              <details className="text-xs">
                <summary className="inline-flex min-h-11 cursor-pointer sm:min-h-8 items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Why?
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground/80">
                  {entry.why.map((line, lineIndex) => (
                    <li key={lineIndex}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <time
              dateTime={entry.at.toISOString()}
              className="text-xs tabular-nums text-muted-foreground"
            >
              {entry.at.toISOString().slice(11, 16)} UTC
            </time>
            {(entry.reversal || entry.reversed) && (
              // Stays mounted once reversed so the result survives the refresh the action triggers.
              <UngroupButton
                incidentId={incidentId}
                target={{ type: 'decision', decisionId: entry.reversal?.decisionId ?? '' }}
                settled={!entry.reversal}
                label={entry.reversal?.pages ? 'Reverse and page' : 'Mark wrong'}
                confirmTitle={
                  entry.reversal?.pages
                    ? 'Reverse this decision and page?'
                    : 'Mark this decision wrong?'
                }
                confirmBody={
                  entry.reversal?.pages
                    ? 'The alert is re-ingested as its own incident and pages normally. The decision is recorded as wrong, which counts against the rule in noise-control reports.'
                    : 'Nothing pages: the decision only changed how the alert was handled. It is recorded as wrong, which counts against the rule in noise-control reports.'
                }
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
