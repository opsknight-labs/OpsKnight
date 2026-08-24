'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
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
import { Input } from '@/components/ui/shadcn/input';

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
  teamId,
}: TeamMemberFormProps) {
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('MEMBER');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>(availableUsers.slice(0, 20));
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(availableUsers.length > 20);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/available-users?q=${encodeURIComponent(search)}&limit=30`,
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

  const selectableUsers = useMemo(() => {
    const selected = availableUsers.find(user => user.id === selectedUserId);
    return selected && !searchResults.some(user => user.id === selected.id)
      ? [selected, ...searchResults]
      : searchResults;
  }, [availableUsers, searchResults, selectedUserId]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUserId) return;

    const formData = new FormData();
    formData.set('userId', selectedUserId);
    formData.set('role', selectedRole);
    const userName = selectableUsers.find(u => u.id === selectedUserId)?.name || 'User';

    startTransition(async () => {
      const result = await addMember(formData);
      if (result?.error) {
        showToast(result.error, 'error');
      } else {
        showToast(`${userName} added as ${selectedRole}`, 'success');
        setSearchResults(current => current.filter(user => user.id !== selectedUserId));
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
        <div className="relative">
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search available users"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <Select
          value={selectedUserId}
          onValueChange={setSelectedUserId}
          disabled={isPending || isSearching || selectableUsers.length === 0}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                selectableUsers.length === 0 ? 'No matching users' : 'Choose a user...'
              }
            />
          </SelectTrigger>
          <SelectContent className="max-h-[200px]">
            {selectableUsers.map(user => (
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
        {hasMore && (
          <p className="text-xs text-muted-foreground">
            More matches are available. Refine the search to find a specific user.
          </p>
        )}
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
        disabled={selectableUsers.length === 0 || !selectedUserId || isPending}
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
