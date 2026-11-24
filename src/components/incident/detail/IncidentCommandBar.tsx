'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IncidentStatus } from '@prisma/client';
import type { JiraCapability } from '@/lib/jira-capabilities';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import RelativeTime from '@/components/patterns/RelativeTime';
import { JiraLogo } from '@/components/common/BrandLogos';
import { WarRoomLauncher } from '@/components/incident/war-room/WarRoomLauncher';
import type { IncidentCollaborationView } from '@/lib/incident-collaboration/types';
import ResolveIncidentModal, { type ResolvingIncidentData } from '../ResolveIncidentModal';
import SnoozeDurationDialog from './SnoozeDurationDialog';
import IncidentTags from './IncidentTags';
import StatusUpdateAction, { type IncidentStatusUpdateView } from './StatusUpdateAction';
import { snoozeIncidentWithDuration } from '@/app/(app)/incidents/snooze-actions';
import {
  createJiraIssueFromIncident,
  linkJiraIssueToIncident,
  unlinkJiraIssueFromIncident,
  syncIncidentJiraIssue,
} from '@/app/(app)/incidents/jira/actions';
import { isJiraStatusDone } from '@/lib/jira-validation';
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
  Plus,
  Loader2,
  AlertCircle,
  Trash2,
  RefreshCw,
  Flag,
  Settings2,
  ChevronDown,
} from 'lucide-react';
import { notify } from '@/lib/toast';

