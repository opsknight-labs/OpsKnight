'use client';

import { memo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Copy, Pencil, RefreshCw, ArrowUpRight, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import SquireProposalCard from './SquireProposalCard';
import SquireSavedAction from './SquireSavedAction';
import OpsKnightSquire from './OpsKnightSquire';
import SquireInvestigationSteps from './SquireInvestigationSteps';
import type { Turn } from './chat-types';

const Markdown = dynamic(() => import('./SquireMarkdown'), {
  loading: () => <span>Formatting answer…</span>,
});

export default memo(function SquireMessage({
  turn,
  index,
  name,
  busy,
  last,
  animated,
  contextValid,
  onOutcome,
  onRetry,
  onEdit,
  question,
  conversationId,
}: {
  turn: Turn;
  index: number;
  name: string;
  busy: boolean;
  last: boolean;
  animated: boolean;
  contextValid: boolean;
  onOutcome: (outcome: 'success' | 'error') => void;
  onRetry: (index: number) => void;
  onEdit: (index: number) => void;
  /** The question this answer replied to; sent as a digest with feedback, never stored as text. */
  question?: string;
  conversationId?: string;
}) {
  const [copyNotice, setCopyNotice] = useState('');
  const [feedback, setFeedback] = useState<'UP' | 'DOWN' | 'sent' | 'failed' | null>(null);
  const [reason, setReason] = useState('');
  const assistant = turn.role === 'assistant';
  const streaming = busy && last;
  const sendFeedback = async (rating: 'UP' | 'DOWN', chosenReason?: string) => {
    try {
      const response = await fetch('/api/intelligence/squire/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          mode: turn.mode ?? 'basic',
          ...(turn.intent ? { intent: turn.intent } : {}),
          ...(chosenReason ? { reason: chosenReason } : {}),
          ...(question ? { question } : {}),
          ...(conversationId ? { conversationId } : {}),
        }),
      });
      setFeedback(response.ok ? 'sent' : 'failed');
    } catch {
      setFeedback('failed');
    }
  };
  return (
    <article
      aria-label={assistant ? `${name} response` : 'Your question'}
      className={assistant ? 'min-w-0 space-y-2' : 'ml-8 flex flex-col items-end gap-1'}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {assistant ? name : 'You'}
      </p>
      <div
        className={
          assistant
            ? 'min-w-0'
            : 'max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-sm leading-6'
        }
      >
        {turn.notice && (
          <p className="mb-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
            {turn.notice}
          </p>
        )}
        {assistant && turn.investigation && turn.investigation.length > 0 && (
          <SquireInvestigationSteps steps={turn.investigation} streaming={streaming} />
        )}
        {turn.content ? (
          assistant ? (
            <Markdown
              text={turn.content}
              allowed={(turn.citations ?? []).map(citation => citation.href)}
              references={turn.citations}
            />
          ) : (
            turn.content
          )
        ) : streaming ? (
          <div className="flex items-center gap-3 rounded-xl bg-muted/30 px-3 py-2">
            <OpsKnightSquire state="thinking" size={48} animated={animated} label="" />
            <span className="text-sm text-muted-foreground">
              {turn.activity ? `${turn.activity}…` : 'Thinking…'}
            </span>
          </div>
        ) : null}
        {turn.content && turn.activity && streaming && (
          <p className="mt-2 text-xs text-muted-foreground">{turn.activity}…</p>
        )}
        {turn.error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {turn.error}
          </p>
        )}
        {turn.proposals?.map(proposal => (
          <SquireProposalCard
            key={proposal.token}
            proposal={proposal}
            reviewContextValid={contextValid}
            onOutcome={onOutcome}
          />
        ))}
        {turn.savedActions?.map(action => (
          <SquireSavedAction key={action.receiptId} action={action} />
        ))}
        {!!turn.citations?.length && (
          <ul aria-label="Sources" className="mt-3 flex flex-wrap gap-2">
            {turn.citations.map(citation => (
              <li key={`${citation.kind}:${citation.id}`} className="min-w-0 max-w-full">
                <Link
                  href={citation.href}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent"
                  title={[citation.label, citation.why].filter(Boolean).join(' · ')}
                >
                  <span className="truncate">
                    {citation.kind === 'runbook' ? 'Runbook: ' : ''}
                    {citation.label}
                  </span>
                  <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!!turn.content && !streaming && (
        <div className="flex flex-wrap items-center gap-1">
          {assistant ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 px-2 text-xs text-muted-foreground"
                aria-label="Copy response"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(turn.content);
                    setCopyNotice('Response copied');
                  } catch {
                    setCopyNotice('Could not copy. Select the answer to copy it.');
                  }
                }}
              >
                <Copy aria-hidden="true" />
                Copy
              </Button>
              {last && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 px-2 text-xs text-muted-foreground"
                  disabled={busy || !contextValid}
                  onClick={() => onRetry(index)}
                >
                  <RefreshCw aria-hidden="true" />
                  {turn.failed ? 'Retry answer' : 'Regenerate'}
                </Button>
              )}
              {turn.mode === 'basic' && (
                <span className="text-[11px] text-muted-foreground">
                  Basic answer from your incident data
                </span>
              )}
              {!turn.failed && feedback !== 'sent' && (
                <span className="ml-auto flex items-center gap-0.5" aria-label="Rate this answer">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 px-2 text-muted-foreground"
                    aria-label="Helpful answer"
                    aria-pressed={feedback === 'UP'}
                    disabled={feedback === 'UP'}
                    onClick={() => {
                      setFeedback('UP');
                      void sendFeedback('UP');
                    }}
                  >
                    <ThumbsUp aria-hidden="true" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 px-2 text-muted-foreground"
                    aria-label="Unhelpful answer"
                    aria-pressed={feedback === 'DOWN'}
                    onClick={() => setFeedback(feedback === 'DOWN' ? null : 'DOWN')}
                  >
                    <ThumbsDown aria-hidden="true" />
                  </Button>
                </span>
              )}
              {feedback === 'DOWN' && (
                <form
                  className="flex w-full flex-wrap items-center gap-2 pt-1"
                  onSubmit={event => {
                    event.preventDefault();
                    void sendFeedback('DOWN', reason || 'other');
                  }}
                >
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor={`feedback-reason-${index}`}
                  >
                    What was wrong?
                  </label>
                  <select
                    id={`feedback-reason-${index}`}
                    className="min-h-11 rounded-md border border-border bg-background px-2 text-xs"
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                  >
                    <option value="">Choose a reason</option>
                    <option value="wrong">Wrong</option>
                    <option value="incomplete">Incomplete</option>
                    <option value="outdated">Out of date</option>
                    <option value="unclear">Unclear</option>
                    <option value="unsafe">Unsafe or risky</option>
                    <option value="other">Other</option>
                  </select>
                  <Button size="sm" variant="outline" type="submit" className="min-h-11 text-xs">
                    Send
                  </Button>
                </form>
              )}
              {feedback === 'sent' && (
                <span role="status" className="text-[11px] text-muted-foreground">
                  Thanks for the feedback.
                </span>
              )}
              {feedback === 'failed' && (
                <span role="status" className="text-[11px] text-muted-foreground">
                  Could not send feedback.
                </span>
              )}
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 px-2 text-xs text-muted-foreground"
              disabled={busy || !contextValid}
              onClick={() => onEdit(index)}
            >
              <Pencil aria-hidden="true" />
              Edit question
            </Button>
          )}
          {copyNotice && (
            <span role="status" className="text-xs text-muted-foreground">
              {copyNotice}
            </span>
          )}
        </div>
      )}
    </article>
  );
});
