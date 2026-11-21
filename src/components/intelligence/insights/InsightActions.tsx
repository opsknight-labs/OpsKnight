'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { decideInsightAction } from '@/app/(app)/intelligence/insight-actions';
import { openSquire } from '@/components/squire/squire-bus';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import type {
  OpsInsightDecision,
  OpsInsightEvidence,
  OpsInsightStatus,
} from '@/lib/intelligence/ops-insights/contract';

const control =
  'inline-flex min-h-11 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-9';

export interface InsightActionsProps {
  id: string;
  title: string;
  summary: string;
  /** What the insight is about, in words, for the question sent to Squire. */
  subject?: string;
  status: OpsInsightStatus;
  evidence: OpsInsightEvidence;
  draftHref: string | null;
  /** Label of the draft link; the default suits a pre-filled editor. */
  draftLabel?: string;
  canDecide: boolean;
  squireName?: string | null;
}

/**
 * The only client code of the insights kit: the evidence popover, the accept/dismiss buttons and the hand-off
 * to Squire. Nothing here changes anything but the insight's own status.
 */
export default function InsightActions({
  id,
  title,
  summary,
  subject,
  status: initialStatus,
  evidence,
  draftHref,
  draftLabel = 'Create draft',
  canDecide,
  squireName,
}: InsightActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState('');

  const decide = (decision: OpsInsightDecision) =>
    startTransition(async () => {
      const result = await decideInsightAction(id, decision);
      setMessage(result.message);
      if (result.ok && result.status) {
        setStatus(result.status);
        router.refresh();
      }
    });

  const hasEvidence = evidence.facts.length > 0 || (evidence.examples?.length ?? 0) > 0;

  return (
    <div className="flex shrink-0 flex-col gap-1 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {hasEvidence && (
          <Popover>
            <PopoverTrigger className={control}>Evidence</PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 text-sm">
              <p className="font-medium">{title}</p>
              {evidence.window && (
                <p className="text-xs text-muted-foreground">Measured over {evidence.window}.</p>
              )}
              <dl className="space-y-1">
                {evidence.facts.map(fact => (
                  <div key={fact.label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{fact.label}</dt>
                    <dd className="text-right font-medium tabular-nums">{fact.value}</dd>
                  </div>
                ))}
              </dl>
              {evidence.examples && evidence.examples.length > 0 && (
                <ul className="space-y-1 border-t border-border pt-2">
                  {evidence.examples.map(example => (
                    <li key={`${example.label}:${example.href ?? ''}`} className="break-words">
                      {example.href ? (
                        <Link
                          href={example.href}
                          className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {example.label}
                        </Link>
                      ) : (
                        example.label
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
        )}
        {draftHref && (
          <Link href={draftHref} className={control}>
            {draftLabel}
          </Link>
        )}
        {squireName && (
          <button
            type="button"
            className={control}
            onClick={() =>
              openSquire(
                `Explain this insight${subject ? ` about ${subject}` : ''} and what I should check: "${title}". ${summary}`
              )
            }
          >
            Ask {squireName} about this
          </button>
        )}
        {canDecide && status === 'OPEN' && (
          <>
            <button
              type="button"
              className={control}
              disabled={pending}
              onClick={() => decide('accept')}
            >
              Accept
            </button>
            <button
              type="button"
              className={control}
              disabled={pending}
              onClick={() => decide('dismiss')}
            >
              Dismiss
            </button>
          </>
        )}
        {canDecide && status !== 'OPEN' && status !== 'RESOLVED' && (
          <button
            type="button"
            className={control}
            disabled={pending}
            onClick={() => decide('reopen')}
          >
            Reopen
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {message}
      </p>
    </div>
  );
}
