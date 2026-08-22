'use client';

import { useTransition, memo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from './ToastProvider';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import UserAvatar from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Switch } from '@/components/ui/shadcn/switch';
import { Label } from '@/components/ui/shadcn/label';
import { Mail, AlertCircle, Bell, BellOff, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

type TeamMember = {
  id: string;
  role: string;
  receiveTeamNotifications: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
    status?: string;
    emailNotificationsEnabled?: boolean;
    smsNotificationsEnabled?: boolean;
    pushNotificationsEnabled?: boolean;
    whatsappNotificationsEnabled?: boolean;
  };
};

type TeamMemberCardProps = {
  member: TeamMember;
  isSoleOwner: boolean;
  canManageMembers: boolean;
  canManageNotifications: boolean;
  canAssignOwnerAdmin: boolean;
  updateMemberRole: (formData: FormData) => Promise<{ error?: string } | undefined>;
  updateMemberNotifications: (
    receiveNotifications: boolean
  ) => Promise<{ error?: string } | undefined>;
  removeMember: () => Promise<{ error?: string } | undefined>;
};

function TeamMemberCard({
  member,
  isSoleOwner,
  canManageMembers,
  canManageNotifications,
  canAssignOwnerAdmin,
  updateMemberRole,
  updateMemberNotifications,
  removeMember,
}: TeamMemberCardProps) {
  const [isPending, startTransition] = useTransition();
  const [isRemoving, startRemoving] = useTransition();
  const [isNotifyPending, startNotifyTransition] = useTransition();
  const { showToast } = useToast();
  const [teamNotifyEnabled, setTeamNotifyEnabled] = useState(member.receiveTeamNotifications);

  const roleColors = {
    OWNER: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    ADMIN: 'bg-amber-100 text-amber-800 border-amber-200',
    MEMBER: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  };

  const roleVariants = {
    OWNER: 'info',
    ADMIN: 'warning',
    MEMBER: 'success',
  } as const;

  const roleColor = roleColors[member.role as keyof typeof roleColors] || roleColors.MEMBER;
  const canEditRole =
    canManageMembers &&
    !isSoleOwner &&
    (canAssignOwnerAdmin || (member.role !== 'OWNER' && member.role !== 'ADMIN'));
  const hasAnyNotificationEnabled = Boolean(
    member.user.emailNotificationsEnabled ||
    member.user.smsNotificationsEnabled ||
    member.user.pushNotificationsEnabled ||
    member.user.whatsappNotificationsEnabled
  );

  useEffect(() => {
    setTeamNotifyEnabled(member.receiveTeamNotifications); // eslint-disable-line react-hooks/set-state-in-effect
  }, [member.receiveTeamNotifications]);

  const handleRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value;
    const formData = new FormData();
    formData.set('role', newRole);
    startTransition(async () => {
      const result = await updateMemberRole(formData);
      if (result?.error) {
        showToast(result.error, 'error');
      } else {
        showToast(`Role updated to ${newRole}`, 'success');
      }
    });
  };

  const handleRemove = () => {
    if (isSoleOwner) return;
    startRemoving(async () => {
      const result = await removeMember();
      if (result?.error) {
        showToast(result.error, 'error');
      } else {
        showToast(`${member.user.name} removed from team`, 'success');
      }
    });
  };

  const handleNotificationToggle = (checked: boolean) => {
    setTeamNotifyEnabled(checked);
    startNotifyTransition(async () => {
      const result = await updateMemberNotifications(checked);
      if (result?.error) {
        setTeamNotifyEnabled(!checked);
        showToast(result.error, 'error');
      } else {
        showToast(
          checked ? 'Team notifications enabled' : 'Team notifications disabled',
          'success'
        );
      }
    });
  };

  return (
    <Card
      className={cn(
        'transition-all duration-200 hover:shadow-md',
        (isPending || isRemoving) && 'opacity-60 pointer-events-none'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <Link href={`/users?q=${encodeURIComponent(member.user.email)}`} className="shrink-0">
            <UserAvatar
              userId={member.user.id}
              name={member.user.name}
              gender={member.user.gender}
              avatarUrl={member.user.avatarUrl}
              size="lg"
              className="ring-2 ring-background shadow-md hover:scale-110 transition-transform cursor-pointer"
            />
          </Link>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/users?q=${encodeURIComponent(member.user.email)}`}
                className="font-semibold text-sm hover:text-primary transition-colors truncate"
              >
                {member.user.name}
              </Link>
              {member.user.status === 'DISABLED' && (
                <Badge variant="neutral" size="xs">
                  Disabled
                </Badge>
              )}
              {!hasAnyNotificationEnabled && (
                <Badge variant="warning" size="xs" className="gap-1">
                  <AlertCircle className="h-2.5 w-2.5" />
                  No notifications
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{member.user.email}</span>
            </div>
          </div>

          {/* Role and Actions */}
          <div className="flex items-center gap-3">
            {/* Team Notifications Toggle */}
            {canManageNotifications && (
              <div className="flex items-center gap-2">
                <Switch
                  id={`notify-${member.id}`}
                  checked={teamNotifyEnabled}
                  onCheckedChange={handleNotificationToggle}
                  disabled={!canManageNotifications || isNotifyPending}
                  className="data-[state=checked]:bg-blue-600"
                />
                <Label
                  htmlFor={`notify-${member.id}`}
                  className={cn(
                    'text-xs font-medium cursor-pointer flex items-center gap-1',
                    teamNotifyEnabled ? 'text-blue-700' : 'text-muted-foreground'
                  )}
                >
                  {teamNotifyEnabled ? (
                    <>
                      <Bell className="h-3 w-3" />
                      <span className="hidden md:inline">Notify</span>
                    </>
                  ) : (
                    <>
                      <BellOff className="h-3 w-3" />
                      <span className="hidden md:inline">Silent</span>
                    </>
                  )}
                </Label>
              </div>
            )}

            {/* Role Badge/Select */}
            <div className="flex flex-col items-end gap-1">
              {canEditRole ? (
                <select
                  name="role"
                  defaultValue={member.role}
                  onChange={handleRoleChange}
                  disabled={isPending || isNotifyPending}
                  className={cn(
                    'h-7 text-[10px] font-semibold px-2 rounded border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary',
                    roleColor,
                    (isPending || isNotifyPending) && 'opacity-60 cursor-wait'
                  )}
                >
                  <option value="OWNER">Owner</option>
                  <option value="ADMIN">Admin</option>
                  <option value="MEMBER">Member</option>
                </select>
              ) : (
                <Badge
                  variant={roleVariants[member.role as keyof typeof roleVariants] ?? 'neutral'}
                  size="xs"
                  className="font-semibold uppercase"
                >
                  {member.role}
                </Badge>
              )}
              {isSoleOwner && <span className="text-[9px] text-muted-foreground">Last owner</span>}
              {!canAssignOwnerAdmin &&
                (member.role === 'OWNER' || member.role === 'ADMIN') &&
                canManageMembers && (
                  <span className="text-[9px] text-orange-600">Admin required</span>
                )}
            </div>

            {/* Remove Button */}
            {canManageMembers && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                disabled={isSoleOwner || isRemoving}
                className={cn(
                  'h-8 w-8 p-0',
                  isSoleOwner
                    ? 'text-muted-foreground cursor-not-allowed opacity-50'
                    : 'text-muted-foreground hover:text-red-600 hover:bg-red-50'
                )}
                title={isSoleOwner ? 'Cannot remove last owner' : 'Remove member from team'}
              >
                {isRemoving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}

            {!canManageMembers && (
              <span className="text-[10px] text-muted-foreground italic opacity-60">No access</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Memoize TeamMemberCard to prevent unnecessary re-renders in team member lists
export default memo(TeamMemberCard, (prevProps, nextProps) => {
  return (
    prevProps.member.id === nextProps.member.id &&
    prevProps.member.role === nextProps.member.role &&
    prevProps.member.receiveTeamNotifications === nextProps.member.receiveTeamNotifications &&
    prevProps.member.user.id === nextProps.member.user.id &&
    prevProps.member.user.name === nextProps.member.user.name &&
    prevProps.member.user.email === nextProps.member.user.email &&
    prevProps.member.user.status === nextProps.member.user.status &&
    prevProps.member.user.emailNotificationsEnabled ===
      nextProps.member.user.emailNotificationsEnabled &&
    prevProps.member.user.smsNotificationsEnabled ===
      nextProps.member.user.smsNotificationsEnabled &&
    prevProps.member.user.pushNotificationsEnabled ===
      nextProps.member.user.pushNotificationsEnabled &&
    prevProps.member.user.whatsappNotificationsEnabled ===
      nextProps.member.user.whatsappNotificationsEnabled &&
    prevProps.isSoleOwner === nextProps.isSoleOwner &&
    prevProps.canManageMembers === nextProps.canManageMembers &&
    prevProps.canManageNotifications === nextProps.canManageNotifications &&
    prevProps.canAssignOwnerAdmin === nextProps.canAssignOwnerAdmin
  );
});
