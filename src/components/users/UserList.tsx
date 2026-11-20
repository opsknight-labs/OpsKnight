'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  UserActionsMenu,
  UserCard,
  UserEmail,
  UserRoleBadge,
  UserStatus,
  UserTeams,
  UserYouBadge,
} from './UserCard';
import UserSortDropdown from './UserSortDropdown';
import UserAvatar from '@/components/UserAvatar';
import {
  DirectoryCardGrid,
  DirectoryGuide,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  EmptyState,
  RelativeTime,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
  type DirectorySort,
} from '@/components/patterns';
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
  Calendar,
  ChevronDown,
  Trash2,
  UserX,
  UserCheck,
  MoreHorizontal,
  Users,
} from 'lucide-react';
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
  roleSource?: string | null;
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
  passwordResetAvailable?: boolean;
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
  bulkUpdateUsers?: (
    prevState: { error?: string | null; success?: boolean; message?: string },
    formData: FormData
  ) => Promise<{ error?: string | null; success?: boolean; message?: string }>;
  /** Pagination summary under the "User Directory" title. */
  summary?: ReactNode;
  /** Right-most header actions, e.g. Invite User. */
  actions?: ReactNode;
};

const GUIDE_STEPS = [
  {
    title: 'Invite people',
    description:
      'Add a name, email and role. They get an email invite, or a link you can share if email isn’t set up.',
  },
  {
    title: 'Choose a role',
    description:
      'Admins have full control, Responders handle incidents and on-call, Users get basic access and Auditors can view everything read-only.',
  },
  {
    title: 'Add them to teams',
    description: 'Put people on teams and schedule rotations so escalation policies can page them.',
  },
];

