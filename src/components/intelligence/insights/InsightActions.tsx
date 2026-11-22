'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { decideInsightAction } from '@/app/(app)/intelligence/insight-actions';
import { openSquire } from '@/components/squire/squire-bus';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import type {
  OpsInsightDecision,
  OpsInsightEvidence,
  OpsInsightStatus,
} from '@/lib/intelligence/ops-insights/contract';

const control =
  'inline-flex min-h-11 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:min-h-9';

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
  /**
   * Compact layout for dense inboxes: Accept and Dismiss stay as buttons, and Evidence, the draft link and
   * the Squire hand-off move into a "More actions" menu.
   */
  menu?: boolean;
}

function EvidenceFacts({ evidence }: { evidence: OpsInsightEvidence }) {
  return (
    <>
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
            <li key={`${example.label}:${example.href ?? ''}`} className="wrap-break-word">
              {example.href ? (
                <Link
                  href={example.href}
                  className="underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
    </>
  );
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
  menu = false,
}: InsightActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);
  const [message, setMessage] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);

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
  const askSquire = () =>
    openSquire(
      `Explain this insight${subject ? ` about ${subject}` : ''} and what I should check: "${title}". ${summary}`
    );
  const statusLine = (
    <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
      {message}
    </p>
  );

  if (menu) {
    const tap = 'h-11 sm:h-9';
    return (
      <div className="flex shrink-0 flex-col gap-1 sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          {canDecide && status === 'OPEN' && (
            <>
              <Button size="sm" className={tap} disabled={pending} onClick={() => decide('accept')}>
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={tap}
                disabled={pending}
                onClick={() => decide('dismiss')}
              >
                Dismiss
              </Button>
            </>
          )}
          {canDecide && status !== 'OPEN' && status !== 'RESOLVED' && (
            <Button
              size="sm"
              variant="outline"
              className={tap}
              disabled={pending}
              onClick={() => decide('reopen')}
            >
              Reopen
            </Button>
          )}
          {(hasEvidence || draftHref || squireName) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="More actions"
                  className="h-11 w-11 sm:h-9 sm:w-9"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hasEvidence && (
                  <DropdownMenuItem onSelect={() => setEvidenceOpen(true)}>
                    Evidence
                  </DropdownMenuItem>
                )}
                {draftHref && (
                  <DropdownMenuItem asChild>
                    <Link href={draftHref}>{draftLabel}</Link>
                  </DropdownMenuItem>
                )}
                {squireName && (
                  <DropdownMenuItem onSelect={askSquire}>
                    Ask {squireName} about this
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {hasEvidence && (
          <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
            <DialogContent className="max-w-md text-sm">
              <DialogHeader>
                <DialogTitle className="text-base">{title}</DialogTitle>
                <DialogDescription>
                  {evidence.window
                    ? `Measured over ${evidence.window}.`
                    : 'What this insight is based on.'}
                </DialogDescription>
              </DialogHeader>
              <EvidenceFacts evidence={evidence} />
            </DialogContent>
          </Dialog>
        )}
        {statusLine}
      </div>
    );
  }

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
              <EvidenceFacts evidence={evidence} />
            </PopoverContent>
          </Popover>
        )}
        {draftHref && (
          <Link href={draftHref} className={control}>
            {draftLabel}
          </Link>
        )}
        {squireName && (
          <button type="button" className={control} onClick={askSquire}>
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
      {statusLine}
    </div>
  );
}
