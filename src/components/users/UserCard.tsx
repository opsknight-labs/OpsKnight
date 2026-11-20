'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import UserAvatar from '@/components/UserAvatar';
import OidcLinkingApprovalButton from './OidcLinkingApprovalButton';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { errorFromResponse } from '@/lib/client-error';
import { toUserFacingError } from '@/lib/user-facing-error';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import {
  Building2,
  Briefcase,
  AlertTriangle,
  Trash2,
  User,
  UserX,
  UserCheck,
  MoreHorizontal,
  Users,
  UserPlus,
  Shield,
  Key,
  Link as LinkIcon,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserDependencyReport } from '@/lib/users/dependencies';

type Team = {
  id: string;
  name: string;
};

type UserCardProps = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    avatarUrl?: string | null;
    gender?: string | null;
    jobTitle?: string | null;
    department?: string | null;
    createdAt?: Date | string;
    /** Who decides this person's role: an administrator (MANUAL) or the identity provider. */
    roleSource?: string | null;
    teamMemberships?: Array<{
      id: string;
      role: string;
      teamId: string;
      team: { name: string };
    }>;
  };
  selected: boolean;
  onSelect: () => void;
  isCurrentUser: boolean;
  isAdmin: boolean;
  teams: Team[];
  onActivate?: () => void;
  onDeactivate?: () => void;
  onDelete?: () => void;
  onGetDependencies?: () => Promise<{ report?: UserDependencyReport; error?: string }>;
  onGenerateInvite?: () => void;
  onUpdateRole?: (role: string) => void;
  onAddToTeam?: (teamId: string) => void;
  /** False when the workspace requires SSO, so password resets cannot be used. */
  passwordResetAvailable?: boolean;
};

const NEUTRAL_PILL = 'bg-muted/60 text-muted-foreground border-border/70';

const getRoleStyle = (role: string) => {
  switch (role) {
    case 'ADMIN':
      return {
        badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
        label: 'Admin',
      };
    case 'RESPONDER':
      return { badge: NEUTRAL_PILL, label: 'Responder' };
    case 'AUDITOR':
      return { badge: NEUTRAL_PILL, label: 'Auditor' };
    default:
      return { badge: NEUTRAL_PILL, label: 'User' };
  }
};

const getStatusStyle = (status: string) => {
  switch (status) {
    case 'ACTIVE':
      return {
        badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
        dot: 'bg-emerald-500',
      };
    case 'INVITED':
      return {
        badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
        dot: 'bg-amber-500',
      };
    default:
      return {
        badge: 'bg-muted text-foreground border-border',
        dot: 'bg-muted-foreground',
      };
  }
};

export type DirectoryUser = UserCardProps['user'];
type UserActionsMenuProps = Omit<UserCardProps, 'selected' | 'onSelect'>;

