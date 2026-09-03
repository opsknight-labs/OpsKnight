'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  UserPlus,
  Shield,
  Key,
  Link as LinkIcon,
  Copy,
  Check,
  Loader2,
  ExternalLink,
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
  viewMode?: 'grid' | 'list';
  onActivate?: () => void;
  onDeactivate?: () => void;
  onDelete?: () => void;
  onGetDependencies?: () => Promise<{ report?: UserDependencyReport; error?: string }>;
  onGenerateInvite?: () => void;
  onUpdateRole?: (role: string) => void;
  onAddToTeam?: (teamId: string) => void;
};

const getRoleStyle = (role: string) => {
  switch (role) {
    case 'ADMIN':
      return {
        badge:
          'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
        dot: 'bg-rose-500',
        label: 'Admin',
        topBar: 'bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500',
        glow: 'bg-rose-500/15',
        borderHover: 'hover:border-rose-300/80 dark:hover:border-rose-700/60',
        bar: 'bg-rose-500',
      };
    case 'RESPONDER':
      return {
        badge:
          'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60',
        dot: 'bg-indigo-500',
        label: 'Responder',
        topBar: 'bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-500',
        glow: 'bg-indigo-500/15',
        borderHover: 'hover:border-indigo-300/80 dark:hover:border-indigo-700/60',
        bar: 'bg-indigo-500',
      };
    case 'AUDITOR':
      return {
        badge:
          'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/60',
        dot: 'bg-violet-500',
        label: 'Auditor',
        topBar: 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-purple-500',
        glow: 'bg-violet-500/15',
        borderHover: 'hover:border-violet-300/80 dark:hover:border-violet-700/60',
        bar: 'bg-violet-500',
      };
    default:
      return {
        badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/60',
        dot: 'bg-sky-500',
        label: 'User',
        topBar: 'bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500',
        glow: 'bg-sky-500/15',
        borderHover: 'hover:border-sky-300/80 dark:hover:border-sky-700/60',
        bar: 'bg-sky-500',
      };
  }
};

const getStatusStyle = (status: string) => {
  switch (status) {
    case 'ACTIVE':
      return {
        badge:
          'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
        dot: 'bg-emerald-500',
      };
    case 'INVITED':
      return {
        badge:
          'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
        dot: 'bg-amber-500',
      };
    default:
      return {
        badge: 'bg-muted text-muted-foreground border-border/70',
        dot: 'bg-slate-400',
      };
  }
};

