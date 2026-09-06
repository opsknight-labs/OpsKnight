'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { ExternalLink, Link2, Loader2, Plus, RefreshCw, Tickets, Trash2 } from 'lucide-react';
import {
  createJiraIssueFromActionItem,
  linkJiraIssueToActionItem,
  unlinkJiraIssueFromActionItem,
  syncActionItemJiraIssue,
} from '@/app/(app)/action-items/jira/actions';
import type { ActionItemExternalIssue } from '@/lib/action-items';

function statusColor(status: string | undefined): string {
  if (!status) return 'bg-slate-100 text-slate-600';
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved')
    return 'bg-emerald-100 text-emerald-700';
  if (lower === 'in progress' || lower === 'in review') return 'bg-blue-100 text-blue-700';
  if (lower === 'to do' || lower === 'open' || lower === 'backlog')
    return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

interface ActionItemJiraBadgeProps {
  actionItemId: string;
  externalIssue?: ActionItemExternalIssue;
  canManage: boolean;
  compact?: boolean;
}

export default function ActionItemJiraBadge({
  actionItemId,
  externalIssue,
  canManage,
  compact = false,
}: ActionItemJiraBadgeProps) {
  const [isPending, startTransition] = useTransition();
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkKey, setLinkKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);

  // If there's a linked issue, show it as a badge
  if (externalIssue) {
    return (
      <div
        className="inline-flex items-center gap-1.5 group relative"
        onClick={event => event.stopPropagation()}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <a
          href={externalIssue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
          title={`${externalIssue.key}${externalIssue.status ? ` — ${externalIssue.status}` : ''}${externalIssue.assignee ? ` (${externalIssue.assignee})` : ''}`}
        >
          <Tickets className="h-3 w-3" />
          {externalIssue.key}
          {!compact && externalIssue.status && (
            <span
              className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium ${statusColor(externalIssue.status)}`}
            >
              {externalIssue.status}
            </span>
          )}
          <ExternalLink className="h-2.5 w-2.5 opacity-50" />
        </a>
        {canManage && showActions && (
          <div className="inline-flex items-center gap-0.5">
            <button
              className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await syncActionItemJiraIssue(externalIssue.linkId);
                  if (!res.success && res.error) setError(res.error);
                });
              }}
              disabled={isPending}
              title="Sync status"
            >
              <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} />
            </button>
            <button
              className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const res = await unlinkJiraIssueFromActionItem(externalIssue.linkId);
                  if (!res.success && res.error) setError(res.error);
                });
              }}
              disabled={isPending}
              title="Unlink"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  // No linked issue — show create/link options
  if (!canManage) return null;

  const handleLinkSubmit = () => {
    if (!linkKey.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await linkJiraIssueToActionItem(actionItemId, linkKey.trim());
      if (!res.success && res.error) {
        setError(res.error);
      } else {
        setLinkKey('');
        setShowLinkForm(false);
      }
    });
  };

  if (showLinkForm) {
    return (
      <div className="inline-flex items-center gap-1.5" onClick={event => event.stopPropagation()}>
        <Input
          value={linkKey}
          onChange={e => setLinkKey(e.target.value)}
          placeholder="KEY-123"
          className="h-6 w-24 text-xs px-1.5"
          disabled={isPending}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleLinkSubmit();
            } else if (e.key === 'Escape') {
              setShowLinkForm(false);
              setLinkKey('');
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleLinkSubmit}
          disabled={isPending || !linkKey.trim()}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1" onClick={event => event.stopPropagation()}>
      <button
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await createJiraIssueFromActionItem(actionItemId);
            if (!res.success && res.error) setError(res.error);
          });
        }}
        disabled={isPending}
        title="Create Jira issue"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Create Jira
      </button>
      <button
        className="rounded p-0.5 text-muted-foreground hover:text-blue-600 transition-colors"
        onClick={() => setShowLinkForm(true)}
        disabled={isPending}
        title="Link existing Jira issue"
      >
        <Link2 className="h-3 w-3" />
      </button>
      {error && <span className="text-xs text-destructive ml-1">{error}</span>}
      {error?.includes('not configured') && (
        <Link
          href="/settings/integrations/jira"
          className="text-[10px] font-medium text-blue-600 hover:underline"
        >
          Configure
        </Link>
      )}
    </div>
  );
}
