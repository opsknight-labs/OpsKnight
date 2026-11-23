'use client';

import { memo, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Copy, Loader2, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import SquireProposalCard from './SquireProposalCard';
import SquireSavedAction from './SquireSavedAction';
import SquireAvatar from './SquireAvatar';
import SquireInvestigationSteps from './SquireInvestigationSteps';
import type { Citation, Turn } from './chat-types';
import { incidentRef } from '@/lib/intelligence/incident-ux/explain';
import { SquireCitationFindingLink } from './SquireSurfaceControls';

// Parsing markdown is the most expensive part of a message. Memoized on its props, a finished answer is
// parsed once; only the answer still streaming is parsed again, once per animation frame of new text.
const Markdown = memo(
  dynamic(() => import('./SquireMarkdown'), {
    loading: () => <span>Formatting answer…</span>,
  })
);

// recharts is heavy and only answers with charts need it, so it stays out of the launcher's chunk.
const SquireChart = dynamic(() => import('./SquireChart'), {
  ssr: false,
  loading: () => <div className="h-40 rounded-lg border border-border bg-card" />,
});

/** Why a 👎 answer missed; the server keeps the reason, never the answer text. */
export const FEEDBACK_REASON_CHIPS = [
  { value: 'wrong_facts', label: 'Wrong facts' },
  { value: 'missed_point', label: 'Missed the point' },
  { value: 'too_long', label: 'Too long' },
  { value: 'wrong_action', label: 'Wrong action' },
  { value: 'other', label: 'Other' },
] as const;
const FEEDBACK_NOTE_MAX = 300;

/** The incident and service a turn was asked about, from its page; the server re-checks both. */
export function feedbackSubject(turn: Pick<Turn, 'incidentId' | 'context'>) {
  const [kind, id] = (turn.context ?? '').split(':');
  const incidentId = turn.incidentId ?? (kind === 'incident' && id ? id : undefined);
  return {
    ...(incidentId ? { incidentId } : {}),
    ...(kind === 'service' && id ? { serviceId: id } : {}),
  };
}

/** One chip per source; records that share a title (five "Workflow failed: Tests") carry their short id. */
export function distinctCitations(citations: readonly Citation[]) {
  const unique = [...new Map(citations.map(citation => [citation.href, citation])).values()];
  const shared = new Map<string, number>();
  for (const citation of unique) shared.set(citation.label, (shared.get(citation.label) ?? 0) + 1);
  return unique.map(citation => ({
    citation,
    ref: (shared.get(citation.label) ?? 0) > 1 ? incidentRef(citation.id) : null,
  }));
}

// Phones get 44 px targets; the desktop panel uses compact icon buttons.
const ACTION_BUTTON =
  'min-h-11 min-w-11 px-1.5 text-xs text-muted-foreground sm:min-h-7 sm:min-w-7';
// Message actions show on hover or keyboard focus where hovering exists; touch screens always show them.
const REVEAL =
  'motion-safe:transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

export default memo(function SquireMessage({
  turn,
  index,
  name,
  busy,
  last,
  animated,
  onOutcome,
  onRetry,
  onEdit,
  question,
  conversationId,
  pendingLabel = 'Thinking…',
  onCheer,
}: {
  turn: Turn;
  index: number;
  name: string;
  busy: boolean;
  last: boolean;
  animated: boolean;
  onOutcome: (outcome: 'success' | 'error') => void;
  onRetry: (index: number) => void;
  onEdit: (index: number) => void;
  /** The question this answer replied to; sent as a digest with feedback, never stored as text. */
  question?: string;
  conversationId?: string;
  /** Shown while the answer has no activity of its own to report yet. */
  pendingLabel?: string;
  /** A helpful rating: the mascot gives a little salute. */
  onCheer?: () => void;
}) {
  const [copyNotice, setCopyNotice] = useState('');
  const [feedback, setFeedback] = useState<'UP' | 'DOWN' | 'sent' | 'failed' | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const thumbsDown = useRef<HTMLButtonElement>(null);
  // Once the rating controls go away, focus moves to the status line instead of dropping to <body>.
  const focusStatus = useRef(false);
  const assistant = turn.role === 'assistant';
  const streaming = busy && last;
  const allowed = useMemo(
    () => (turn.citations ?? []).map(citation => citation.href),
    [turn.citations]
  );
  const sendFeedback = async (
    rating: 'UP' | 'DOWN',
    chosenReason?: string,
    chosenNote?: string
  ) => {
    if (sending) return;
    setSending(true);
    try {
      const response = await fetch('/api/intelligence/squire/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          mode: turn.mode ?? 'basic',
          ...(turn.intent ? { intent: turn.intent } : {}),
          ...(chosenReason ? { reason: chosenReason } : {}),
          ...(chosenNote?.trim() ? { note: chosenNote.trim().slice(0, FEEDBACK_NOTE_MAX) } : {}),
          ...feedbackSubject(turn),
          ...(question ? { question } : {}),
          ...(conversationId ? { conversationId } : {}),
        }),
      });
      focusStatus.current = true;
      setFeedback(response.ok ? 'sent' : 'failed');
    } catch {
      focusStatus.current = true;
      setFeedback('failed');
    } finally {
      setSending(false);
    }
  };
  if (!assistant) {
    return (
      <article aria-label="Your question" className="group ms-10 flex flex-col items-end gap-1">
        <div
          dir="auto"
          className="max-w-full whitespace-pre-wrap wrap-break-word rounded-2xl rounded-ee-md border border-border bg-muted px-3.5 py-2 text-sm"
        >
          {turn.notice && <p className="mb-1 text-xs text-muted-foreground">{turn.notice}</p>}
          {turn.content}
        </div>
        {!!turn.content && !streaming && (
          <Button
            size="sm"
            variant="ghost"
            className={`${ACTION_BUTTON} ${REVEAL}`}
            disabled={busy}
            onClick={() => onEdit(index)}
          >
            <Pencil aria-hidden="true" />
            Edit question
          </Button>
        )}
      </article>
    );
  }
  return (
    <article aria-label={`${name} response`} className="group flex min-w-0 gap-3">
      <span className="mt-0.5 shrink-0">
        <SquireAvatar
          size="xs"
          animated={animated && streaming}
          state={streaming ? 'thinking' : turn.failed ? 'error' : 'idle'}
        />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {turn.notice && <p className="text-xs leading-5 text-muted-foreground">{turn.notice}</p>}
        {turn.investigation && turn.investigation.length > 0 && (
          <SquireInvestigationSteps steps={turn.investigation} streaming={streaming} />
        )}
        {turn.content ? (
          <div dir="auto">
            <Markdown text={turn.content} allowed={allowed} references={turn.citations} />
          </div>
        ) : streaming && (!turn.investigation?.length || turn.activity) ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            {turn.activity ? `${turn.activity}…` : pendingLabel}
          </p>
        ) : null}
        {turn.content && turn.activity && streaming && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            {turn.activity}…
          </p>
        )}
        {turn.error && (
          <p role="alert" className="text-sm text-destructive">
            {turn.error}
          </p>
        )}
        {turn.charts?.map((chart, position) => (
          <SquireChart key={position} chart={chart} />
        ))}
        {!!turn.citations?.length && (
          <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
            {distinctCitations(turn.citations).map(({ citation, ref }, position) => (
              <li
                key={`${citation.kind}:${citation.id}`}
                className="flex min-w-0 max-w-full items-center gap-1"
              >
                <Link
                  href={citation.href}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs transition-colors hover:bg-accent sm:min-h-6"
                  title={[citation.label, citation.why].filter(Boolean).join(' · ')}
                >
                  <span
                    aria-hidden="true"
                    className="font-semibold tabular-nums text-muted-foreground"
                  >
                    {position + 1}
                  </span>
                  <span className="truncate">
                    {citation.kind === 'runbook' ? 'Runbook: ' : ''}
                    {citation.label}
                    {ref && <span className="text-muted-foreground"> · {ref}</span>}
                  </span>
                </Link>
                <SquireCitationFindingLink citation={citation} incidentId={turn.incidentId} />
              </li>
            ))}
          </ul>
        )}
        {turn.proposals?.map(proposal => (
          <SquireProposalCard
            key={proposal.token}
            proposal={proposal}
            onOutcome={onOutcome}
            assistantName={name}
          />
        ))}
        {turn.savedActions?.map(action => (
          <SquireSavedAction key={action.receiptId} action={action} />
        ))}
        {!!turn.content && !streaming && (
          <div className={`-ms-1.5 flex flex-wrap items-center gap-0.5 ${last ? '' : REVEAL}`}>
            <Button
              size="sm"
              variant="ghost"
              className={ACTION_BUTTON}
              aria-label="Copy response"
              title="Copy"
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
            </Button>
            {last && (
              <Button
                size="sm"
                variant="ghost"
                className={ACTION_BUTTON}
                aria-label={turn.failed ? undefined : 'Regenerate'}
                title={turn.failed ? undefined : 'Regenerate'}
                disabled={busy}
                onClick={() => onRetry(index)}
              >
                <RefreshCw aria-hidden="true" />
                {turn.failed && 'Retry answer'}
              </Button>
            )}
            {!turn.failed && feedback !== 'sent' && (
              <span
                role="group"
                className="flex items-center gap-0.5"
                aria-label="Rate this answer"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className={ACTION_BUTTON}
                  aria-label="Helpful answer"
                  title="Helpful"
                  aria-pressed={feedback === 'UP'}
                  disabled={feedback === 'UP'}
                  onClick={() => {
                    setFeedback('UP');
                    onCheer?.();
                    void sendFeedback('UP');
                  }}
                >
                  <ThumbsUp aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={ACTION_BUTTON}
                  ref={thumbsDown}
                  aria-label="Unhelpful answer"
                  title="Not helpful"
                  aria-pressed={feedback === 'DOWN'}
                  onClick={() => setFeedback(feedback === 'DOWN' ? null : 'DOWN')}
                >
                  <ThumbsDown aria-hidden="true" />
                </Button>
              </span>
            )}
            {turn.mode === 'basic' && (
              <span className="ms-1 text-2xs text-muted-foreground">
                Basic answer from your incident data
              </span>
            )}
          </div>
        )}
        {feedback === 'DOWN' && (
          <form
            aria-label="Why was this answer not helpful?"
            className="w-full space-y-2 rounded-lg border border-border bg-card p-3"
            onSubmit={event => {
              event.preventDefault();
              void sendFeedback('DOWN', reason || (note.trim() ? 'other' : undefined), note);
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium">What went wrong? (optional)</legend>
              <div className="flex flex-wrap gap-1.5">
                {FEEDBACK_REASON_CHIPS.map(chip => (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={reason === chip.value}
                    onClick={() => setReason(reason === chip.value ? '' : chip.value)}
                    className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 ${
                      reason === chip.value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label
              className="block text-xs text-muted-foreground"
              htmlFor={`feedback-note-${index}`}
            >
              Anything else? Don’t include secrets.
            </label>
            <textarea
              id={`feedback-note-${index}`}
              rows={2}
              maxLength={FEEDBACK_NOTE_MAX}
              value={note}
              onChange={event => setNote(event.target.value)}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                type="button"
                className="min-h-11 text-xs sm:min-h-8"
                onClick={() => {
                  setFeedback(null);
                  thumbsDown.current?.focus();
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="submit"
                disabled={sending}
                className="min-h-11 text-xs sm:min-h-8"
              >
                {sending ? 'Sending…' : 'Send feedback'}
              </Button>
            </div>
          </form>
        )}
        {(feedback === 'sent' || feedback === 'failed' || copyNotice) && (
          <p
            role="status"
            tabIndex={-1}
            ref={node => {
              if (node && focusStatus.current) {
                focusStatus.current = false;
                node.focus();
              }
            }}
            className="text-2xs text-muted-foreground focus-visible:outline-hidden"
          >
            {feedback === 'sent'
              ? 'Thanks for the feedback.'
              : feedback === 'failed'
                ? 'Could not send feedback.'
                : copyNotice}
          </p>
        )}
      </div>
    </article>
  );
});