function jiraStatusBadgeStyle(status: string | null): string {
  if (!status)
    return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
  if (isJiraStatusDone(status)) {
    return 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800';
  }
  const lower = status.toLowerCase();
  if (lower === 'in progress' || lower === 'in review' || lower === 'investigating') {
    return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800';
  }
  if (lower === 'to do' || lower === 'open' || lower === 'backlog') {
    return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
}

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
  /** Defaults to `canManage`. People paged for the incident may resolve without full manage. */
  canResolve?: boolean;
  /** Offered while the viewer may take the commander role and does not hold it. */
  canTakeCommand?: boolean;
  onTakeCommand?: () => Promise<unknown>;
  snoozedUntil: Date | null;
  onAcknowledge: () => void;
  onUnacknowledge: () => void;
  onUnsnooze: () => void;
  onSuppress: () => void;
  onUnsuppress: () => void;
  resolvingIncident: ResolvingIncidentData;
  postmortemHref: string;
  postmortemExists: boolean;
  collaboration?: IncidentCollaborationView;
  jira?: {
    links: JiraLinkItem[];
    enabled: boolean;
    serviceMapped: boolean;
    serviceSettingsHref: string;
  } | null;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  /** Mandatory source of truth for all operational Jira UI. */
  jiraCapability: JiraCapability;
  /** Null unless the viewer may publish and the incident has a status page to post on. */
  statusUpdate?: IncidentStatusUpdateView | null;
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

export default function IncidentCommandBar({
  incidentId,
  currentStatus,
  canManage,
  canAcknowledge,
  canResolve = canManage,
  canTakeCommand = false,
  onTakeCommand,
  snoozedUntil,
  onAcknowledge,
  onUnacknowledge,
  onUnsnooze,
  onSuppress,
  onUnsuppress,
  resolvingIncident,
  postmortemHref,
  postmortemExists,
  collaboration,
  jira,
  tags = [],
  jiraCapability,
  statusUpdate,
}: IncidentCommandBarProps) {
  const router = useRouter();
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const [showJiraDialog, setShowJiraDialog] = useState(false);
  const [jiraLinkKey, setJiraLinkKey] = useState('');
  const [isJiraPending, startJiraTransition] = useTransition();
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [syncingLinkId, setSyncingLinkId] = useState<string | null>(null);
  const [unlinkingLinkId, setUnlinkingLinkId] = useState<string | null>(null);
  const [isTakingCommand, startTakeCommand] = useTransition();
  const showTakeCommand = canTakeCommand && Boolean(onTakeCommand);
  const handleTakeCommand = () => {
    if (!onTakeCommand) return;
    startTakeCommand(async () => {
      try {
        await onTakeCommand();
        router.refresh();
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not take command');
      }
    });
  };

  const isResolved = currentStatus === 'RESOLVED';
  const isSnoozed = currentStatus === 'SNOOZED';
  const isSuppressed = currentStatus === 'SUPPRESSED';
  const isAcknowledged = currentStatus === 'ACKNOWLEDGED';
  const resumeText = isSnoozed ? formatResumeIn(snoozedUntil) : null;
  const canAct = canManage || canAcknowledge || canResolve;
  const showAcknowledge =
    !isAcknowledged && canAcknowledge && ((!isSuppressed && !isSnoozed) || isSnoozed);
  const showUnsnooze = canManage && isSnoozed;
  const showResolve = canResolve && !isResolved;

  const hasVisibleWarRoom = Boolean(collaboration?.visible);

  const jiraLinks = jira?.links || [];
  const primaryJira = jiraLinks[0];
  const serviceMapped = jiraCapability.serviceMapped;
  const hasOperationalJira = jiraCapability.showOperationalJira;
  const canManageLinkedJira =
    jiraCapability.canSync ||
    jiraCapability.canUnlink ||
    jiraCapability.canCreate ||
    jiraCapability.canLink;
  const hasAnyIntegrations =
    hasVisibleWarRoom || Boolean(primaryJira) || jiraCapability.showOperationalJira;

  const handleCreateJira = () => {
    if (!jiraCapability.canCreate) return;
    setJiraError(null);
    startJiraTransition(async () => {
      const result = await createJiraIssueFromIncident(incidentId);
      if (!result.success && result.error) setJiraError(result.error);
      else {
        setShowJiraDialog(false);
        router.refresh();
      }
    });
  };

  const handleLinkJira = () => {
    if (!jiraCapability.canLink || !jiraLinkKey.trim()) return;
    setJiraError(null);
    startJiraTransition(async () => {
      const result = await linkJiraIssueToIncident(incidentId, jiraLinkKey.trim());
      if (!result.success && result.error) setJiraError(result.error);
      else {
        setJiraLinkKey('');
        setShowJiraDialog(false);
        router.refresh();
      }
    });
  };

  const handleUnlinkJira = (linkId: string) => {
    if (!jiraCapability.canUnlink) return;
    setJiraError(null);
    setUnlinkingLinkId(linkId);
    startJiraTransition(async () => {
      try {
        const result = await unlinkJiraIssueFromIncident(linkId, incidentId);
        if (!result.success && result.error) setJiraError(result.error);
        else router.refresh();
      } finally {
        setUnlinkingLinkId(null);
      }
    });
  };

  const handleSyncJira = (linkId: string) => {
    if (!jiraCapability.canSync) return;
    setJiraError(null);
    setSyncingLinkId(linkId);
    startJiraTransition(async () => {
      try {
        const result = await syncIncidentJiraIssue(linkId, incidentId);
        if (!result.success && result.error) setJiraError(result.error);
        else router.refresh();
      } finally {
        setSyncingLinkId(null);
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
          className="h-8 w-8 p-0 shrink-0 border-border/80 bg-background hover:bg-muted/40 text-muted-foreground hover:text-foreground shadow-2xs transition-colors"
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
      <div role="status" aria-live="polite" className="sr-only">
        {statusAnnouncement}
      </div>

      <div
        className="hidden sm:flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-3.5 py-2 shadow-2xs transition-all text-card-foreground"
        data-command-bar
      >
        {/* Tags, then the incident's links out (war room, Jira, status page).
            Every control is the same 28 px bordered chip so the row reads as one set. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <IncidentTags incidentId={incidentId} tags={tags} canManage={canManage} variant="bar" />

          {(hasAnyIntegrations || statusUpdate) && (
            <div className="hidden h-4 w-px shrink-0 bg-border md:block" aria-hidden />
          )}

          {collaboration?.visible && (
            <WarRoomLauncher
              collaboration={collaboration}
              className="h-8 gap-1.5 px-2.5 border-input"
            />
          )}

          {primaryJira ? (
            // One control: key + status on the button, every linked issue and its actions in the popover.
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Jira issues: ${primaryJira.externalKey}${primaryJira.externalStatus ? `, ${primaryJira.externalStatus}` : ''}${jiraLinks.length > 1 ? `, and ${jiraLinks.length - 1} more` : ''}`}
                  className="group inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-semibold text-foreground shadow-2xs transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60"
                >
                  <JiraLogo className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono">{primaryJira.externalKey}</span>
                  {primaryJira.externalStatus && (
                    <span
                      className={cn(
                        'rounded border px-1 text-2xs font-semibold leading-4 whitespace-nowrap',
                        jiraStatusBadgeStyle(primaryJira.externalStatus)
                      )}
                    >
                      {primaryJira.externalStatus}
                    </span>
                  )}
                  {jiraLinks.length > 1 && (
                    <span className="text-2xs font-semibold text-muted-foreground">
                      +{jiraLinks.length - 1}
                    </span>
                  )}
                  <ChevronDown
                    className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
                    aria-hidden
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
                  <JiraLogo className="h-3.5 w-3.5" />
                  <h2 className="text-xs font-semibold text-foreground">
                    Jira {jiraLinks.length === 1 ? 'issue' : `issues · ${jiraLinks.length}`}
                  </h2>
                </div>
                <ul className="max-h-72 divide-y divide-border/60 overflow-y-auto">
                  {jiraLinks.map(link => (
                    <li key={link.id} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {link.externalKey}
                        </span>
                        {link.externalStatus && (
                          <span
                            className={cn(
                              'rounded border px-1 text-2xs font-semibold leading-4 whitespace-nowrap',
                              jiraStatusBadgeStyle(link.externalStatus)
                            )}
                          >
                            {link.externalStatus}
                          </span>
                        )}
                      </div>
                      <p className="text-2xs text-muted-foreground">
                        {link.externalAssignee
                          ? `Assigned to ${link.externalAssignee}`
                          : 'Unassigned'}
                        {' · '}
                        {link.lastSyncedAt ? (
                          <>
                            synced <RelativeTime date={link.lastSyncedAt} />
                          </>
                        ) : (
                          'not synced yet'
                        )}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-xs"
                        >
                          <a href={link.externalUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            Open in Jira
                          </a>
                        </Button>
                        {jiraCapability.canSync && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncJira(link.id)}
                            disabled={isJiraPending || syncingLinkId === link.id}
                            className="h-7 gap-1.5 px-2 text-xs"
                            title="Pull the latest status and assignee from Jira"
                          >
                            <RefreshCw
                              className={cn('h-3 w-3', syncingLinkId === link.id && 'animate-spin')}
                              aria-hidden
                            />
                            <span>Sync</span>
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {canManageLinkedJira && (
                  <div className="border-t border-border/60 p-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowJiraDialog(true)}
                      className="h-8 w-full justify-start gap-1.5 px-2 text-xs"
                    >
                      <Settings2 className="h-3.5 w-3.5" aria-hidden />
                      <span>Manage</span>
                      <span className="font-normal text-muted-foreground">
                        · link, create or unlink issues
                      </span>
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : jiraCapability.canLink ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowJiraDialog(true)}
              className="h-8 gap-1.5 border-dashed border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-2xs hover:text-foreground"
            >
              <JiraLogo className="h-3.5 w-3.5 shrink-0" />
              <span>Link Jira Issue</span>
            </Button>
          ) : null}

          <StatusUpdateAction statusUpdate={statusUpdate} />
        </div>

        {!canAct && !isResolved && (
          <span
            className="shrink-0 rounded-md border border-border/80 px-2.5 py-1 text-xs text-muted-foreground"
            title="Responders and Admins can act on any incident. Others can act on incidents assigned to them, that page them, or that belong to their teams."
          >
            View only
          </span>
        )}

        {canAct && (
          <div className="flex items-center gap-2 shrink-0">
            {isResolved ? (
              <Link href={postmortemHref}>
                <Button size="sm" className="h-8 gap-1.5 px-3.5 shadow-2xs text-xs font-semibold">
                  <FileText className="h-3.5 w-3.5" />
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
                      data-incident-action="acknowledge"
                      className="h-8 gap-1.5 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs text-xs transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" />
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
                      className="h-8 gap-1.5 px-3.5 font-medium shadow-2xs border-border/80 bg-background hover:bg-muted/40 text-foreground text-xs"
                    >
                      <Bell className="h-3.5 w-3.5" />
                      <span>Unsnooze</span>
                    </Button>
                  </form>
                )}
                {showResolve && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-incident-action="resolve"
                    className="h-8 gap-1.5 px-3.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 font-semibold shadow-2xs bg-background text-xs transition-colors"
                    onClick={() => setShowResolveModal(true)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>
                      Resolve<span className="sr-only"> Incident</span>
                    </span>
                  </Button>
                )}
                {showTakeCommand && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isTakingCommand}
                    className="h-8 gap-1.5 px-3 font-medium shadow-2xs border-border/80 bg-background hover:bg-muted/40 text-foreground text-xs"
                    onClick={handleTakeCommand}
                  >
                    {isTakingCommand ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Flag className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span>Take command</span>
                  </Button>
                )}
                {overflowMenu}
              </>
            )}
          </div>
        )}
      </div>

      {canAct && (
        <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur-md px-3 py-2.5 flex items-center gap-2 pb-[calc(0.625rem+env(safe-area-inset-bottom))] text-card-foreground shadow-lg">
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
                <form action={onAcknowledge} className="flex-1 min-w-0">
                  <Button
                    type="submit"
                    className="w-full h-11 gap-2 bg-linear-to-r from-emerald-600 to-emerald-600 text-white text-sm font-semibold truncate"
                  >
                    <Check className="h-4 w-4 shrink-0" />
                    <span className="truncate">Acknowledge</span>
                  </Button>
                </form>
              )}
              {!showAcknowledge && showResolve && (
                <Button
                  type="button"
                  className="flex-1 min-w-0 h-11 gap-2 border-emerald-300 text-emerald-700 text-sm font-semibold truncate dark:border-emerald-500/30 dark:text-emerald-300"
                  variant="outline"
                  onClick={() => setShowResolveModal(true)}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">Resolve incident</span>
                </Button>
              )}
              {collaboration?.visible && (
                <WarRoomLauncher collaboration={collaboration} presentation="mobile" />
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

      <Sheet open={showMobileMore} onOpenChange={setShowMobileMore}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader>
            <SheetTitle>Incident actions</SheetTitle>
          </SheetHeader>
          <div className="py-2.5 border-b border-border my-1">
            <IncidentTags incidentId={incidentId} tags={tags} canManage={canManage} variant="bar" />
          </div>
          <div className="flex flex-col gap-2 py-2">
            {!primaryJira && jiraCapability.canLink && (
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

            {primaryJira && canManageLinkedJira && (
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
                <span>Manage Jira Issues</span>
              </Button>
            )}

            <StatusUpdateAction
              statusUpdate={statusUpdate}
              presentation="mobile"
              onNavigate={() => setShowMobileMore(false)}
            />
            {showTakeCommand && !isResolved && (
              <Button
                type="button"
                variant="outline"
                disabled={isTakingCommand}
                className="w-full h-11 justify-start gap-2 text-sm font-medium"
                onClick={() => {
                  setShowMobileMore(false);
                  handleTakeCommand();
                }}
              >
                <Flag className="h-4 w-4" aria-hidden />
                <span>Take command</span>
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

      {(primaryJira || hasOperationalJira) && (
        <Dialog open={showJiraDialog} onOpenChange={setShowJiraDialog}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <JiraLogo className="h-5 w-5" />
                <span>{jiraLinks.length > 0 ? 'Jira Integration' : 'Link Jira Issue'}</span>
              </DialogTitle>
              <DialogDescription>
                {jiraLinks.length > 0
                  ? hasOperationalJira
                    ? 'Manage linked Jira issues or connect additional tickets to this incident.'
                    : 'View Jira issues previously linked to this incident.'
                  : 'Create a new issue from this incident or link an existing Jira issue key.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {jiraError && (
                <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-1.5 font-medium dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{jiraError}</span>
                </div>
              )}

              {jiraLinks.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                    Linked Issues ({jiraLinks.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {jiraLinks.map(link => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/70 dark:bg-zinc-800/40 dark:border-zinc-800 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <a
                            href={link.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-blue-600 hover:underline inline-flex items-center gap-1 dark:text-blue-400"
                          >
                            <span>{link.externalKey}</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {link.externalStatus && (
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border',
                                jiraStatusBadgeStyle(link.externalStatus)
                              )}
                            >
                              {link.externalStatus}
                            </span>
                          )}
                          {link.externalAssignee && (
                            <span className="text-ink-500 text-[11px] truncate max-w-[120px]">
                              {link.externalAssignee}
                            </span>
                          )}
                        </div>
                        {(jiraCapability.canSync || jiraCapability.canUnlink) && (
                          <div className="flex items-center gap-1 shrink-0">
                            {jiraCapability.canSync && (
                              <button
                                type="button"
                                onClick={() => handleSyncJira(link.id)}
                                disabled={isJiraPending || syncingLinkId === link.id}
                                title="Sync Jira Issue"
                                className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                              >
                                <RefreshCw
                                  className={cn(
                                    'h-3.5 w-3.5',
                                    syncingLinkId === link.id &&
                                      'animate-spin text-blue-600 dark:text-blue-400'
                                  )}
                                />
                              </button>
                            )}
                            {jiraCapability.canUnlink && (
                              <button
                                type="button"
                                onClick={() => handleUnlinkJira(link.id)}
                                disabled={isJiraPending || unlinkingLinkId === link.id}
                                title="Unlink Jira Issue"
                                className="p-1 rounded text-ink-400 hover:text-rose-600 transition-colors cursor-pointer dark:hover:text-rose-400"
                              >
                                {unlinkingLinkId === link.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600 dark:text-rose-400" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {jiraCapability.canCreate ? (
                <div className="p-3 rounded-lg border bg-slate-50/50 dark:bg-zinc-800/20 space-y-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                    Create new issue in project
                  </div>
                  <p className="text-xs text-ink-500">
                    Automatically creates a Jira issue with this incident&apos;s title and
                    description.
                  </p>
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
                </div>
              ) : hasOperationalJira && !serviceMapped ? (
                <div className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50">
                  <span>Service needs a Jira project mapping. </span>
                  <Link
                    href={jira?.serviceSettingsHref || '#'}
                    className="font-semibold underline hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Configure Service Mapping
                  </Link>
                </div>
              ) : null}

              {jiraCapability.canLink && (
                <div className="p-3 rounded-lg border bg-slate-50/50 dark:bg-zinc-800/20 space-y-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200">
                    Or link an existing issue key
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={jiraLinkKey}
                      onChange={event => setJiraLinkKey(event.target.value)}
                      placeholder="e.g. PROJ-123"
                      className="h-9 text-xs font-mono"
                      disabled={isJiraPending}
                      onKeyDown={event => event.key === 'Enter' && handleLinkJira()}
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
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowJiraDialog(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {showSnoozeDialog && (
        <SnoozeDurationDialog
          incidentId={incidentId}
          onClose={() => setShowSnoozeDialog(false)}
          onSnooze={snoozeIncidentWithDuration}
        />
      )}

      <ResolveIncidentModal
        incident={resolvingIncident}
        open={showResolveModal}
        onOpenChange={setShowResolveModal}
      />
    </>
  );
}
