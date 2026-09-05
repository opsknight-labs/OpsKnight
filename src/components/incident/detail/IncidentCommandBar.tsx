'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IncidentStatus } from '@prisma/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet';
import { SlackLogo, JiraLogo } from '@/components/common/BrandLogos';
import ResolveIncidentModal, { type ResolvingIncidentData } from '../ResolveIncidentModal';
import SnoozeDurationDialog from './SnoozeDurationDialog';
import IncidentTags from './IncidentTags';
import { snoozeIncidentWithDuration } from '@/app/(app)/incidents/snooze-actions';
import {
  createJiraIssueFromIncident,
  linkJiraIssueToIncident,
} from '@/app/(app)/incidents/jira/actions';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import {
  Check,
  X,
  CheckCircle2,
  Pause,
  BellOff,
  Bell,
  Volume2,
  MoreHorizontal,
  FileText,
  ExternalLink,
  Video,
  Plus,
  Loader2,
  AlertCircle,
  Archive,
} from 'lucide-react';

export type JiraLinkItem = {
  id: string;
  externalKey: string;
  externalUrl: string;
  externalStatus: string | null;
  externalAssignee: string | null;
  syncState: string;
  lastSyncedAt: Date | null;
};

type IncidentCommandBarProps = {
  incidentId: string;
  currentStatus: IncidentStatus;
  canManage: boolean;
  canAcknowledge: boolean;
  snoozedUntil: Date | null;
  onAcknowledge: () => void;
  onUnacknowledge: () => void;
  onUnsnooze: () => void;
  onSuppress: () => void;
  onUnsuppress: () => void;
  resolvingIncident: ResolvingIncidentData;
  postmortemHref: string;
  postmortemExists: boolean;
  // Collaboration
  warRoom?: {
    slackChannelId: string | null;
    slackChannelName: string | null;
    warRoomUrl: string | null;
    warRoomArchivedAt: Date | string | null;
  } | null;
  jira?: {
    links: JiraLinkItem[];
    enabled: boolean;
    serviceMapped: boolean;
    serviceSettingsHref: string;
  } | null;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
};

