'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { useToast } from '@/hooks/use-product-notification';
import { Search, Trash2, Bell, BellOff, Crown, Loader2, X, ChevronDown, Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

type TeamMember = {
  id: string;
  userId: string;
  role: string;
  receiveTeamNotifications: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    status?: string;
    avatarUrl?: string | null;
    gender?: string | null;
  };
};

type TeamMemberRosterTableProps = {
  members: TeamMember[];
  teamId: string;
  currentTeamLeadId?: string | null;
  ownerCount: number;
  canManageMembers: boolean;
  canManageNotifications: boolean;
  canAssignOwnerAdmin: boolean;
  updateMemberRole: (
    memberId: string,
    formData: FormData
  ) => Promise<{ error?: string } | undefined>;
  updateMemberNotifications: (
    memberId: string,
    receiveNotifications: boolean
  ) => Promise<{ error?: string } | undefined>;
  removeMember: (memberId: string) => Promise<{ error?: string } | undefined>;
  designateTeamLeadAction?: (
    teamId: string,
    userId: string | null
  ) => Promise<{ error?: string } | undefined>;
};

function getRoleBadge(role: string) {
  switch (role) {
    case 'OWNER':
      return (
        <Badge variant="info" size="xs" className="font-semibold text-[10px] px-1.5 py-0.2">
          Owner
        </Badge>
      );
    case 'ADMIN':
      return (
        <Badge variant="warning" size="xs" className="font-semibold text-[10px] px-1.5 py-0.2">
          Admin
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" size="xs" className="text-[10px] px-1.5 py-0.2">
          Member
        </Badge>
      );
  }
}

