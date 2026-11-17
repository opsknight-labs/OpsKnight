'use client';

import { useState, useTransition } from 'react';
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
  const [currentExternalIssue, setCurrentExternalIssue] = useState(externalIssue);

  const [syncedExternalIssue, setSyncedExternalIssue] = useState(externalIssue);
  if (syncedExternalIssue !== externalIssue) {
    setSyncedExternalIssue(externalIssue);
    setCurrentExternalIssue(externalIssue);
  }

  const showSync = jiraCapability.canSync;
  const showUnlink = jiraCapability.canUnlink;
  const showCreate = jiraCapability.canCreate;
  const showLink = jiraCapability.canLink;
  const showAnyAction = jiraCapability.showOperationalJira;

  // Preserve existing Jira references as read-only when Jira is disabled or unavailable.
  if (currentExternalIssue) {
    return (
      <div className="group relative inline-flex items-center gap-1.5">
        <JiraReferenceBadge issue={currentExternalIssue} compact={compact} />
        {showAnyAction && (
          // Shown on hover, on keyboard focus and always on touch screens.
          <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {showSync && (
              <button
                type="button"
                data-icon-button=""
                aria-label={`Sync ${currentExternalIssue.key} status from Jira`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 hover:bg-muted hover:text-foreground"
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
                <RefreshCw
                  aria-hidden="true"
                  className={`h-3 w-3 ${isPending ? 'motion-safe:animate-spin' : ''}`}
                />
              </button>
            )}
            {showUnlink && (
              <button
                type="button"
                data-icon-button=""
                aria-label={`Unlink ${currentExternalIssue.key}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 hover:bg-rose-50 hover:text-destructive dark:hover:bg-rose-500/10"
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
                    }
                  });
                }}
                disabled={isPending}
                title="Unlink"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
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
      <div className="inline-flex items-center gap-1.5">
        <Input
          aria-label="Jira issue key"
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
          type="button"
          variant="ghost"
          size="icon"
          data-icon-button=""
          className="h-6 w-6"
          onClick={handleLinkSubmit}
          disabled={isPending || !linkKey.trim()}
          aria-label="Link Jira issue"
        >
          {isPending ? (
            <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Link2 className="h-3 w-3" aria-hidden="true" />
          )}
        </Button>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      {showCreate && (
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-ink-300 px-2 text-2xs font-medium text-muted-foreground transition-colors duration-150 hover:border-ink-400 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
          {isPending ? (
            <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-3 w-3" aria-hidden="true" />
          )}
          Create Jira
        </button>
      )}
      {showLink && (
        <button
          type="button"
          data-icon-button=""
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 hover:bg-muted hover:text-foreground"
          onClick={() => setShowLinkForm(true)}
          disabled={isPending}
          title="Link existing Jira issue"
          aria-label="Link existing Jira issue"
        >
          <Link2 className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
      {error && (
        <span role="alert" className="ml-1 text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
