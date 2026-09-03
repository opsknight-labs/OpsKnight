'use client';

import { useState, useCallback, useMemo } from 'react';
import { UserCard } from './UserCard';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import type { UserFormState } from '@/app/(app)/users/actions';
import type { UserDependencyReport } from '@/lib/users/dependencies';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/shadcn/dropdown-menu';
import {
  ChevronDown,
  Trash2,
  UserX,
  UserCheck,
  MoreHorizontal,
  LayoutGrid,
  List,
} from 'lucide-react';
import { notify as toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

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
  getUserDependencyReport: (
    userId: string
  ) => Promise<{ report?: UserDependencyReport; error?: string }>;
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
  getUserDependencyReport,
}: UserListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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
      const results = await Promise.all(
        Array.from(selectedIds).map(async id => {
          if (action === 'DEACTIVATE') return { id, result: await deactivateUser(id) };
          if (action === 'ACTIVATE') return { id, result: await reactivateUser(id) };
          return { id, result: await deleteUser(id) };
        })
      );
      const failures = results.filter(entry => entry.result?.error);
      const succeeded = results.length - failures.length;

      if (succeeded > 0) {
        toast.success(
          `${action === 'DELETE' ? 'Deleted' : action === 'ACTIVATE' ? 'Activated' : 'Deactivated'} ${succeeded} user${succeeded === 1 ? '' : 's'}`
        );
      }
      if (failures.length > 0) {
        toast.error(
          failures.length === 1
            ? failures[0].result?.error || 'The user operation failed.'
            : `${failures.length} users could not be updated. ${failures[0].result?.error || ''}`
        );
      }
      setSelectedIds(new Set(failures.map(entry => entry.id)));
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
        <div className="flex items-center justify-between px-3 py-2 bg-muted/20 rounded-xl border border-border/60">
          <div className="flex items-center gap-2.5">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label="Select all users"
            />
            <span className="text-xs font-medium text-muted-foreground">Select all</span>
          </div>

          <div className="flex items-center gap-1 border border-border/60 rounded-lg p-0.5 bg-background shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-label="Grid view"
              title="Grid View"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                'p-1.5 rounded-md text-xs font-medium transition-all cursor-pointer',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-label="List view"
              title="List View"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div
        className={cn(viewMode === 'grid' ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : 'space-y-3')}
      >
        {users.map(user => {
          const handleUpdateRole = async (role: string) => {
            const formData = new FormData();
            formData.append('role', role);
            const result = await updateUserRole(user.id, formData);
            if (result?.error) toast.error(result.error);
            else toast.success('Role updated');
          };

          const handleDeactivate = async () => {
            const result = await deactivateUser(user.id);
            if (result?.error) toast.error(result.error);
            else toast.success('User disabled');
          };

          const handleReactivate = async () => {
            const result = await reactivateUser(user.id);
            if (result?.error) toast.error(result.error);
            else toast.success('User reactivated');
          };

          const handleDelete = async () => {
            const result = await deleteUser(user.id);
            if (result?.error) toast.error(result.error);
            else toast.success('User permanently deleted');
          };

          const handleGenerateInvite = async () => {
            const formData = new FormData();
            await generateInvite(user.id, { error: null }, formData);
          };

          const handleAddToTeam = async (teamId: string) => {
            const formData = new FormData();
            formData.append('teamId', teamId);
            formData.append('role', 'MEMBER');
            const result = await addUserToTeam(user.id, formData);
            if (result?.error) toast.error(result.error);
            else toast.success('User added to team');
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
              viewMode={viewMode}
              onActivate={user.status === 'DISABLED' ? handleReactivate : undefined}
              onDeactivate={user.status === 'ACTIVE' ? handleDeactivate : undefined}
              onDelete={handleDelete}
              onGetDependencies={() => getUserDependencyReport(user.id)}
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