export function UserCard({
  user,
  selected,
  onSelect,
  isCurrentUser,
  isAdmin,
  teams,
  viewMode = 'grid',
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
  const [emailCopied, setEmailCopied] = useState(false);

  const handleCopyEmail = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (user.email) {
      void navigator.clipboard.writeText(user.email);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  };

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

  const roleStyle = getRoleStyle(user.role);
  const statusStyle = getStatusStyle(user.status);

  const renderActionsMenu = () => {
    if (isCurrentUser || !isAdmin) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open user actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-1.5 rounded-xl border shadow-xl">
          <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground font-semibold">
            User Actions
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1" />

          <DropdownMenuItem
            onClick={() => router.push(`/users/${user.id}`)}
            className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium text-primary focus:bg-primary/10"
          >
            <User className="h-4 w-4 text-primary" /> View Full Profile
          </DropdownMenuItem>

          {!isCurrentUser && isAdmin && onUpdateRole && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span>Change Role</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="rounded-xl p-1 shadow-xl w-44">
                <DropdownMenuLabel className="px-2 py-1 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                  Select Role
                </DropdownMenuLabel>
                {[
                  { role: 'ADMIN', label: 'Admin', dot: 'bg-rose-500' },
                  { role: 'RESPONDER', label: 'Responder', dot: 'bg-indigo-500' },
                  { role: 'AUDITOR', label: 'Auditor', dot: 'bg-violet-500' },
                  { role: 'USER', label: 'User', dot: 'bg-sky-500' },
                ].map(r => (
                  <DropdownMenuItem
                    key={r.role}
                    onClick={() => onUpdateRole(r.role)}
                    disabled={user.role === r.role}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg text-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('h-1.5 w-1.5 rounded-full', r.dot)} />
                      <span
                        className={
                          user.role === r.role
                            ? 'font-semibold text-foreground'
                            : 'text-muted-foreground'
                        }
                      >
                        {r.label}
                      </span>
                    </div>
                    {user.role === r.role && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator className="my-1" />

          {(user.status === 'ACTIVE' || user.status === 'INVITED') && (
            <DropdownMenuItem
              onClick={handleGenerateLink}
              className={cn(
                'flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium',
                user.status === 'INVITED'
                  ? 'text-blue-600 focus:text-blue-700 focus:bg-blue-50 dark:focus:bg-blue-950/40'
                  : 'text-emerald-600 focus:text-emerald-700 focus:bg-emerald-50 dark:focus:bg-emerald-950/40'
              )}
            >
              {user.status === 'INVITED' ? (
                <LinkIcon className="h-4 w-4" />
              ) : (
                <Key className="h-4 w-4" />
              )}
              <span>{user.status === 'INVITED' ? 'Get Invite Link' : 'Reset Password'}</span>
            </DropdownMenuItem>
          )}

          {user.status === 'ACTIVE' && (
            <OidcLinkingApprovalButton userId={user.id} userName={user.name} />
          )}

          {onAddToTeam && availableTeams.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>Add to Team</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto rounded-xl p-1 shadow-xl">
                {availableTeams.map(team => (
                  <DropdownMenuItem
                    key={team.id}
                    onClick={() => onAddToTeam(team.id)}
                    className="py-1.5 px-2 rounded-lg text-xs cursor-pointer"
                  >
                    {team.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {user.status === 'DISABLED' && onActivate && (
            <DropdownMenuItem
              onClick={onActivate}
              className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium text-emerald-600 focus:text-emerald-700 focus:bg-emerald-50 dark:focus:bg-emerald-950/40"
            >
              <UserCheck className="h-4 w-4" />
              <span>Activate User</span>
            </DropdownMenuItem>
          )}

          {user.status === 'ACTIVE' && onDeactivate && (
            <DropdownMenuItem
              onClick={() => setShowDeactivateDialog(true)}
              className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium text-amber-600 focus:text-amber-700 focus:bg-amber-50 dark:focus:bg-amber-950/40"
            >
              <UserX className="h-4 w-4" />
              <span>Deactivate User</span>
            </DropdownMenuItem>
          )}

          {onDelete && user.status === 'DISABLED' && (
            <>
              <DropdownMenuSeparator className="my-1" />
              <DropdownMenuItem
                onClick={() => void inspectDependencies()}
                className="flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer text-xs font-medium text-rose-600 focus:text-rose-700 focus:bg-rose-50 dark:focus:bg-rose-950/40"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete User</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderRoleBadge = () => (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-2xs',
        roleStyle.badge
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', roleStyle.dot)} />
      {roleStyle.label}
    </span>
  );

  const renderStatusBadge = () => (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border shadow-2xs uppercase tracking-wider',
        statusStyle.badge
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusStyle.dot)} />
      {user.status}
    </span>
  );

  return (
    <>
      {viewMode === 'grid' ? (
        <div
          className={cn(
            'group relative flex flex-col justify-between h-[196px] rounded-2xl border transition-all duration-300 overflow-hidden',
            'bg-gradient-to-b from-card via-card to-card/90 dark:from-slate-900/90 dark:to-slate-950/90',
            'hover:shadow-xl hover:-translate-y-1',
            roleStyle.borderHover,
            selected
              ? 'border-primary bg-primary/5 ring-2 ring-primary/30 shadow-md'
              : 'border-border/80 hover:border-border'
          )}
        >
          {/* Ambient Top Role Glow Strip */}
          <div
            className={cn(
              'absolute top-0 left-0 right-0 h-1 opacity-85 group-hover:opacity-100 transition-opacity',
              roleStyle.topBar
            )}
          />
          {/* Soft corner radial aura */}
          <div
            className={cn(
              'absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl pointer-events-none opacity-25 group-hover:opacity-50 transition-opacity duration-500',
              roleStyle.glow
            )}
          />

          <div>
            {/* Card Top Toolbar */}
            <div className="flex items-center justify-between gap-2 p-4 pb-1 shrink-0">
              <div className="flex items-center gap-2">
                {isAdmin && !isCurrentUser && (
                  <input
                    type="checkbox"
                    name="userIds"
                    value={user.id}
                    form="bulk-users-form"
                    checked={selected}
                    onChange={onSelect}
                    aria-label={`Select ${user.name}`}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40 focus:ring-offset-0 cursor-pointer shrink-0 transition-all"
                  />
                )}
                {isCurrentUser && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs">
                    You
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {renderRoleBadge()}
                {renderStatusBadge()}
                {renderActionsMenu()}
              </div>
            </div>

            {/* User Identity */}
            <div className="px-4 py-1 flex items-start gap-3.5 shrink-0">
              <Link href={`/users/${user.id}`} className="shrink-0 group/avatar">
                <UserAvatar
                  userId={user.id}
                  avatarUrl={user.avatarUrl}
                  name={user.name}
                  gender={user.gender}
                  size="lg"
                  className="rounded-full ring-2 ring-border/70 group-hover/avatar:ring-primary/40 transition-all"
                />
              </Link>

              <div className="min-w-0 flex-1 space-y-0.5">
                <Link
                  href={`/users/${user.id}`}
                  className="font-bold text-base tracking-tight text-foreground hover:text-primary transition-colors truncate block"
                >
                  {user.name}
                </Link>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground group/email">
                  <Mail className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate">{user.email}</span>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="opacity-0 group-hover/email:opacity-100 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0"
                    title="Copy email address"
                  >
                    {emailCopied ? (
                      <Check className="h-2.5 w-2.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-2.5 w-2.5" />
                    )}
                  </button>
                </div>

                {/* Fixed-height metadata slot for title / department */}
                <div className="h-5 flex items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground font-medium overflow-hidden">
                  {user.jobTitle && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60 text-foreground/80 border border-border/40 truncate max-w-[130px]">
                      <Briefcase className="h-2.5 w-2.5 opacity-60 shrink-0" />
                      <span className="truncate">{user.jobTitle}</span>
                    </span>
                  )}
                  {user.department && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/60 text-foreground/80 border border-border/40 truncate max-w-[130px]">
                      <Building2 className="h-2.5 w-2.5 opacity-60 shrink-0" />
                      <span className="truncate">{user.department}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Teams section - fixed height */}
            <div className="h-8 flex items-center px-4 overflow-hidden shrink-0">
              {user.teamMemberships && user.teamMemberships.length > 0 ? (
                <div className="flex items-center gap-1 overflow-hidden">
                  {user.teamMemberships.slice(0, 2).map(member => (
                    <span
                      key={member.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 hover:bg-muted/80 transition-colors shrink-0"
                      title={`${member.team.name} (${member.role})`}
                    >
                      <Users className="h-2.5 w-2.5 opacity-60" />
                      <span className="truncate max-w-[110px]">{member.team.name}</span>
                    </span>
                  ))}
                  {user.teamMemberships.length > 2 && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border/40 shrink-0"
                      title={user.teamMemberships
                        .slice(2)
                        .map(m => m.team.name)
                        .join(', ')}
                    >
                      +{user.teamMemberships.length - 2}
                    </span>
                  )}
                  {isAdmin && onAddToTeam && availableTeams.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors cursor-pointer shrink-0"
                          title="Add to another team"
                        >
                          <UserPlus className="h-2.5 w-2.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="max-h-56 overflow-y-auto rounded-xl p-1 shadow-xl"
                      >
                        {availableTeams.map(team => (
                          <DropdownMenuItem
                            key={team.id}
                            onClick={() => onAddToTeam(team.id)}
                            className="py-1.5 px-2 rounded-lg text-xs cursor-pointer"
                          >
                            {team.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between w-full">
                  <span className="text-[11px] text-muted-foreground/50 italic select-none">
                    No team memberships
                  </span>
                  {isAdmin && onAddToTeam && availableTeams.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border border-dashed border-border/70 text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
                        >
                          <UserPlus className="h-2.5 w-2.5" />
                          <span>Assign team</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="max-h-56 overflow-y-auto rounded-xl p-1 shadow-xl"
                      >
                        {availableTeams.map(team => (
                          <DropdownMenuItem
                            key={team.id}
                            onClick={() => onAddToTeam(team.id)}
                            className="py-1.5 px-2 rounded-lg text-xs cursor-pointer"
                          >
                            {team.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Card Footer: Quick Actions - fixed height */}
          <div className="h-10 flex items-center justify-between px-4 border-t border-border/60 bg-muted/20 text-xs shrink-0">
            <Link
              href={`/users/${user.id}`}
              className="font-medium text-xs text-primary hover:underline flex items-center gap-1 group/link"
            >
              <span>View Profile</span>
              <ExternalLink className="h-3 w-3 transition-transform group-hover/link:translate-x-0.5" />
            </Link>

            {isAdmin &&
              !isCurrentUser &&
              (user.status === 'ACTIVE' || user.status === 'INVITED') && (
                <button
                  type="button"
                  onClick={handleGenerateLink}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {user.status === 'INVITED' ? (
                    <>
                      <LinkIcon className="h-3 w-3 text-blue-500" />
                      <span>Invite Link</span>
                    </>
                  ) : (
                    <>
                      <Key className="h-3 w-3 text-emerald-500" />
                      <span>Reset Key</span>
                    </>
                  )}
                </button>
              )}
          </div>
        </div>
      ) : (
        /* List Mode View */
        <div
          className={cn(
            'group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 p-4 rounded-xl border transition-all duration-200 overflow-hidden',
            'bg-gradient-to-r from-card via-card to-card/95 dark:from-slate-900/90 dark:to-slate-950/90',
            'hover:shadow-md hover:border-border',
            roleStyle.borderHover,
            selected
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30 shadow-xs'
              : 'border-border/70'
          )}
        >
          {/* Subtle role accent indicator on card edge */}
          <div
            className={cn(
              'absolute left-0 top-2 bottom-2 w-1 rounded-r-full transition-all duration-200',
              roleStyle.bar,
              selected
                ? 'opacity-100 w-1.5'
                : 'opacity-70 group-hover:opacity-100 group-hover:w-1.5'
            )}
          />
          {/* Soft background glow */}
          <div
            className={cn(
              'absolute top-0 right-0 w-32 h-full blur-2xl pointer-events-none opacity-10 group-hover:opacity-20 transition-opacity',
              roleStyle.glow
            )}
          />

          <div className="flex items-center gap-3.5 min-w-0 flex-1 pl-1.5">
            {isAdmin && !isCurrentUser && (
              <input
                type="checkbox"
                name="userIds"
                value={user.id}
                form="bulk-users-form"
                checked={selected}
                onChange={onSelect}
                aria-label={`Select ${user.name}`}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40 focus:ring-offset-0 cursor-pointer shrink-0 transition-colors"
              />
            )}

            <Link href={`/users/${user.id}`} className="shrink-0 group/avatar">
              <UserAvatar
                userId={user.id}
                avatarUrl={user.avatarUrl}
                name={user.name}
                gender={user.gender}
                size="md"
                className="rounded-full ring-2 ring-border/70 group-hover/avatar:ring-primary/40 transition-all"
              />
            </Link>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/users/${user.id}`}
                  className="font-semibold text-sm truncate text-foreground hover:text-primary transition-colors"
                >
                  {user.name}
                </Link>
                {isCurrentUser && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-xs shrink-0">
                    You
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground group/email">
                <span className="flex items-center gap-1.5 truncate">
                  <Mail className="h-3 w-3 shrink-0 opacity-70" />
                  <span className="truncate">{user.email}</span>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="opacity-0 group-hover/email:opacity-100 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0"
                    title="Copy email address"
                  >
                    {emailCopied ? (
                      <Check className="h-2.5 w-2.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-2.5 w-2.5" />
                    )}
                  </button>
                </span>

                {(user.jobTitle || user.department) && (
                  <span className="hidden md:inline-flex items-center gap-1.5 text-muted-foreground/80 truncate">
                    <span className="text-muted-foreground/40">•</span>
                    {user.jobTitle && (
                      <span className="flex items-center gap-1 truncate">
                        <Briefcase className="h-3 w-3 shrink-0 opacity-70" />
                        <span className="truncate">{user.jobTitle}</span>
                      </span>
                    )}
                    {user.jobTitle && user.department && (
                      <span className="text-muted-foreground/40">/</span>
                    )}
                    {user.department && (
                      <span className="flex items-center gap-1 truncate">
                        <Building2 className="h-3 w-3 shrink-0 opacity-70" />
                        <span className="truncate">{user.department}</span>
                      </span>
                    )}
                  </span>
                )}
              </div>

              {user.teamMemberships && user.teamMemberships.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  {user.teamMemberships.map(member => (
                    <span
                      key={member.id}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-muted/60 text-muted-foreground border border-border/50 hover:bg-muted transition-colors"
                      title={`${member.team.name} (${member.role})`}
                    >
                      <Users className="h-2.5 w-2.5 opacity-60" />
                      <span className="truncate max-w-[120px]">{member.team.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                isAdmin &&
                onAddToTeam &&
                availableTeams.length > 0 && (
                  <div className="pt-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border border-dashed border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        >
                          <UserPlus className="h-2.5 w-2.5" />
                          <span>Assign team</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="max-h-56 overflow-y-auto rounded-xl p-1 shadow-xl"
                      >
                        {availableTeams.map(team => (
                          <DropdownMenuItem
                            key={team.id}
                            onClick={() => onAddToTeam(team.id)}
                            className="py-1.5 px-2 rounded-lg text-xs cursor-pointer"
                          >
                            {team.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Right Section: Role + Status + Actions Menu */}
          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40 pl-8 sm:pl-0">
            <div className="flex items-center gap-2">
              {renderRoleBadge()}
              {renderStatusBadge()}
            </div>
            {renderActionsMenu()}
          </div>
        </div>
      )}

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
                user.status !== 'DISABLED' ||
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
