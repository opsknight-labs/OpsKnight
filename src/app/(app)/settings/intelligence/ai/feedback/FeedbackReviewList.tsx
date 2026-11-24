'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import SquireProposalCard, {
  type SquireProposalView,
} from '@/components/squire/SquireProposalCard';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import type { FeedbackActionResult } from './actions';

export interface FeedbackReviewRow {
  id: string;
  createdAt: string;
  rating: string;
  mode: string;
  intent: string | null;
  reason: string | null;
  reviewStatus: string;
  incident: { id: string; title: string } | null;
  service: { id: string; name: string } | null;
}

const REASON_LABELS: Record<string, string> = {
  wrong_facts: 'Wrong facts',
  missed_point: 'Missed the point',
  too_long: 'Too long',
  wrong_action: 'Wrong action',
  wrong: 'Wrong',
  incomplete: 'Incomplete',
  outdated: 'Out of date',
  unclear: 'Unclear',
  unsafe: 'Unsafe or risky',
  helpful: 'Helpful',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  LEARNED: 'Learned',
  DISMISSED: 'Dismissed',
};

function splitReason(reason: string | null) {
  if (!reason) return { code: null, note: null };
  const at = reason.indexOf(':');
  const code = at < 0 ? reason : reason.slice(0, at);
  return {
    // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed table, falls back to the code
    code: REASON_LABELS[code] ?? code,
    note: at < 0 ? null : reason.slice(at + 1).trim() || null,
  };
}

type Actions = {
  learn: (id: string, fact: string) => Promise<FeedbackActionResult>;
  evalCase: (id: string) => Promise<FeedbackActionResult>;
  dismiss: (id: string) => Promise<FeedbackActionResult>;
  markLearned: (
    id: string,
    outcome: 'learn_candidate' | 'eval_case'
  ) => Promise<FeedbackActionResult>;
};