export default function TeamMemberRosterTable({
  members,
  teamId,
  currentTeamLeadId,
  ownerCount,
  canManageMembers,
  canManageNotifications,
  canAssignOwnerAdmin,
  updateMemberRole,
  updateMemberNotifications,
  removeMember,
  designateTeamLeadAction,
}: TeamMemberRosterTableProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase().trim();
    return members.filter(
      m =>
        m.user.name.toLowerCase().includes(query) ||
        m.user.email.toLowerCase().includes(query) ||
        m.role.toLowerCase().includes(query)
    );
  }, [members, searchQuery]);

  const handleRoleSelect = (memberId: string, role: string) => {
    const formData = new FormData();
    formData.set('role', role);
    setPendingMemberId(memberId);
    startTransition(async () => {
      try {
        const res = await updateMemberRole(memberId, formData);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast(`Role updated to ${role}`, 'success');
          router.refresh();
        }
      } catch {
        showToast('Failed to update role', 'error');
      } finally {
        setPendingMemberId(null);
      }
    });
  };

  const handleNotificationToggle = (memberId: string, enabled: boolean) => {
    setPendingMemberId(memberId);
    startTransition(async () => {
      try {
        const res = await updateMemberNotifications(memberId, enabled);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast(enabled ? 'Team notifications enabled' : 'Team notifications muted', 'success');
          router.refresh();
        }
      } catch {
        showToast('Failed to update notifications', 'error');
      } finally {
        setPendingMemberId(null);
      }
    });
  };

  const handleDesignateLead = (userId: string | null, userName?: string) => {
    if (!designateTeamLeadAction) return;
    setPendingMemberId(userId || 'lead');
    startTransition(async () => {
      try {
        const res = await designateTeamLeadAction(teamId, userId);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast(userId ? `${userName} is now the Team Lead` : 'Team Lead removed', 'success');
          router.refresh();
        }
      } catch {
        showToast('Failed to update team lead', 'error');
      } finally {
        setPendingMemberId(null);
      }
    });
  };

  const handleConfirmRemove = () => {
    if (!memberToRemove) return;
    const memberId = memberToRemove.id;
    setPendingMemberId(memberId);
    startTransition(async () => {
      try {
        const res = await removeMember(memberId);
        if (res?.error) {
          showToast(res.error, 'error');
        } else {
          showToast('Member removed from team', 'success');
          router.refresh();
        }
      } catch {
        showToast('Failed to remove member', 'error');
      } finally {
        setMemberToRemove(null);
        setPendingMemberId(null);
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* Search Bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter members by name, email, or role..."
          className="pl-8 pr-8 h-8.5 text-xs placeholder:text-muted-foreground/60"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Members List */}
      {filteredMembers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6 text-muted-foreground/60" />}
          title={searchQuery ? `No members match "${searchQuery}"` : 'No members on this team yet'}
          description={
            searchQuery
              ? 'Try adjusting your search query.'
              : 'Add members above to staff this team.'
          }
          size="sm"
        />
      ) : (
        <div className="divide-y divide-border/60 rounded-lg border border-border/70 bg-card overflow-hidden shadow-2xs">
          {filteredMembers.map(member => {
            const isSoleOwner = member.role === 'OWNER' && ownerCount === 1;
            const isLead = currentTeamLeadId === member.userId;
            const canEditRole =
              canManageMembers &&
              !isSoleOwner &&
              (canAssignOwnerAdmin || (member.role !== 'OWNER' && member.role !== 'ADMIN'));
            const isBusy =
              (pendingMemberId === member.id || pendingMemberId === member.userId) && isPending;

            return (
              <div
                key={member.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 transition-colors hover:bg-muted/20 text-xs"
              >
                {/* User info */}
                <div className="flex items-center gap-3 min-w-0">
                  <DirectUserAvatar
                    avatarUrl={
                      member.user.avatarUrl ||
                      getDefaultAvatar(member.user.gender, member.user.id || member.user.name)
                    }
                    name={member.user.name}
                    size="sm"
                    className="h-8 w-8 shrink-0 ring-1 ring-border/80"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground truncate">
                        {member.user.name}
                      </span>
                      {getRoleBadge(member.role)}
                      {isLead && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1 py-0.2 rounded ring-1 ring-inset ring-primary/20">
                          <Crown className="h-2.5 w-2.5" />
                          Lead
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {member.user.email}
                    </p>
                  </div>
                </div>

                {/* Actions & controls */}
                <div className="flex items-center gap-3.5 self-end sm:self-center">
                  {/* Notifications toggle */}
                  {canManageNotifications && (
                    <div
                      className="flex items-center gap-1.5"
                      title="Receive team incident notifications"
                    >
                      <Switch
                        checked={member.receiveTeamNotifications}
                        onCheckedChange={checked => handleNotificationToggle(member.id, checked)}
                        disabled={isBusy}
                        className="scale-75"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {member.receiveTeamNotifications ? (
                          <Bell className="h-3 w-3 text-primary inline" />
                        ) : (
                          <BellOff className="h-3 w-3 text-muted-foreground/60 inline" />
                        )}
                      </span>
                    </div>
                  )}

                  {/* Role picker dropdown */}
                  {canEditRole ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          className="h-7 text-xs font-medium gap-1 px-2 border-border/80"
                        >
                          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : member.role}
                          <ChevronDown className="h-3 w-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="text-xs w-36">
                        {canAssignOwnerAdmin && (
                          <DropdownMenuItem onClick={() => handleRoleSelect(member.id, 'OWNER')}>
                            Owner
                          </DropdownMenuItem>
                        )}
                        {canAssignOwnerAdmin && (
                          <DropdownMenuItem onClick={() => handleRoleSelect(member.id, 'ADMIN')}>
                            Admin
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleRoleSelect(member.id, 'MEMBER')}>
                          Member
                        </DropdownMenuItem>

                        {/* 1-Click Promote to Team Lead */}
                        {designateTeamLeadAction && canManageMembers && (
                          <>
                            <DropdownMenuSeparator />
                            {isLead ? (
                              <DropdownMenuItem
                                onClick={() => handleDesignateLead(null)}
                                className="text-amber-600 dark:text-amber-400 gap-1.5"
                              >
                                <Crown className="h-3 w-3" />
                                Remove as Lead
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => handleDesignateLead(member.userId, member.user.name)}
                                className="text-primary font-medium gap-1.5"
                              >
                                <Crown className="h-3 w-3 text-primary" />
                                Set as Team Lead
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{member.role}</span>
                  )}

                  {/* Remove action */}
                  {canManageMembers && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isSoleOwner || isBusy}
                      onClick={() => setMemberToRemove(member)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title={isSoleOwner ? 'Cannot remove the sole team owner' : 'Remove member'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Remove Confirmation Dialog */}
      <AlertDialog
        open={Boolean(memberToRemove)}
        onOpenChange={open => !open && setMemberToRemove(null)}
      >
        <AlertDialogContent className="text-xs sm:text-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" />
              Remove Team Member
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{memberToRemove?.user.name}</strong> from this
              team? They will no longer receive team-level escalation alerts or access team
              resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
