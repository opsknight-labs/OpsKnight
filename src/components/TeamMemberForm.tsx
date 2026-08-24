'use client';

import { useTransition, useState } from 'react';
import { useToast } from '@/hooks/use-product-notification';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { AlertTriangle, Loader2, UserPlus } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';

type User = {
  id: string;
  name: string;
  email: string;
  status?: string;
  avatarUrl?: string | null;
  gender?: string | null;
};

type TeamMemberFormProps = {
  availableUsers: User[];
  canManageMembers: boolean;
  canAssignOwnerAdmin: boolean;
  addMember: (formData: FormData) => Promise<{ error?: string } | undefined>;
  teamId: string;
};

export default function TeamMemberForm({
  availableUsers,
  canManageMembers,
  canAssignOwnerAdmin,
  addMember,
  teamId: _teamId,
}: TeamMemberFormProps) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('MEMBER');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUserId) return;

    const formData = new FormData();
    formData.set('userId', selectedUserId);
    formData.set('role', selectedRole);
    const userName = availableUsers.find(u => u.id === selectedUserId)?.name || 'User';

    startTransition(async () => {
      const result = await addMember(formData);
      if (result?.error) {
        showToast(result.error, 'error');
      } else {
        showToast(`${userName} added as ${selectedRole}`, 'success');
        setSelectedUserId('');
        setSelectedRole('MEMBER');
      }
    });
  };

  if (!canManageMembers) {
    return (
      <Card className="border-orange-200 bg-orange-50/50">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center gap-2 text-orange-900 mb-3">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-medium">No permission to add members</p>
          </div>
          <p className="text-xs text-orange-700">Admin or Responder role required.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="userId" className="text-xs">
          Select User
        </Label>
        <Select
          value={selectedUserId}
          onValueChange={setSelectedUserId}
          disabled={isPending || availableUsers.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                availableUsers.length === 0 ? 'All users are members' : 'Choose a user...'
              }
            />
          </SelectTrigger>
          <SelectContent className="max-h-[200px]">
            {availableUsers.map(user => (
              <SelectItem key={user.id} value={user.id}>
                <div className="flex items-center gap-2">
                  <UserAvatar userId={user.id} name={user.name} gender={user.gender} size="xs" />
                  <span className="truncate">{user.name}</span>
                  {user.status === 'DISABLED' && (
                    <Badge variant="secondary" size="xs">
                      Disabled
                    </Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="role" className="text-xs">
          Role
        </Label>
        <Select value={selectedRole} onValueChange={setSelectedRole} disabled={isPending}>
          <SelectTrigger
            title={
              !canAssignOwnerAdmin
                ? 'Admin or Team Owner access required to assign OWNER or ADMIN roles'
                : undefined
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OWNER" disabled={!canAssignOwnerAdmin}>
              Owner{!canAssignOwnerAdmin ? ' (Admin/Owner only)' : ''}
            </SelectItem>
            <SelectItem value="ADMIN" disabled={!canAssignOwnerAdmin}>
              Admin{!canAssignOwnerAdmin ? ' (Admin/Owner only)' : ''}
            </SelectItem>
            <SelectItem value="MEMBER">Member</SelectItem>
          </SelectContent>
        </Select>
        {!canAssignOwnerAdmin && (
          <p className="text-xs text-orange-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Admin or Team Owner access required for elevated roles
          </p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full gap-2"
        disabled={availableUsers.length === 0 || !selectedUserId || isPending}
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4" />
            Add to Team
          </>
        )}
      </Button>
    </form>
  );
}
