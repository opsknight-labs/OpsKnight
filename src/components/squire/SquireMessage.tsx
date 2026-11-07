'use client';

import { memo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Copy, Pencil, RefreshCw, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import SquireProposalCard from './SquireProposalCard';
import SquireSavedAction from './SquireSavedAction';
import OpsKnightSquire from './OpsKnightSquire';
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
}) {
  const [copyNotice, setCopyNotice] = useState('');
  const assistant = turn.role === 'assistant';
  const streaming = busy && last;
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
