import type { ReactNode } from 'react';
import Link from 'next/link';
import MetricInfo from '@/components/analytics/MetricInfo';
import type { OverviewNoise } from '@/lib/intelligence/overview/noise';
import type { SectionResult } from '@/lib/intelligence/overview/scope';
import type { AcceptanceRate, OverviewSpeed } from '@/lib/intelligence/overview/speed';
import { formatCount, formatPercent } from '@/lib/intelligence/overview/window';

/** Why a row has no value; empty rows fold into one footnote instead of a column of dashes. */
type EmptyReason = 'noFeedback' | 'triageOff' | 'noGroups' | 'noHeartbeats' | 'unavailable';

interface Row {
  label: string;
  info: string;
  value?: string;
  detail?: string;
  empty?: EmptyReason;
  /** What responders give feedback on, for the footnote. */
  subject?: string;
}

function rate(
  rate: AcceptanceRate,
  noun: string,
  subject: string
): Pick<Row, 'value' | 'detail' | 'empty' | 'subject'> {
  return rate.reviewed === 0
    ? { empty: 'noFeedback', subject }
    : {
        value: formatPercent(rate.rate),
        detail: `${formatCount(rate.accepted)} of ${formatCount(rate.reviewed)} ${noun}`,
      };
}

/**
 * The overview's secondary numbers as one compact definition list: responder feedback on Intelligence and
 * how grouping, noise controls and heartbeats behaved. Rows with nothing to show collapse into a single muted
 * footnote that says why, so the card never reads as a wall of "—".
 */
export default function FeedbackPanel({
  noise,
  speed,
  triageEnabled,
  canManage,
}: {
  noise: SectionResult<OverviewNoise>;
  speed: SectionResult<OverviewSpeed>;
  triageEnabled: boolean;
  canManage: boolean;
}) {
  const n = noise.ok ? noise.data : null;
  const s = speed.ok ? speed.data : null;
  const unavailable = { empty: 'unavailable' as const };

  const rows: Row[] = [
    {
      label: 'Suggestions accepted',
      info: 'Share of related-incident suggestions that responders accepted, out of those they reviewed.',
      ...(s ? rate(s.relatedSuggestions, 'reviewed', 'related-incident suggestions') : unavailable),
    },
    {
      label: 'Rated helpful',
      info: 'Share of similar-incident, cause, change and runbook findings that responders rated helpful.',
      ...(s ? rate(s.findings, 'rated', 'findings') : unavailable),
    },
    {
      label: 'Triage accepted',
      info: 'Share of triage suggestions (urgency, owner, duplicate, time to resolve) accepted rather than dismissed.',
      ...(!triageEnabled
        ? { empty: 'triageOff' as const }
        : s
          ? rate(s.triage, 'decided', 'triage suggestions')
          : unavailable),
    },
    {
      label: 'False-group rate',
      info: 'Share of alert groupings that responders undid, a sign grouping is too broad.',
      ...(!n
        ? unavailable
        : n.grouped === 0
          ? { empty: 'noGroups' as const }
          : {
              value: formatPercent(n.falseGroupRate),
              detail: `${formatCount(n.ungrouped)} of ${formatCount(n.grouped)} undone`,
            }),
    },
    {
      label: 'Would have avoided (shadow)',
      info: 'Pages that controls in shadow mode would have held back; nothing was actually suppressed.',
      ...(n ? { value: formatCount(n.shadowWouldAvoid) } : unavailable),
    },
    {
      label: 'Pages avoided',
      info: 'Pages that noise controls held back while switched on; shadow decisions are never counted here.',
      ...(n
        ? {
            value: formatCount(n.pagesAvoided),
            detail: n.downgraded > 0 ? `${formatCount(n.downgraded)} downgraded` : undefined,
          }
        : unavailable),
    },
    {
      label: 'Heartbeat monitors',
      info: 'Heartbeat monitors in scope, and how many are missing or late right now.',
      ...(!n
        ? unavailable
        : n.heartbeats.monitors === 0
          ? { empty: 'noHeartbeats' as const }
          : {
              value: formatCount(n.heartbeats.monitors),
              detail: `${formatCount(n.heartbeats.missing)} missing · ${formatCount(n.heartbeats.late)} late`,
            }),
    },
  ];

  const shown = rows.filter(row => !row.empty);
  const emptyRows = (reason: EmptyReason) => rows.filter(row => row.empty === reason);
  const noFeedback = emptyRows('noFeedback');
  const feedbackRows = triageEnabled ? 3 : 2;
  const notes: ReactNode[] = [];
  if (noFeedback.length === feedbackRows)
    notes.push(
      "No feedback yet: responders haven't accepted, rated or decided any suggestions in this window. They can from the insights on any incident."
    );
  else if (noFeedback.length > 0)
    notes.push(
      `Responders haven't reviewed any ${noFeedback.map(row => row.subject).join(' or ')} in this window yet.`
    );
  if (!triageEnabled)
    notes.push(
      <>
        Triage suggestions are off.
        {canManage && (
          <>
            {' '}
            <Link
              href="/settings/intelligence#triage"
              className="inline-flex min-h-11 items-center rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            >
              Turn on
            </Link>
          </>
        )}
      </>
    );
  if (emptyRows('noGroups').length > 0)
    notes.push('No alerts were grouped, so there is no false-group rate.');
  if (emptyRows('noHeartbeats').length > 0)
    notes.push('No heartbeat monitors cover these services.');
  const failed = emptyRows('unavailable');
  if (failed.length > 0)
    notes.push(
      `Some figures could not be loaded (${failed.map(row => row.label).join(', ')}). Refresh to try again.`
    );

  return (
    <div className="space-y-3">
      {shown.length > 0 && (
        <dl className="divide-y divide-border">
          {shown.map(row => (
            <div
              key={row.label}
              className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <dt className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <span className="min-w-0">{row.label}</span>
                <MetricInfo definitions={[{ label: row.label, description: row.info }]} />
              </dt>
              <dd className="shrink-0 text-right tabular-nums">
                <span className="text-sm font-semibold text-foreground">{row.value}</span>
                {row.detail && (
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {notes.length > 0 && (
        <p
          data-feedback-footnote
          className={
            shown.length > 0
              ? 'border-t pt-3 text-xs text-muted-foreground'
              : 'text-xs text-muted-foreground'
          }
        >
          {notes.map((note, index) => (
            <span key={index}>
              {index > 0 && ' '}
              {note}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
