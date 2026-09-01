'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/shadcn/badge';
import UserAvatar from '@/components/UserAvatar';
import OidcLinkingApprovalButton from './OidcLinkingApprovalButton';
import { Button } from '@/components/ui/shadcn/button';
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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/shadcn/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import {
  Mail,
  Building2,
  Briefcase,
  AlertTriangle,
  Trash2,
  User,
  UserX,
  UserCheck,
  MoreHorizontal,
  Users,
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
};

const roleAccentColors = {
  ADMIN: 'border-l-rose-500',
  RESPONDER: 'border-l-indigo-500',
  AUDITOR: 'border-l-violet-500',
  USER: 'border-l-sky-500',
};

export function UserCard({
  user,
  selected,
  onSelect,
  isCurrentUser,
  isAdmin,
  teams,
  onActivate,
  onDeactivate,
  onDelete,
  onGetDependencies,
  onGenerateInvite: _onGenerateInvite,
  onUpdateRole,
  onAddToTeam,
}: UserCardProps) {
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

  const statusVariants = {
    ACTIVE: 'success',
    INVITED: 'warning',
    DISABLED: 'neutral',
  } as const;

  const roleVariants = {
    ADMIN: 'danger',
    RESPONDER: 'warning',
    AUDITOR: 'neutral',
    USER: 'info',
  } as const;

  const roleTriggerColors = {
    ADMIN: 'bg-red-100 text-red-800 border-red-200',
    RESPONDER: 'bg-amber-100 text-amber-800 border-amber-200',
    AUDITOR: 'bg-violet-100 text-violet-800 border-violet-200',
    USER: 'bg-blue-100 text-blue-800 border-blue-200',
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

  return (
    <>
      <div
        className={cn(
          'group relative flex items-center gap-4 p-4 rounded-lg border-2 border-l-4',
          'transition-all duration-300 ease-out',
          'hover:shadow-lg hover:-translate-y-0.5 hover:scale-[1.01]',
          roleAccentColors[user.role as keyof typeof roleAccentColors] || 'border-l-gray-400',
          selected
            ? 'border-primary bg-primary/5 shadow-md'
            : 'border-border bg-card hover:border-primary/30'
        )}
      >
        <input
          type="checkbox"
          name="userIds"
          value={user.id}
          form="bulk-users-form"
          checked={selected}
          onChange={onSelect}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
        />

        <Link href={`/users/${user.id}`} className="shrink-0">
          <UserAvatar
            userId={user.id}
            avatarUrl={user.avatarUrl}
            name={user.name}
            gender={user.gender}
            size="lg"
            className="ring-2 ring-background shadow-md transition-transform duration-300 group-hover:scale-105"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Link
              href={`/users/${user.id}`}
              className="font-semibold text-sm truncate text-foreground hover:text-primary transition-colors"
            >
              {user.name}
            </Link>
            {isCurrentUser && (
              <Badge variant="neutral" size="xs">
                You
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{user.email}</span>
          </div>

          {(user.jobTitle || user.department) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
              {user.jobTitle && (
                <div className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3 shrink-0" />
                  <span className="truncate">{user.jobTitle}</span>
                </div>
              )}
              {user.department && (
                <div className="flex items-center gap-1">
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{user.department}</span>
                </div>
              )}
            </div>
          )}

          {user.teamMemberships && user.teamMemberships.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {user.teamMemberships.map(member => (
                <Badge
                  key={member.id}
                  variant="neutral"
                  size="xs"
                  className="font-normal text-muted-foreground"
                  title={`${member.team.name} (${member.role})`}
                >
                  {member.team.name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {!isCurrentUser && isAdmin && onUpdateRole ? (
              <Select value={user.role} onValueChange={value => onUpdateRole(value)}>
                <SelectTrigger
                  className={cn(
                    'h-6 w-auto gap-1 text-[10px] font-semibold px-2 rounded-full border border-transparent focus:ring-0 focus:ring-offset-0',
                    roleTriggerColors[user.role as keyof typeof roleTriggerColors]
                  )}
                >
                  <span className="truncate">
                    {user.role === 'ADMIN'
                      ? 'Admin'
                      : user.role === 'RESPONDER'
                        ? 'Responder'
                        : user.role === 'AUDITOR'
                          ? 'Auditor'
                          : 'User'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN" className="text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                      <span>Admin</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="RESPONDER" className="text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      <span>Responder</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="AUDITOR" className="text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                      <span>Auditor</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="USER" className="text-xs">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                      <span>User</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant={roleVariants[user.role as keyof typeof roleVariants] ?? 'neutral'}
                size="xs"
                className="font-semibold uppercase"
              >
                {user.role}
              </Badge>
            )}

            <Badge
              variant={statusVariants[user.status as keyof typeof statusVariants] ?? 'neutral'}
              size="xs"
              className="font-semibold uppercase"
            >
              {user.status}
            </Badge>
          </div>

          {!isCurrentUser && isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => router.push(`/users/${user.id}`)}
                  className="flex items-center gap-2 cursor-pointer font-medium text-primary"
                >
                  <User className="h-4 w-4 text-primary" /> View Full Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                {(user.status === 'ACTIVE' || user.status === 'INVITED') && (
                  <DropdownMenuItem
                    onClick={handleGenerateLink}
                    className={cn(
                      user.status === 'INVITED'
                        ? 'text-blue-600 focus:text-blue-700'
                        : 'text-green-600 focus:text-green-700'
                    )}
                  >
                    {user.status === 'INVITED' ? (
                      <LinkIcon className="mr-2 h-4 w-4" />
                    ) : (
                      <Key className="mr-2 h-4 w-4" />
                    )}
                    <span>{user.status === 'INVITED' ? 'Get Invite Link' : 'Reset Password'}</span>
                  </DropdownMenuItem>
                )}

                {user.status === 'ACTIVE' && (
                  <OidcLinkingApprovalButton userId={user.id} userName={user.name} />
                )}

                {onAddToTeam && availableTeams.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Users className="mr-2 h-4 w-4" />
                      <span>Add to Team</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                      {availableTeams.map(team => (
                        <DropdownMenuItem key={team.id} onClick={() => onAddToTeam(team.id)}>
                          {team.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}

                {user.status === 'DISABLED' && onActivate && (
                  <DropdownMenuItem
                    onClick={onActivate}
                    className="text-green-600 focus:text-green-700"
                  >
                    <UserCheck className="mr-2 h-4 w-4" />
                    <span>Activate User</span>
                  </DropdownMenuItem>
                )}

                {user.status === 'ACTIVE' && onDeactivate && (
                  <DropdownMenuItem
                    onClick={() => setShowDeactivateDialog(true)}
                    className="text-orange-600 focus:text-orange-700"
                  >
                    <UserX className="mr-2 h-4 w-4" />
                    <span>Deactivate User</span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                {onDelete && (
                  <DropdownMenuItem
                    onClick={() => void inspectDependencies()}
                    className="text-red-600 focus:text-red-700 focus:bg-red-50"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>Delete User</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

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
              Delete User Permanently
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-red-600 font-semibold">This action cannot be undone.</span>
              <br />
              <br />
              Permanently removes <strong>{user.name}</strong>&apos;s account and personal
              credentials. Historical incident, notification, note, and audit records retained for
              operational evidence will remain. Active assignments and owned resources must be
              transferred first.
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
                loadingDependencies ||
                Boolean(dependencyError) ||
                Boolean(
                  dependencyReport &&
                  Object.values(dependencyReport).some(entries => entries.length > 0)
                )
              }
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Permanently
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
                <Key className="h-5 w-5 text-green-600" />
              )}
              {user.status === 'INVITED' ? 'Get Invite Link' : 'Reset Password'}
            </DialogTitle>
            <DialogDescription>
              Generating a secure link for <strong>{user.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {isLoadingLink && (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