function FeedbackRow({
  row,
  actions,
  assistantName,
}: {
  row: FeedbackReviewRow;
  actions: Actions;
  assistantName: string;
}) {
  const { code, note } = splitReason(row.reason);
  const { userTimeZone } = useTimezone();
  // The page is not revalidated after Learn or an eval case (that would drop the row and its result from the
  // "New" list), so the status shown here follows what this row did.
  const [status, setStatus] = useState(row.reviewStatus);
  const [pending, start] = useTransition();
  const [learning, setLearning] = useState(false);
  const [fact, setFact] = useState(note ?? '');
  const [result, setResult] = useState<FeedbackActionResult | null>(null);
  const [copied, setCopied] = useState('');
  const run = (action: () => Promise<FeedbackActionResult>) =>
    start(async () => {
      setCopied('');
      setResult(await action());
    });
  const json = result?.ok ? result.json : undefined;
  const proposal = result?.ok ? result.proposal : undefined;
  const factId = `feedback-fact-${row.id}`;
  const markLearned = (outcome: 'learn_candidate' | 'eval_case') =>
    void actions
      .markLearned(row.id, outcome)
      .then(marked => {
        if (marked.ok) setStatus('LEARNED');
      })
      .catch(() => undefined);

  // An eval case counts as learned only once it is on screen.
  useEffect(() => {
    if (json) markLearned('eval_case');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per shown case
  }, [json]);

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {row.rating === 'UP' ? (
              <ThumbsUp className="h-4 w-4 text-muted-foreground" aria-label="Helpful" />
            ) : (
              <ThumbsDown className="h-4 w-4 text-muted-foreground" aria-label="Not helpful" />
            )}
            <span className="font-medium">{code ?? 'No reason given'}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-2xs">
              {/* eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed table */}
              {STATUS_LABELS[status] ?? status}
            </span>
          </p>
          {note && <p className="text-sm text-muted-foreground">“{note}”</p>}
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>Mode</dt>
              <dd className="text-foreground">{row.mode === 'ai' ? 'AI' : 'Basic'}</dd>
            </div>
            {row.intent && (
              <div className="flex gap-1">
                <dt>Intent</dt>
                <dd className="font-mono text-foreground">{row.intent}</dd>
              </div>
            )}
            <div className="flex gap-1">
              <dt>Service</dt>
              <dd className="text-foreground">
                {row.service ? (
                  <Link
                    href={`/services/${encodeURIComponent(row.service.id)}`}
                    className="underline"
                  >
                    {row.service.name}
                  </Link>
                ) : (
                  'None'
                )}
              </dd>
            </div>
            {row.incident && (
              <div className="flex min-w-0 gap-1">
                <dt>Incident</dt>
                <dd className="min-w-0 truncate text-foreground">
                  <Link
                    href={`/incidents/${encodeURIComponent(row.incident.id)}`}
                    className="underline"
                  >
                    {row.incident.title}
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex gap-1">
              <dt className="sr-only">Received</dt>
              <dd>
                <time dateTime={row.createdAt}>
                  {formatDateTime(row.createdAt, userTimeZone, { includeTimeZone: true })}
                </time>
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !row.incident}
            title={
              row.incident
                ? undefined
                : 'Only feedback asked on an incident can become a service fact'
            }
            aria-expanded={learning}
            aria-controls={learning ? `${factId}-form` : undefined}
            onClick={() => setLearning(!learning)}
          >
            Learn for this service
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => actions.evalCase(row.id))}
          >
            Add to eval set
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || status === 'DISMISSED'}
            onClick={() =>
              run(async () => {
                const dismissed = await actions.dismiss(row.id);
                if (dismissed.ok) setStatus('DISMISSED');
                return dismissed;
              })
            }
          >
            Dismiss
          </Button>
        </div>
      </div>
      {learning && !proposal && (
        <form
          id={`${factId}-form`}
          className="space-y-2"
          onSubmit={event => {
            event.preventDefault();
            run(() => actions.learn(row.id, fact));
          }}
        >
          <label htmlFor={factId} className="block text-xs font-medium">
            Fact {assistantName} should remember about {row.service?.name ?? 'this service'}
          </label>
          <textarea
            id={factId}
            rows={2}
            minLength={10}
            maxLength={500}
            required
            value={fact}
            onChange={event => setFact(event.target.value)}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
          />
          <Button size="sm" type="submit" disabled={pending}>
            Propose fact
          </Button>
        </form>
      )}
      {result && (
        <p
          role="status"
          className={`text-xs ${result.ok ? 'text-muted-foreground' : 'text-destructive'}`}
        >
          {result.message}
        </p>
      )}
      {proposal && (
        <SquireProposalCard
          proposal={proposal as SquireProposalView}
          assistantName={assistantName}
          onOutcome={outcome => {
            if (outcome === 'success') markLearned('learn_candidate');
          }}
        />
      )}
      {json && (
        <div className="space-y-2">
          <label htmlFor={`${row.id}-case`} className="block text-xs font-medium">
            Evaluation case
          </label>
          <textarea
            id={`${row.id}-case`}
            readOnly
            rows={8}
            value={json}
            className="w-full rounded-md border border-border bg-muted p-2 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(json);
                  setCopied('Copied.');
                } catch {
                  setCopied('Could not copy. Select the text to copy it.');
                }
              }}
            >
              Copy
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a
                href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
                download={`squire-feedback-${row.id}.json`}
              >
                Download
              </a>
            </Button>
            {copied && (
              <span role="status" className="text-xs text-muted-foreground">
                {copied}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Recent Squire feedback with the three review actions, one row at a time. */
export default function FeedbackReviewList({
  rows,
  actions,
  assistantName = 'Squire',
}: {
  rows: FeedbackReviewRow[];
  actions: Actions;
  assistantName?: string;
}) {
  return (
    <ul className="divide-y divide-border" aria-label={`${assistantName} feedback`}>
      {rows.map(row => (
        <FeedbackRow key={row.id} row={row} actions={actions} assistantName={assistantName} />
      ))}
    </ul>
  );
}