function formatResumeIn(snoozedUntil: Date | null): string | null {
  if (!snoozedUntil) return null;
  const diffMs = new Date(snoozedUntil).getTime() - Date.now();
  if (diffMs <= 0) return 'resuming shortly';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `resumes in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `resumes in ${hours}h ${remMins}m`;
}

function displayError(error: unknown, fallback: string): string {
  const friendly = toUserFacingError(error, fallback);
  return friendly.description ? `${friendly.title} ${friendly.description}` : friendly.title;
}

export default function IncidentCommandBar({
  incidentId,
  currentStatus,
  canManage,
  canAcknowledge,
  snoozedUntil,
  onAcknowledge,
  onUnacknowledge,
  onUnsnooze,
  onSuppress,
  onUnsuppress,
  resolvingIncident,
  postmortemHref,
  postmortemExists,
  warRoom,
  jira,
  tags = [],
}: IncidentCommandBarProps) {
  const router = useRouter();
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);

  // Slack War-Room state
  const [isWarRoomPending, startWarRoomTransition] = useTransition();
  const [warRoomError, setWarRoomError] = useState<string | null>(null);

  // Jira state
  const [showJiraDialog, setShowJiraDialog] = useState(false);
  const [jiraLinkKey, setJiraLinkKey] = useState('');
  const [isJiraPending, startJiraTransition] = useTransition();
  const [jiraError, setJiraError] = useState<string | null>(null);

  const isResolved = currentStatus === 'RESOLVED';
  const isSnoozed = currentStatus === 'SNOOZED';
  const isSuppressed = currentStatus === 'SUPPRESSED';
  const isAcknowledged = currentStatus === 'ACKNOWLEDGED';
  const resumeText = isSnoozed ? formatResumeIn(snoozedUntil) : null;

  const canAct = canManage || canAcknowledge;
  const showAcknowledge =
    !isAcknowledged && canAcknowledge && ((!isSuppressed && !isSnoozed) || isSnoozed);
  const showUnsnooze = canManage && isSnoozed;
  const showResolve = canManage && !isResolved;

  // War-Room logic
  const isWarRoomArchived = Boolean(warRoom?.warRoomArchivedAt);
  const hasActiveWarRoom = Boolean(warRoom?.slackChannelId) && !isWarRoomArchived;

  const handleCreateWarRoom = () => {
    setWarRoomError(null);
    startWarRoomTransition(async () => {
      try {
        const response = await fetch('/api/slack/war-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incidentId, action: 'create' }),
        });
        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to create war-room');
        }
        router.refresh();
      } catch (err: unknown) {
        setWarRoomError(displayError(err, 'Failed to create war-room'));
      }
    });
  };

  const handleArchiveWarRoom = () => {
    setWarRoomError(null);
    startWarRoomTransition(async () => {
      try {
        const response = await fetch('/api/slack/war-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ incidentId, action: 'archive' }),
        });
        if (!response.ok) {
          throw await errorFromResponse(response, 'Failed to archive war-room');
        }
        router.refresh();
      } catch (err: unknown) {
        setWarRoomError(displayError(err, 'Failed to archive war-room'));
      }
    });
  };

  // Jira logic
  const jiraLinks = jira?.links || [];
  const primaryJira = jiraLinks[0];
  const jiraEnabled = jira?.enabled ?? false;

  const handleCreateJira = () => {
    setJiraError(null);
    startJiraTransition(async () => {
      const res = await createJiraIssueFromIncident(incidentId);
      if (!res.success && res.error) {
        setJiraError(res.error);
      } else {
        setShowJiraDialog(false);
        router.refresh();
      }
    });
  };

  const handleLinkJira = () => {
    if (!jiraLinkKey.trim()) return;
    setJiraError(null);
    startJiraTransition(async () => {
      const res = await linkJiraIssueToIncident(incidentId, jiraLinkKey.trim());
      if (!res.success && res.error) {
        setJiraError(res.error);
      } else {
        setJiraLinkKey('');
        setShowJiraDialog(false);
        router.refresh();
      }
    });
  };

  const overflowItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      icon: React.ReactNode;
      isSnoozeTrigger?: boolean;
      run?: () => void;
    }> = [];
    if (!canManage) return items;
    if (isAcknowledged) {
      items.push({
        key: 'unacknowledge',
        label: 'Unacknowledge',
        icon: <X className="h-4 w-4" />,
        run: onUnacknowledge,
      });
    }
    if (!isSnoozed && !isSuppressed) {
      items.push({
        key: 'snooze',
        label: 'Snooze',
        icon: <Pause className="h-4 w-4" />,
        isSnoozeTrigger: true,
      });
    }
    if (isSuppressed) {
      items.push({
        key: 'unsuppress',
        label: 'Unsuppress',
        icon: <Volume2 className="h-4 w-4" />,
        run: onUnsuppress,
      });
    } else if (!isSnoozed) {
      items.push({
        key: 'suppress',
        label: 'Suppress',
        icon: <BellOff className="h-4 w-4" />,
        run: onSuppress,
      });
    }
    return items;
  }, [
    canManage,
    isAcknowledged,
    isSnoozed,
    isSuppressed,
    onUnacknowledge,
    onSuppress,
    onUnsuppress,
  ]);

  const getStatusBorder = () => {
    switch (currentStatus) {
      case 'OPEN':
        return 'border-l-4 border-l-rose-500';
      case 'ACKNOWLEDGED':
        return 'border-l-4 border-l-amber-500';
      case 'RESOLVED':
        return 'border-l-4 border-l-emerald-500';
      case 'SNOOZED':
        return 'border-l-4 border-l-indigo-500';
      case 'SUPPRESSED':
        return 'border-l-4 border-l-zinc-500';
      default:
        return 'border-l-4 border-l-slate-300';
    }
  };

  const statusAnnouncement = isResolved
    ? 'Incident resolved'
    : isSnoozed
      ? `Incident snoozed${resumeText ? `, ${resumeText}` : ''}`
      : isSuppressed
        ? 'Incident suppressed'
        : isAcknowledged
          ? 'Incident acknowledged'
          : 'Incident open, awaiting acknowledgement';

  const overflowMenu = overflowItems.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-9 p-0 shrink-0 border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-xs"
          aria-label="More incident actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {overflowItems.map(item => (
          <DropdownMenuItem
            key={item.key}
            onSelect={() => (item.isSnoozeTrigger ? setShowSnoozeDialog(true) : item.run?.())}
          >
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {/* Screen-reader announcement */}
      <div role="status" aria-live="polite" className="sr-only">
        {statusAnnouncement}
      </div>

      {/* Desktop / tablet Command Bar card with standard sizes */}
      <div
        className={cn(
          'hidden sm:flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm transition-all dark:bg-slate-900 dark:border-slate-800',
          getStatusBorder()
        )}
        data-command-bar
      >
        {/* Left Side: Standard Collaboration Buttons with Integrations label */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 select-none">
            Integrations:
          </span>
          {/* Slack War-Room */}
          {hasActiveWarRoom ? (
            <div className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-emerald-50 text-emerald-900 border border-emerald-200 text-sm font-medium shadow-xs">
              <SlackLogo className="h-4 w-4 shrink-0" />
              <a
                href={`slack://channel?team=&id=${warRoom?.slackChannelId}`}
                className="hover:underline font-semibold"
                title="Open in Slack App"
              >
                #{warRoom?.slackChannelName || 'war-room'}
              </a>
              <a
                href={`https://slack.com/app_redirect?channel=${warRoom?.slackChannelId}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Web Browser"
                className="text-emerald-700 hover:text-emerald-900"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {warRoom?.warRoomUrl && (
                <a
                  href={warRoom.warRoomUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Join Video Huddle"
                  className="ml-1 pl-2 border-l border-emerald-300 text-emerald-800 hover:text-emerald-950 inline-flex items-center gap-1.5 font-semibold"
                >
                  <Video className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Huddle</span>
                </a>
              )}
              {canManage && isResolved && (
                <button
                  type="button"
                  onClick={handleArchiveWarRoom}
                  disabled={isWarRoomPending}
                  title="Archive War-Room"
                  className="ml-1 pl-2 border-l border-emerald-300 text-emerald-700 hover:text-rose-600 transition-colors"
                >
                  {isWarRoomPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          ) : (
            canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCreateWarRoom}
                disabled={isWarRoomPending}
                className="h-9 gap-2 px-3 text-sm font-medium bg-white hover:bg-slate-50 border-slate-200 text-slate-800 shadow-xs hover:border-slate-300 transition-all"
              >
                {isWarRoomPending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                ) : (
                  <SlackLogo className="h-4 w-4 shrink-0" />
                )}
                <span>{isWarRoomArchived ? 'Re-open War-Room' : 'Create War-Room'}</span>
              </Button>
            )
          )}

          {/* Jira Integration */}
          {primaryJira ? (
            <div className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-blue-50 text-blue-900 border border-blue-200 text-sm font-medium shadow-xs">
              <JiraLogo className="h-4 w-4 shrink-0" />
              <a
                href={primaryJira.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline font-semibold inline-flex items-center gap-1"
                title={`Jira: ${primaryJira.externalKey}`}
              >
                <span>{primaryJira.externalKey}</span>
                {primaryJira.externalStatus && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 font-bold uppercase">
                    {primaryJira.externalStatus}
                  </span>
                )}
                <ExternalLink className="h-3.5 w-3.5 text-blue-600 ml-0.5" />
              </a>
              {jiraLinks.length > 1 && (
                <span className="text-xs font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                  +{jiraLinks.length - 1}
                </span>
              )}
            </div>
          ) : jiraEnabled ? (
            canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowJiraDialog(true)}
                className="h-9 gap-2 px-3 text-sm font-medium bg-white hover:bg-slate-50 border-slate-200 text-slate-800 shadow-xs hover:border-slate-300 transition-all"
              >
                <JiraLogo className="h-4 w-4 shrink-0" />
                <span>Link Jira Issue</span>
              </Button>
            )
          ) : (
            canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => router.push('/settings/integrations/jira')}
                className="h-9 gap-2 px-3 text-sm font-medium bg-white hover:bg-slate-50 border-slate-200 text-slate-800 shadow-xs hover:border-slate-300 transition-all"
              >
                <JiraLogo className="h-4 w-4 shrink-0" />
                <span>Connect Jira</span>
              </Button>
            )
          )}

          {warRoomError && (
            <span className="text-xs text-rose-600 inline-flex items-center gap-1 font-medium">
              <AlertCircle className="h-3.5 w-3.5" />
              {warRoomError}
            </span>
          )}

          {/* Vertical divider between Integrations and Tags */}
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 shrink-0 hidden md:block" />

          {/* Tags Section */}
          <IncidentTags incidentId={incidentId} tags={tags} canManage={canManage} variant="bar" />
        </div>

        {/* Right Side: Standard Lifecycle Action Buttons */}
        {canAct && (
          <div className="flex items-center gap-2.5 shrink-0">
            {isResolved ? (
              <Link href={postmortemHref}>
                <Button size="sm" className="h-9 gap-2 px-4 shadow-xs text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  <span>
                    {postmortemExists
                      ? 'View Postmortem'
                      : canManage
                        ? 'Create Postmortem'
                        : 'View Postmortem'}
                  </span>
                </Button>
              </Link>
            ) : (
              <>
                {showAcknowledge && (
                  <form action={onAcknowledge}>
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 gap-2 px-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold shadow-xs text-sm"
                    >
                      <Check className="h-4 w-4" />
                      <span>Acknowledge</span>
                    </Button>
                  </form>
                )}
                {showUnsnooze && (
                  <form action={onUnsnooze}>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      className="h-9 gap-2 px-4 font-medium shadow-xs border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-sm"
                    >
                      <Bell className="h-4 w-4" />
                      <span>Unsnooze</span>
                    </Button>
                  </form>
                )}
                {showResolve && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-2 px-4 border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold shadow-xs bg-white text-sm"
                    onClick={() => setShowResolveModal(true)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Resolve Incident</span>
                  </Button>
                )}
                {overflowMenu}
              </>
            )}
          </div>
        )}
      </div>

      {/* Mobile sticky bottom action bar */}
      {canAct && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
          {isResolved ? (
            <Link href={postmortemHref} className="flex-1">
              <Button className="w-full h-11 gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4" />
                <span>{postmortemExists ? 'View Postmortem' : 'Postmortem'}</span>
              </Button>
            </Link>
          ) : (
            <>
              {showAcknowledge && (
                <form action={onAcknowledge} className="flex-1">
                  <Button
                    type="submit"
                    className="w-full h-11 gap-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white text-sm font-semibold"
                  >
                    <Check className="h-4 w-4" />
                    <span>Acknowledge</span>
                  </Button>
                </form>
              )}
              {!showAcknowledge && showResolve && (
                <Button
                  type="button"
                  className="flex-1 h-11 gap-2 border-emerald-300 text-emerald-700 text-sm font-semibold"
                  variant="outline"
                  onClick={() => setShowResolveModal(true)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Resolve incident</span>
                </Button>
              )}
              {hasActiveWarRoom && (
                <a
                  href={`slack://channel?team=&id=${warRoom?.slackChannelId}`}
                  className="h-11 w-11 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"
                  title="Open Slack"
                >
                  <SlackLogo className="h-5 w-5" />
                </a>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="More incident actions"
                onClick={() => setShowMobileMore(true)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Mobile More Actions Sheet */}
      <Sheet open={showMobileMore} onOpenChange={setShowMobileMore}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <SheetTitle>Incident actions</SheetTitle>
          </SheetHeader>
          <div className="py-2.5 border-b border-slate-100 dark:border-slate-800 my-1">
            <IncidentTags incidentId={incidentId} tags={tags} canManage={canManage} variant="bar" />
          </div>
          <div className="flex flex-col gap-2 py-2">
            {canManage && !hasActiveWarRoom && (
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 justify-start gap-2.5 text-sm font-medium"
                onClick={() => {
                  setShowMobileMore(false);
                  handleCreateWarRoom();
                }}
                disabled={isWarRoomPending}
              >
                <SlackLogo className="h-4 w-4" />
                <span>Create Slack War-Room</span>
              </Button>
            )}
            {canManage && !primaryJira && jiraEnabled && (
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 justify-start gap-2.5 text-sm font-medium"
                onClick={() => {
                  setShowMobileMore(false);
                  setShowJiraDialog(true);
                }}
              >
                <JiraLogo className="h-4 w-4" />
                <span>Link Jira Issue</span>
              </Button>
            )}
            {showUnsnooze && (
              <form action={onUnsnooze}>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full h-11 justify-start gap-2 text-sm font-medium"
                >
                  <Bell className="h-4 w-4" />
                  <span>Unsnooze</span>
                </Button>
              </form>
            )}
            {overflowItems.map(item => (
              <Button
                key={item.key}
                type="button"
                variant="outline"
                className="w-full h-11 justify-start gap-2 text-sm font-medium"
                onClick={() => {
                  setShowMobileMore(false);
                  if (item.isSnoozeTrigger) setShowSnoozeDialog(true);
                  else item.run?.();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Jira Link / Create Modal */}
      <Dialog open={showJiraDialog} onOpenChange={setShowJiraDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <JiraLogo className="h-5 w-5" />
              <span>Link Jira Issue</span>
            </DialogTitle>
            <DialogDescription>
              Create a new issue from this incident or link an existing Jira issue key.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {jiraError && (
              <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-1.5 font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{jiraError}</span>
              </div>
            )}

            {/* Option 1: Create New Issue */}
            <div className="p-3 rounded-lg border bg-slate-50/50 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Create new issue in project
              </div>
              <p className="text-xs text-slate-500">
                Automatically creates a Jira issue with this incident&apos;s title and description.
              </p>
              {jira?.serviceMapped ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateJira}
                  disabled={isJiraPending}
                  className="w-full h-9 gap-2 text-xs font-semibold"
                >
                  {isJiraPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span>Create Jira Issue</span>
                </Button>
              ) : (
                <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                  <span>Service needs a Jira project mapping. </span>
                  <Link
                    href={jira?.serviceSettingsHref || '#'}
                    className="font-semibold underline hover:text-amber-900"
                  >
                    Configure Service Mapping
                  </Link>
                </div>
              )}
            </div>

            {/* Option 2: Link Existing Key */}
            <div className="p-3 rounded-lg border bg-slate-50/50 space-y-2">
              <div className="text-xs font-semibold text-slate-800">
                Or link an existing issue key
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={jiraLinkKey}
                  onChange={e => setJiraLinkKey(e.target.value)}
                  placeholder="e.g. PROJ-123"
                  className="h-9 text-xs font-mono"
                  disabled={isJiraPending}
                  onKeyDown={e => e.key === 'Enter' && handleLinkJira()}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleLinkJira}
                  disabled={isJiraPending || !jiraLinkKey.trim()}
                  className="h-9 text-xs font-semibold shrink-0 px-3"
                >
                  {isJiraPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Link'}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowJiraDialog(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Snooze duration dialog */}
      {showSnoozeDialog && (
        <SnoozeDurationDialog
          incidentId={incidentId}
          onClose={() => setShowSnoozeDialog(false)}
          onSnooze={snoozeIncidentWithDuration}
        />
      )}

      {/* Resolve Incident modal with mandatory note */}
      <ResolveIncidentModal
        incident={resolvingIncident}
        open={showResolveModal}
        onOpenChange={setShowResolveModal}
      />
    </>
  );
}