/** The row/card kebab menu plus the dialogs it opens. Admin-only and never on your own row. */
export function UserActionsMenu({
  user,
  isCurrentUser,
  isAdmin,
  teams,
  onActivate,
  onDeactivate,
  onDelete,
  onGetDependencies,
  onUpdateRole,
  onAddToTeam,
  passwordResetAvailable = true,
}: UserActionsMenuProps) {
  const router = useRouter();
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [dependencyReport, setDependencyReport] = useState<UserDependencyReport | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [loadingDependencies, setLoadingDependencies] = useState(false);

  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const handleGenerateLink = async () => {
    setIsLoadingLink(true);
    setLinkError(null);
    setInviteLink(null);
    setShowInviteDialog(true);

    try {
      const res = await fetch('/api/admin/generate-reset-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!res.ok) {
        const friendly = toUserFacingError(await errorFromResponse(res, 'Failed to generate link'));
        setLinkError(friendly.description || friendly.title);
        return;
      }

      const data = await res.json();
      if (data.link) {
        setInviteLink(data.link);
      } else {
        setLinkError('Failed to generate link');
      }
    } catch (err) {
      const friendly = toUserFacingError(err, 'Failed to generate link');
      setLinkError(friendly.description || friendly.title);
    } finally {
      setIsLoadingLink(false);
    }
  };

  const copyLinkToClipboard = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const handleDeactivate = () => {
    setShowDeactivateDialog(false);
    onDeactivate?.();
  };

  const handleDelete = () => {
    setShowDeleteDialog(false);
    onDelete?.();
  };

  const inspectDependencies = async () => {
    setShowDeleteDialog(true);
    setLoadingDependencies(true);
    setDependencyError(null);
    const result = await onGetDependencies?.();
    setDependencyReport(result?.report ?? null);
    setDependencyError(result?.error ?? null);
    setLoadingDependencies(false);
  };

  const availableTeams = teams.filter(
    team => !user.teamMemberships?.some(m => m.teamId === team.id)
  );

  if (isCurrentUser || !isAdmin) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Open user actions for {user.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>User Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => router.push(`/users/${user.id}`)}>
            <User /> View Full Profile
          </DropdownMenuItem>

          {!isCurrentUser && isAdmin && onUpdateRole && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Shield />
                <span>Change Role</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Select Role</DropdownMenuLabel>
                {[
                  { role: 'ADMIN', label: 'Admin' },
                  { role: 'RESPONDER', label: 'Responder' },
                  { role: 'AUDITOR', label: 'Auditor' },
                  { role: 'USER', label: 'User' },
                ].map(r => (
                  <DropdownMenuItem
                    key={r.role}
                    onClick={() => onUpdateRole(r.role)}
                    disabled={user.role === r.role}
                    className="justify-between"
                  >
                    <span>{r.label}</span>
                    {user.role === r.role && <Check aria-label="Current role" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />

          {(user.status === 'INVITED' || (user.status === 'ACTIVE' && passwordResetAvailable)) && (
            <DropdownMenuItem onClick={handleGenerateLink}>
              {user.status === 'INVITED' ? <LinkIcon /> : <Key />}
              <span>{user.status === 'INVITED' ? 'Get Invite Link' : 'Reset Password'}</span>
            </DropdownMenuItem>
          )}

          {(user.status === 'ACTIVE' || user.status === 'INVITED') && (
            <OidcLinkingApprovalButton userId={user.id} userName={user.name} />
          )}

          {onAddToTeam && availableTeams.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Users />
                <span>Add to Team</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                {availableTeams.map(team => (
                  <DropdownMenuItem key={team.id} onClick={() => onAddToTeam(team.id)}>
                    <span className="truncate">{team.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {user.status === 'DISABLED' && onActivate && (
            <DropdownMenuItem onClick={onActivate}>
              <UserCheck />
              <span>Activate User</span>
            </DropdownMenuItem>
          )}

          {user.status === 'ACTIVE' && onDeactivate && (
            <DropdownMenuItem variant="destructive" onClick={() => setShowDeactivateDialog(true)}>
              <UserX />
              <span>Deactivate User</span>
            </DropdownMenuItem>
          )}

          {onDelete && (user.status === 'DISABLED' || user.status === 'INVITED') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void inspectDependencies()}>
                <Trash2 />
                <span>{user.status === 'INVITED' ? 'Delete Invitation' : 'Delete User'}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Deactivate User
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate <strong>{user.name}</strong>? They will lose
              access to the system but their data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" />
              {user.status === 'INVITED' ? 'Delete Invited User' : 'Delete User Permanently'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {user.status === 'INVITED' ? (
                <>
                  <span className="text-red-600 font-semibold">This action cannot be undone.</span>
                  <br />
                  <br />
                  Permanently deletes the invitation for <strong>{user.name}</strong> ({user.email}
                  ). Any invitation links already sent will be immediately invalidated, and this
                  pending account will be removed.
                </>
              ) : (
                <>
                  <span className="text-red-600 font-semibold">This action cannot be undone.</span>
                  <br />
                  <br />
                  Permanently removes <strong>{user.name}</strong>&apos;s account and personal
                  credentials. Historical incident, notification, note, and audit records retained
                  for operational evidence will remain. Active assignments and owned resources must
                  be transferred first.
                </>
              )}
            </AlertDialogDescription>
            {loadingDependencies && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Inspecting dependencies…
              </div>
            )}
            {dependencyError && <p className="text-sm text-red-600">{dependencyError}</p>}
            {dependencyReport &&
              Object.entries(dependencyReport).some(([, entries]) => entries.length > 0) && (
                <div className="max-h-56 overflow-auto rounded border p-3 text-sm space-y-2">
                  <p className="font-semibold">Resolve these dependencies before deletion:</p>
                  {dependencyReport.teams.map(item => (
                    <Link
                      key={item.membershipId}
                      href={`/teams/${item.teamId}`}
                      className="block text-primary hover:underline"
                    >
                      Team: {item.teamName} ({item.role})
                    </Link>
                  ))}
                  {dependencyReport.teamsLed.map(item => (
                    <Link
                      key={item.teamId}
                      href={`/teams/${item.teamId}`}
                      className="block text-primary hover:underline"
                    >
                      Team lead: {item.teamName}
                    </Link>
                  ))}
                  {dependencyReport.escalationPolicies.map(item => (
                    <Link
                      key={item.stepId}
                      href={`/policies/${item.policyId}`}
                      className="block text-primary hover:underline"
                    >
                      Escalation: {item.policyName} → Step {item.stepOrder + 1}
                    </Link>
                  ))}
                  {dependencyReport.scheduleLayers.map(item => (
                    <Link
                      key={item.assignmentId}
                      href={`/schedules/${item.scheduleId}`}
                      className="block text-primary hover:underline"
                    >
                      Schedule: {item.scheduleName} → {item.layerName}
                    </Link>
                  ))}
                  {dependencyReport.incidents.map(item => (
                    <Link
                      key={item.incidentId}
                      href={`/incidents/${item.incidentId}`}
                      className="block text-primary hover:underline"
                    >
                      Incident: {item.title} ({item.serviceName})
                    </Link>
                  ))}
                  {dependencyReport.actionItems.map(item => (
                    <Link
                      key={item.actionItemId}
                      href={`/incidents/${item.incidentId}`}
                      className="block text-primary hover:underline"
                    >
                      Action item: {item.title}
                    </Link>
                  ))}
                  {dependencyReport.dashboards.map(item => (
                    <Link
                      key={item.dashboardId}
                      href={`/reports/executive/${item.dashboardId}`}
                      className="block text-primary hover:underline"
                    >
                      Dashboard: {item.name} ({item.visibility})
                    </Link>
                  ))}
                  {dependencyReport.overrides.map(item => (
                    <p key={item.overrideId}>
                      Override: {item.scheduleName} ({item.relation})
                    </p>
                  ))}
                  {dependencyReport.shifts.map(item => (
                    <p key={item.shiftId}>Shift: {item.scheduleName}</p>
                  ))}
                </div>
              )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={
                !['DISABLED', 'INVITED'].includes(user.status) ||
                loadingDependencies ||
                Boolean(dependencyError) ||
                Boolean(
                  dependencyReport &&
                  Object.values(dependencyReport).some(entries => entries.length > 0)
                )
              }
              className="bg-red-600 hover:bg-red-700"
            >
              {user.status === 'INVITED' ? 'Delete Invitation' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {user.status === 'INVITED' ? (
                <LinkIcon className="h-5 w-5 text-blue-600" />
              ) : (
                <Key className="h-5 w-5 text-emerald-600" />
              )}
              {user.status === 'INVITED' ? 'Get Invite Link' : 'Reset Password'}
            </DialogTitle>
            <DialogDescription>
              {user.status === 'INVITED' ? (
                <>
                  Generating an invitation link for <strong>{user.name}</strong>.
                </>
              ) : (
                <>
                  Generating a secure password reset link for <strong>{user.name}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {isLoadingLink && (
              <div role="status" aria-busy="true">
                <span className="sr-only">Generating link</span>
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            )}

            {linkError && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {linkError}
              </div>
            )}

            {inviteLink && (
              <div className="space-y-2">
                <div className="p-3 bg-muted rounded-md border text-sm break-all font-mono">
                  {inviteLink}
                </div>
                <Button
                  onClick={copyLinkToClipboard}
                  className="w-full gap-2"
                  variant={linkCopied ? 'outline' : 'default'}
                >
                  {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {linkCopied ? 'Copied!' : 'Copy Link'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserRoleBadge({ user }: { user: DirectoryUser }) {
  const roleStyle = getRoleStyle(user.role);
  const roleFromSso = user.roleSource === 'OIDC' || user.roleSource === 'SCIM';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 py-0.5 rounded-md text-[11px] font-medium border',
        roleStyle.badge
      )}
      title={
        roleFromSso
          ? 'Set by role rules from your identity provider at each sign-in.'
          : 'Set by an administrator. Single sign-on never changes it.'
      }
    >
      {roleStyle.label}
      {roleFromSso && <span className="opacity-70">· SSO</span>}
    </span>
  );
}

/** Active stays quiet (dot + muted label); every other state is a tinted pill. `dotOnly` keeps the label for screen readers. */
export function UserStatus({ status, dotOnly = false }: { status: string; dotOnly?: boolean }) {
  const style = getStatusStyle(status);
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  const dot = (
    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
  );
  if (dotOnly) {
    return (
      <span className="inline-flex items-center" title={label}>
        {dot}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return status === 'ACTIVE' ? (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {dot}
      {label}
    </span>
  ) : (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        style.badge
      )}
    >
      {dot}
      {label}
    </span>
  );
}

export function UserYouBadge() {
  return (
    <span className="shrink-0 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
      You
    </span>
  );
}

const REVEAL_ON_HOVER =
  'opacity-0 transition-opacity focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100 [tr:hover_&]:opacity-100 [li:hover_&]:opacity-100';

/** Email with a copy button; `showMeta` appends job title / department on wide screens (always in the tooltip). */
export function UserEmail({ user, showMeta = false }: { user: DirectoryUser; showMeta?: boolean }) {
  const [copied, setCopied] = useState(false);
  const meta = [user.jobTitle, user.department].filter(Boolean).join(' · ');
  const copy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user.email) return;
    void navigator.clipboard.writeText(user.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <span className="flex min-w-0 items-center gap-1" title={meta || undefined}>
      <span className="truncate">{user.email}</span>
      {showMeta && meta && (
        <span className="hidden min-w-0 shrink-[4] truncate text-muted-foreground/80 xl:inline">
          · {meta}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy email address for ${user.name}`}
        title="Copy email address"
        className={cn(
          'shrink-0 cursor-pointer rounded p-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          REVEAL_ON_HOVER
        )}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

/** Up to two team chips then "+N" (full list in its tooltip); admins get an add-to-team picker. */
export function UserTeams({
  user,
  isAdmin,
  teams,
  onAddToTeam,
}: {
  user: DirectoryUser;
  isAdmin: boolean;
  teams: Team[];
  onAddToTeam?: (teamId: string) => void;
}) {
  const memberships = user.teamMemberships ?? [];
  const availableTeams = teams.filter(team => !memberships.some(m => m.teamId === team.id));
  const picker = (label?: string) =>
    isAdmin &&
    onAddToTeam &&
    availableTeams.length > 0 && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label ? undefined : `Add ${user.name} to another team`}
            title={label ? 'Assign a team' : 'Add to another team'}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !label && REVEAL_ON_HOVER
            )}
          >
            <UserPlus className="h-3 w-3" aria-hidden="true" />
            {label && <span>{label}</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-56 overflow-y-auto">
          {availableTeams.map(team => (
            <DropdownMenuItem key={team.id} onClick={() => onAddToTeam(team.id)}>
              {team.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  if (memberships.length === 0) {
    return (
      picker('Assign team') || (
        <span className="text-xs text-muted-foreground/60">No team memberships</span>
      )
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      {memberships.slice(0, 2).map(member => (
        <span
          key={member.id}
          className="inline-flex min-w-0 max-w-[120px] items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          title={`${member.team.name} (${member.role})`}
        >
          <Users className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden="true" />
          <span className="truncate">{member.team.name}</span>
        </span>
      ))}
      {memberships.length > 2 && (
        <span
          className="inline-flex shrink-0 items-center rounded-md px-1 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
          title={memberships
            .slice(2)
            .map(m => `${m.team.name} (${m.role})`)
            .join(', ')}
        >
          +{memberships.length - 2}
        </span>
      )}
      {picker()}
    </div>
  );
}

/** Card view: identity, role, non-active status and the menu on top; job/department and teams below. */
export function UserCard({ selected, onSelect, ...props }: UserCardProps) {
  const { user, isCurrentUser, isAdmin } = props;
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2.5 rounded-lg border bg-card p-3 text-card-foreground transition-colors',
        selected
          ? 'border-primary bg-primary/[0.03] ring-1 ring-primary/30'
          : 'border-border/70 hover:border-border hover:bg-muted/30'
      )}
    >
      <div className="flex items-start gap-2.5">
        {isAdmin && !isCurrentUser && (
          <div className="flex h-8 items-center">
            <Checkbox
              checked={selected}
              onCheckedChange={onSelect}
              aria-label={`Select ${user.name}`}
            />
          </div>
        )}
        <Link href={`/users/${user.id}`} tabIndex={-1} aria-hidden="true" className="shrink-0">
          <UserAvatar
            userId={user.id}
            avatarUrl={user.avatarUrl}
            name={user.name}
            gender={user.gender}
            size="sm"
            className="rounded-full ring-1 ring-border/80"
            aria-hidden
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`/users/${user.id}`}
              className="truncate rounded-sm text-sm font-medium text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {user.name}
            </Link>
            {isCurrentUser && <UserYouBadge />}
          </div>
          <div className="text-xs text-muted-foreground">
            <UserEmail user={user} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <UserRoleBadge user={user} />
          {user.status !== 'ACTIVE' && <UserStatus status={user.status} />}
          <UserActionsMenu {...props} />
        </div>
      </div>

      <div className="flex min-h-6 min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
        {user.jobTitle && (
          <span
            className="inline-flex max-w-[130px] shrink-0 items-center gap-1 truncate"
            title="Job title"
          >
            <Briefcase className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            <span className="truncate">{user.jobTitle}</span>
          </span>
        )}
        {user.department && (
          <span
            className="inline-flex max-w-[130px] shrink-0 items-center gap-1 truncate"
            title="Department"
          >
            <Building2 className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            <span className="truncate">{user.department}</span>
          </span>
        )}
        {(user.jobTitle || user.department) && (
          <span className="text-muted-foreground/40" aria-hidden="true">
            ·
          </span>
        )}
        <UserTeams
          user={user}
          isAdmin={isAdmin}
          teams={props.teams}
          onAddToTeam={props.onAddToTeam}
        />
      </div>
    </div>
  );
}
