'use client';

import { useState, useCallback, useMemo } from 'react';
import { UserCard } from './UserCard';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import type { UserFormState } from '@/app/(app)/users/actions';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/shadcn/dropdown-menu';
import { ChevronDown, Trash2, UserX, UserCheck, MoreHorizontal } from 'lucide-react';
import { notify as toast } from '@/lib/toast';

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  gender?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  createdAt?: Date;
  teamMemberships?: Array<{
    id: string;
    role: string;
    teamId: string;
    team: { name: string };
  }>;
};

type Team = {
  id: string;
  name: string;
};

type UserListProps = {
  users: User[];
  currentUserId: string;
  isAdmin: boolean;
  teams: Team[];
  updateUserRole: (userId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  addUserToTeam: (userId: string, formData: FormData) => Promise<{ error?: string } | undefined>;
  deactivateUser: (userId: string, formData?: FormData) => Promise<{ error?: string } | undefined>;
  reactivateUser: (userId: string, formData?: FormData) => Promise<{ error?: string } | undefined>;
  deleteUser: (userId: string, formData?: FormData) => Promise<{ error?: string } | undefined>;
  generateInvite: (
    userId: string,
    prevState: UserFormState,
    formData: FormData
  ) => Promise<UserFormState>;
};

export default function UserList({
  users,
  currentUserId,
  isAdmin,
  teams,
  updateUserRole,
  addUserToTeam,
  deactivateUser,
  reactivateUser,
  deleteUser,
  generateInvite,
}: UserListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);

  const toggleUser = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === users.length) {
        return new Set();
      } else {
        return new Set(users.map(u => u.id));
      }
    });
  }, [users]);

  const allSelected = useMemo(
    () => users.length > 0 && selectedIds.size === users.length,
    [users.length, selectedIds.size]
  );

  const handleBulkAction = async (action: 'DEACTIVATE' | 'ACTIVATE' | 'DELETE') => {
    if (selectedIds.size === 0) return;
    setIsBulkActionPending(true);

    try {
      const promises = Array.from(selectedIds).map(async id => {
        if (action === 'DEACTIVATE') await deactivateUser(id);
        if (action === 'ACTIVATE') await reactivateUser(id);
        if (action === 'DELETE') await deleteUser(id);
      });

      await Promise.all(promises);
      toast.success(
        `${action === 'DELETE' ? 'Deleted' : action === 'ACTIVATE' ? 'Activated' : 'Deactivated'} ${selectedIds.size} users`
      );
      setSelectedIds(new Set());
    } catch {
      toast.error('Failed to perform bulk action');
    } finally {
      setIsBulkActionPending(false);
    }
  };

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between p-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border rounded-md shadow-sm">
          <div className="flex items-center gap-3 px-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label="Select all users"
            />
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-2"
                disabled={isBulkActionPending}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                Actions
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[160px]">
              <DropdownMenuItem onClick={() => handleBulkAction('ACTIVATE')}>
                <UserCheck className="mr-2 h-4 w-4 text-green-500" />
                <span>Activate</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleBulkAction('DEACTIVATE')}>
                <UserX className="mr-2 h-4 w-4 text-orange-500" />
                <span>Deactivate</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleBulkAction('DELETE')}
                className="text-red-600 focus:text-red-600 focus:bg-red-50"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {users.length > 0 && selectedIds.size === 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-muted/30 rounded-md border border-transparent">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            aria-label="Select all users"
          />
          <span className="text-sm text-muted-foreground">Select all</span>
        </div>
      )}

      <div className="space-y-2">
        {users.map(user => {
          const handleUpdateRole = async (role: string) => {
            const formData = new FormData();
            formData.append('role', role);
            await updateUserRole(user.id, formData);
          };

          const handleDeactivate = async () => {
            await deactivateUser(user.id);
          };

          const handleReactivate = async () => {
            await reactivateUser(user.id);
          };

          const handleDelete = async () => {
            await deleteUser(user.id);
          };

          const handleGenerateInvite = async () => {
            const formData = new FormData();
            await generateInvite(user.id, { error: null }, formData);
          };

          const handleAddToTeam = async (teamId: string) => {
            const formData = new FormData();
            formData.append('teamId', teamId);
            formData.append('role', 'MEMBER');
            await addUserToTeam(user.id, formData);
          };

          return (
            <UserCard
              key={user.id}
              user={user}
              selected={selectedIds.has(user.id)}
              onSelect={() => toggleUser(user.id)}
              isCurrentUser={user.id === currentUserId}
              isAdmin={isAdmin}
              teams={teams}
              onActivate={user.status === 'DISABLED' ? handleReactivate : undefined}
              onDeactivate={user.status === 'ACTIVE' ? handleDeactivate : undefined}
              onDelete={handleDelete}
              onGenerateInvite={user.status === 'INVITED' ? handleGenerateInvite : undefined}
              onUpdateRole={handleUpdateRole}
              onAddToTeam={handleAddToTeam}
            />
          );
        })}
      </div>

      {users.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No users found matching your filters.</p>
        </div>
      )}
    </div>
  );
}
