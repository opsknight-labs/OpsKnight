'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Link2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createJiraIssueFromActionItem,
  linkJiraIssueToActionItem,
  unlinkJiraIssueFromActionItem,
  syncActionItemJiraIssue,
} from '@/app/(app)/action-items/jira/actions';
import type { ActionItemExternalIssue } from '@/lib/action-items';
import type { JiraCapability } from '@/lib/jira-capabilities';
import JiraReferenceBadge from '@/components/jira/JiraReferenceBadge';

interface ActionItemJiraBadgeProps {
  actionItemId: string;
  externalIssue?: ActionItemExternalIssue;
  canManage: boolean;
  compact?: boolean;
  /** Mandatory centralized capability contract for every persisted action-item Jira surface. */
  jiraCapability: JiraCapability;
}

export default function ActionItemJiraBadge({
  actionItemId,
  externalIssue,
  compact = false,
  jiraCapability,
}: ActionItemJiraBadgeProps) {
  const [isPending, startTransition] = useTransition();
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkKey, setLinkKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [currentExternalIssue, setCurrentExternalIssue] = useState(externalIssue);

  useEffect(() => {
    setCurrentExternalIssue(externalIssue);
  }, [externalIssue]);

  const showSync = jiraCapability.canSync;
  const showUnlink = jiraCapability.canUnlink;
  const showCreate = jiraCapability.canCreate;
  const showLink = jiraCapability.canLink;
  const showAnyAction = jiraCapability.showOperationalJira;

  // Preserve existing Jira references as read-only when Jira is disabled or unavailable.
  if (currentExternalIssue) {
    return (
      <div
        className="inline-flex items-center gap-1.5 group relative"
        onClick={event => event.stopPropagation()}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <JiraReferenceBadge issue={currentExternalIssue} compact={compact} />
        {showAnyAction && showActions && (
          <div className="inline-flex items-center gap-0.5">
            {showSync && (
              <button
                className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await syncActionItemJiraIssue(
                      actionItemId,
                      currentExternalIssue.linkId
                    );
                    if (!res.success && res.error) {
                      setError(res.error);
                    } else if (res.externalIssue) {
                      setCurrentExternalIssue(res.externalIssue);
                    }
                  });
                }}
                disabled={isPending}
                title="Sync status"
              >
                <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} />
              </button>
            )}
            {showUnlink && (
              <button
                className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-red-50 transition-colors"
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await unlinkJiraIssueFromActionItem(
                      actionItemId,
                      currentExternalIssue.linkId
                    );
                    if (!res.success && res.error) {
                      setError(res.error);
                    } else {
                      setCurrentExternalIssue(undefined);
                      setShowActions(false);
                    }
                  });
                }}
                disabled={isPending}
                title="Unlink"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  if (!showAnyAction) return null;

  const handleLinkSubmit = () => {
    if (!showLink || !linkKey.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await linkJiraIssueToActionItem(actionItemId, linkKey.trim());
      if (!res.success && res.error) {
        setError(res.error);
      } else {
        if (res.externalIssue) setCurrentExternalIssue(res.externalIssue);
        setLinkKey('');
        setShowLinkForm(false);
      }
    });
  };

  if (showLinkForm && showLink) {
    return (
      <div className="inline-flex items-center gap-1.5" onClick={event => event.stopPropagation()}>
        <Input
          value={linkKey}
          onChange={event => setLinkKey(event.target.value)}
          placeholder="KEY-123"
          className="h-6 w-24 text-xs px-1.5"
          disabled={isPending}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleLinkSubmit();
            } else if (event.key === 'Escape') {
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
      {showCreate && (
        <button
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await createJiraIssueFromActionItem(actionItemId);
              if (!res.success && res.error) {
                setError(res.error);
              } else if (res.externalIssue) {
                setCurrentExternalIssue(res.externalIssue);
              }
            });
          }}
          disabled={isPending}
          title="Create Jira issue"
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Create Jira
        </button>
      )}
      {showLink && (
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-blue-600 transition-colors"
          onClick={() => setShowLinkForm(true)}
          disabled={isPending}
          title="Link existing Jira issue"
        >
          <Link2 className="h-3 w-3" />
        </button>
      )}
      {error && <span className="text-xs text-destructive ml-1">{error}</span>}
    </div>
  );
}
