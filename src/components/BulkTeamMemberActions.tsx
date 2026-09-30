'use client';

import { useEffect, useState, useTransition } from 'react';
import { useToast } from '@/hooks/use-product-notification';
import VirtualList from './ui/VirtualList';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import { UserPlus, ChevronDown, ChevronUp, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import UserAvatar from '@/components/UserAvatar';

type User = {
  id: string;
  name: string;
  email: string;
  status?: string;
  avatarUrl?: string | null;
  gender?: string | null;
};

type BulkTeamMemberActionsProps = {
  availableUsers: User[];
  canManageMembers: boolean;
  canAssignOwnerAdmin: boolean;
  addMember: (formData: FormData) => Promise<{ error?: string } | undefined>;
  teamId: string;
};

export default function BulkTeamMemberActions({
  availableUsers,
  canManageMembers,
  canAssignOwnerAdmin,
  addMember,
  teamId,
}: BulkTeamMemberActionsProps) {
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<string>('MEMBER');
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>(availableUsers);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (!search) {
      setSearchResults(availableUsers);
    }
  }, [availableUsers, search]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/available-users?q=${encodeURIComponent(search)}&limit=50`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Search failed');
        const data = (await response.json()) as { users?: User[]; hasMore?: boolean };
        setSearchResults(data.users || []);
        setHasMore(Boolean(data.hasMore));
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          showToast('Unable to search the user directory', 'error');
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, showToast, teamId]);

  if (!canManageMembers) {
    return null;
  }

  const handleToggleUser = (userId: string) => {
    const newSelected = new Set(selectedUsers);
    if (newSelected.has(userId)) {
      newSelected.delete(userId);
    } else {
      newSelected.add(userId);
    }
    setSelectedUsers(newSelected);
  };

  const handleSelectAll = () => {
    const allVisibleSelected =
      searchResults.length > 0 && searchResults.every(u => selectedUsers.has(u.id));
    const next = new Set(selectedUsers);
    if (allVisibleSelected) {
      searchResults.forEach(u => next.delete(u.id));
    } else {
      searchResults.forEach(u => next.add(u.id));
    }
    setSelectedUsers(next);
  };

  const handleBulkAdd = () => {
    if (selectedUsers.size === 0) {
      showToast('Select at least one user', 'error');
      return;
    }

    if (!canAssignOwnerAdmin && (role === 'OWNER' || role === 'ADMIN')) {
      showToast('Only admins can assign OWNER or ADMIN roles', 'error');
      return;
    }

    startTransition(async () => {
      let successCount = 0;
      let errorCount = 0;

      for (const userId of selectedUsers) {
        const formData = new FormData();
        formData.set('userId', userId);
        formData.set('role', role);
        const result = await addMember(formData);
        if (result?.error) {
          errorCount++;
        } else {
          successCount++;
        }
      }

      if (successCount > 0) {
        showToast(
          `Successfully added ${successCount} member${successCount > 1 ? 's' : ''}`,
          'success'
        );
      }
      if (errorCount > 0) {
        showToast(`Failed to add ${errorCount} member${errorCount > 1 ? 's' : ''}`, 'error');
      }

      setSelectedUsers(new Set());
    });
  };

  const renderUserItem = (user: User, index: number) => (
    <label
      key={user.id}
      className={cn(
        'flex items-center gap-3 p-3 cursor-pointer transition-colors border-b last:border-b-0',
        selectedUsers.has(user.id) ? 'bg-blue-50' : 'hover:bg-muted/50'
      )}
    >
      <Checkbox
        checked={selectedUsers.has(user.id)}
        onCheckedChange={() => handleToggleUser(user.id)}
      />
      <UserAvatar userId={user.id} name={user.name} gender={user.gender} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{user.name}</div>
        <div className="text-xs text-muted-foreground truncate">{user.email}</div>
      </div>
      {user.status === 'DISABLED' && (
        <Badge variant="danger" size="xs">
          Disabled
        </Badge>
      )}
    </label>
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Bulk Add</span>
            {selectedUsers.size > 0 && (
              <Badge variant="secondary" size="xs" className="ml-2">
                {selectedUsers.size} selected
              </Badge>
            )}
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-4">
          {/* Search Input */}
          <div className="space-y-1">
            <Label htmlFor="bulk-search" className="text-xs">
              Search Users
            </Label>
            <div className="relative">
              <Input
                id="bulk-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                aria-label="Search available users"
                className="h-8 text-xs pr-8"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {hasMore && (
              <p className="text-[11px] text-muted-foreground">
                More matches available. Refine query to narrow down.
              </p>
            )}
          </div>

          {/* Select All Button */}
          <div className="flex justify-between items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              disabled={searchResults.length === 0}
              className="h-8 text-xs"
            >
              {searchResults.length > 0 && searchResults.every(u => selectedUsers.has(u.id))
                ? 'Deselect Visible'
                : 'Select Visible'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {selectedUsers.size} selected
            </span>
          </div>

          {/* Role Selection */}
          <div className="space-y-2">
            <Label htmlFor="bulk-role" className="text-xs">
              Role for Selected Users
            </Label>
            <select
              id="bulk-role"
              value={role}
              onChange={e => setRole(e.target.value)}
              disabled={!canAssignOwnerAdmin && (role === 'OWNER' || role === 'ADMIN')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="OWNER" disabled={!canAssignOwnerAdmin}>
                Owner{!canAssignOwnerAdmin ? ' (Admin only)' : ''}
              </option>
              <option value="ADMIN" disabled={!canAssignOwnerAdmin}>
                Admin{!canAssignOwnerAdmin ? ' (Admin only)' : ''}
              </option>
              <option value="MEMBER">Member</option>
            </select>
          </div>

          {/* User List */}
          <div className="border rounded-md overflow-hidden bg-background">
            {searchResults.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {isSearching ? 'Searching...' : 'No available users found.'}
              </div>
            ) : searchResults.length > 10 ? (
              <VirtualList
                items={searchResults}
                itemHeight={60}
                containerHeight={200}
                overscan={3}
                style={{ border: 'none' }}
                renderItem={renderUserItem}
              />
            ) : (
              <div className="max-h-[200px] overflow-y-auto">
                {searchResults.map((user, index) => renderUserItem(user, index))}
              </div>
            )}
          </div>

          {/* Add Button */}
          <Button
            type="button"
            onClick={handleBulkAdd}
            disabled={selectedUsers.size === 0 || isPending}
            className="w-full gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Add {selectedUsers.size} Member{selectedUsers.size !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
