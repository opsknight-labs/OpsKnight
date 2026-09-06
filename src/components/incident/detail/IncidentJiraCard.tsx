'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  Tickets,
  Trash2,
  Loader2,
  XCircle,
  Settings,
} from 'lucide-react';
import {
  createJiraIssueFromIncident,
  linkJiraIssueToIncident,
  unlinkJiraIssueFromIncident,
  syncIncidentJiraIssue,
} from '@/app/(app)/incidents/jira/actions';
import { cn } from '@/lib/utils';

type JiraLink = {
  id: string;
  externalKey: string;
  externalUrl: string;
  externalStatus: string | null;
  externalAssignee: string | null;
  syncState: string;
  lastSyncedAt: Date | null;
};

interface IncidentJiraCardProps {
  incidentId: string;
  serviceSettingsHref: string;
  jiraLinks: JiraLink[];
  jiraEnabled: boolean;
  serviceJiraMapped: boolean;
  canManage: boolean;
  className?: string;
}

function statusColor(status: string | null): string {
  if (!status) return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved')
    return 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/80';
  if (lower === 'in progress' || lower === 'in review')
    return 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/80';
  if (lower === 'to do' || lower === 'open' || lower === 'backlog')
    return 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/80';
  return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
}

export default function IncidentJiraCard({
  incidentId,
  serviceSettingsHref,
  jiraLinks,
  jiraEnabled,
  serviceJiraMapped,
  canManage,
  className,
}: IncidentJiraCardProps) {
  const [isPending, startTransition] = useTransition();
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkKey, setLinkKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setError(null);
    startTransition(async () => {
      const res = await createJiraIssueFromIncident(incidentId);
      if (!res.success && res.error) {
        setError(res.error);
      }
    });
  };

  const handleLink = () => {
    if (!linkKey.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await linkJiraIssueToIncident(incidentId, linkKey.trim());
      if (!res.success && res.error) {
        setError(res.error);
      } else {
        setLinkKey('');
        setShowLinkForm(false);
      }
    });
  };

  const handleUnlink = (linkId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await unlinkJiraIssueFromIncident(linkId, incidentId);
      if (!res.success && res.error) {
        setError(res.error);
      }
    });
  };

  const handleSync = (linkId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await syncIncidentJiraIssue(linkId, incidentId);
      if (!res.success && res.error) {
        setError(res.error);
      }
    });
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all',
        className
      )}
    >
      {/* Card Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
            <Tickets className="h-4 w-4 shrink-0" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 whitespace-nowrap">
              Jira Issues
            </h3>
            {jiraLinks.length > 0 && (
              <Badge
                variant="secondary"
                className="text-[10px] h-4.5 px-1.5 font-semibold text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-400 shrink-0"
              >
                {jiraLinks.length}
              </Badge>
            )}
          </div>
        </div>

        {canManage && jiraEnabled && (
          <Link
            href="/settings/integrations/jira"
            title="Configure Jira Integration"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Card Content */}
      <div className="p-3.5 space-y-3">
        {!jiraEnabled && (
          <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 p-3.5 text-center">
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-2.5">
              Connect Jira to create and link issues from this incident.
            </p>
            {canManage && (
              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                <Link href="/settings/integrations/jira">Configure Jira</Link>
              </Button>
            )}
          </div>
        )}

        {jiraEnabled && !serviceJiraMapped && (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800/80 p-3 text-xs text-amber-900 dark:text-amber-300">
            <p className="mb-2">
              Add a Jira project mapping for this service before creating new Jira issues.
            </p>
            {canManage && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 text-xs bg-white dark:bg-slate-800"
              >
                <Link href={serviceSettingsHref}>Map Jira Project</Link>
              </Button>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="py-2">
            <XCircle className="h-3.5 w-3.5" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Linked issues list */}
        {jiraLinks.length > 0 && (
          <div className="space-y-2">
            {jiraLinks.map(link => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-800/20 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={link.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    <span>{link.externalKey}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-bold uppercase border',
                        statusColor(link.externalStatus)
                      )}
                    >
                      {link.externalStatus ?? 'Unknown'}
                    </span>
                    {link.externalAssignee && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {link.externalAssignee}
                      </span>
                    )}
                  </div>
                </div>

                {canManage && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => handleSync(link.id)}
                      disabled={isPending}
                      title="Sync status"
                    >
                      <RefreshCw className={cn('h-3 w-3', isPending && 'animate-spin')} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      onClick={() => handleUnlink(link.id)}
                      disabled={isPending}
                      title="Unlink"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Link input form */}
        {showLinkForm && (
          <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
            <Input
              value={linkKey}
              onChange={e => setLinkKey(e.target.value)}
              placeholder="e.g. PROJ-123"
              className="h-7 text-xs font-mono bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
              disabled={isPending}
              onKeyDown={e => e.key === 'Enter' && handleLink()}
              autoFocus
            />
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs px-2.5 shrink-0"
              onClick={handleLink}
              disabled={isPending || !linkKey.trim()}
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Link'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2 shrink-0 text-slate-500"
              onClick={() => {
                setShowLinkForm(false);
                setLinkKey('');
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Action Buttons: Create Issue & Link */}
        {canManage && jiraEnabled && !showLinkForm && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs font-medium gap-1.5 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={handleCreate}
              disabled={isPending || !serviceJiraMapped}
              title={
                !serviceJiraMapped
                  ? 'Map a Jira project in Service Settings first'
                  : 'Create new issue in Jira'
              }
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>Create Issue</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 h-8 text-xs font-medium gap-1.5 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => setShowLinkForm(true)}
              disabled={isPending}
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>Link Existing</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