const GUIDE_LINKS = [
  {
    label: 'Team Directory',
    href: '/teams',
    icon: <Users className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  {
    label: 'On-call Schedules',
    href: '/schedules',
    icon: <Calendar className="h-3.5 w-3.5" aria-hidden="true" />,
  },
];

export default function UserList({
  users,
  currentUserId,
  isAdmin,
  passwordResetAvailable = true,
  teams,
  updateUserRole,
  addUserToTeam,
  deactivateUser,
  reactivateUser,
  deleteUser,
  generateInvite,
  getUserDependencyReport,
  bulkUpdateUsers,
  summary,
  actions,
}: UserListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);
  const [view, setView] = useDirectoryView('users');
  const router = useRouter();
  const searchParams = useSearchParams();
  // Same URL params as UserSortDropdown (sortBy / sortOrder, newest first by default).
  const sort: DirectorySort = {
    key: searchParams.get('sortBy') || 'createdAt',
    direction: searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc',
  };
  const changeSort = (next: DirectorySort) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortBy', next.key);
    params.set('sortOrder', next.direction);
    params.delete('page');
    router.push(`/users?${params.toString()}`);
  };

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
  const someSelected = selectedIds.size > 0 && !allSelected;

  const handleBulkAction = async (action: 'DEACTIVATE' | 'ACTIVATE' | 'DELETE') => {
    if (selectedIds.size === 0) return;
    setIsBulkActionPending(true);

    try {
      if (bulkUpdateUsers) {
        const formData = new FormData();
        formData.set('bulkAction', action.toLowerCase());
        Array.from(selectedIds).forEach(id => formData.append('userIds', id));
        const res = await bulkUpdateUsers({}, formData);
        if (res?.error) {
          toast.error(res.error);
        } else {
          toast.success(
            res?.message ||
              `${action === 'DELETE' ? 'Deleted' : action === 'ACTIVATE' ? 'Activated' : 'Deactivated'} ${selectedIds.size} user(s)`
          );
          setSelectedIds(new Set());
        }
      } else {
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
      }
    } catch {
      toast.error('Failed to perform bulk action');
    } finally {
      setIsBulkActionPending(false);
    }
  };

  // Per-user callbacks shared by the table row menu and the card.
  const userProps = (user: User) => {
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
      else
        toast.success(
          user.status === 'INVITED' ? 'Invitation deleted' : 'User permanently deleted'
        );
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

    return {
      user,
      isCurrentUser: user.id === currentUserId,
      isAdmin,
      teams,
      onActivate: user.status === 'DISABLED' ? handleReactivate : undefined,
      onDeactivate: user.status === 'ACTIVE' ? handleDeactivate : undefined,
      onDelete: handleDelete,
      onGetDependencies: () => getUserDependencyReport(user.id),
      onGenerateInvite: user.status === 'INVITED' ? handleGenerateInvite : undefined,
      onUpdateRole: handleUpdateRole,
      onAddToTeam: handleAddToTeam,
      passwordResetAvailable,
    };
  };

  const identity = (user: User, showMeta: boolean) => (
    <DirectoryPrimaryCell
      href={`/users/${user.id}`}
      leading={
        <UserAvatar
          userId={user.id}
          avatarUrl={user.avatarUrl}
          name={user.name}
          gender={user.gender}
          size="sm"
          className="rounded-full ring-1 ring-border/80"
          aria-hidden
        />
      }
      title={user.name}
      titleAddon={user.id === currentUserId && <UserYouBadge />}
      subtitle={<UserEmail user={user} showMeta={showMeta} />}
    />
  );

  const columns: DirectoryColumn<User>[] = [
    { id: 'user', header: 'User', sortKey: 'name', cell: user => identity(user, true) },
    {
      id: 'role',
      header: 'Role',
      sortKey: 'role',
      hideable: true,
      className: 'w-32',
      cell: user => <UserRoleBadge user={user} />,
    },
    {
      id: 'teams',
      header: 'Teams',
      hideable: true,
      className: 'hidden w-64 md:table-cell',
      cell: user => (
        <UserTeams
          user={user}
          isAdmin={isAdmin}
          teams={teams}
          onAddToTeam={userProps(user).onAddToTeam}
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortKey: 'status',
      hideable: true,
      className: 'w-28',
      cell: user => <UserStatus status={user.status} />,
    },
    {
      id: 'joined',
      header: 'Joined',
      sortKey: 'createdAt',
      hideable: true,
      className: 'hidden w-28 lg:table-cell',
      cell: user => (
        <RelativeTime
          date={user.createdAt}
          fallback="—"
          className="text-xs text-muted-foreground"
        />
      ),
    },
  ];

  const columnVisibility = useDirectoryColumns('users', columns);

  const empty = (
    <EmptyState
      variant="simple"
      title="No users match your filters"
      description="Clear a filter or widen the search to see more people."
    />
  );

  return (
    <div>
      <DirectoryHeader
        title="User Directory"
        summary={summary}
        selectAll={
          isAdmin && users.length > 0
            ? { checked: allSelected, indeterminate: someSelected, onCheckedChange: toggleAll }
            : undefined
        }
        sort={<UserSortDropdown />}
        columns={columnVisibility}
        density
        view={{ value: view, onChange: setView }}
        guide={
          <DirectoryGuide title="How user access works" steps={GUIDE_STEPS} links={GUIDE_LINKS} />
        }
        actions={actions}
      />

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-muted/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-muted/70">
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
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleBulkAction('ACTIVATE')}>
                <UserCheck />
                <span>Activate</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => handleBulkAction('DEACTIVATE')}
              >
                <UserX />
                <span>Deactivate</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => handleBulkAction('DELETE')}>
                <Trash2 />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {view === 'table' ? (
        <DirectoryTable
          label="Users"
          rows={users}
          getRowId={user => user.id}
          columns={columns}
          hiddenColumns={columnVisibility.hidden}
          sort={sort}
          onSortChange={changeSort}
          selection={
            isAdmin
              ? {
                  selected: selectedIds,
                  onToggle: id => toggleUser(id),
                  rowLabel: user => `Select ${user.name}`,
                  isSelectable: user => user.id !== currentUserId,
                }
              : undefined
          }
          rowActions={isAdmin ? user => <UserActionsMenu {...userProps(user)} /> : undefined}
          mobileRow={user => (
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">{identity(user, false)}</div>
              <UserStatus status={user.status} dotOnly />
            </div>
          )}
          empty={empty}
        />
      ) : users.length === 0 ? (
        empty
      ) : (
        <DirectoryCardGrid>
          {users.map(user => (
            <UserCard
              key={user.id}
              {...userProps(user)}
              selected={selectedIds.has(user.id)}
              onSelect={() => toggleUser(user.id)}
            />
          ))}
        </DirectoryCardGrid>
      )}
    </div>
  );
}
