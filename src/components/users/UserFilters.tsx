'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';
import { UserCheck, UserPlus, UserX, Users } from 'lucide-react';

type Team = {
  id: string;
  name: string;
};

type UserFiltersProps = {
  teams: Team[];
};

export default function UserFilters({ teams }: UserFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const query = searchParams.get('q') || '';
  const status = searchParams.get('status') || '';
  const role = searchParams.get('role') || '';
  const teamId = searchParams.get('teamId') || '';

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      // Reset page when filtering
      if (name !== 'page') {
        params.delete('page');
      }
      return params.toString();
    },
    [searchParams]
  );

  const handleFilterChange = (name: string, value: string) => {
    startTransition(() => {
      router.push(`/users?${createQueryString(name, value)}`);
    });
  };

  const clearFilters = () => {
    startTransition(() => {
      router.push('/users');
    });
  };

  const hasFilters = !!query || !!status || !!role || !!teamId;

  return (
    <FilterBar
      chips={
        <>
          <FilterChip active={!hasFilters} onClick={clearFilters}>
            All users
          </FilterChip>
          <FilterChip
            tone="ok"
            icon={<UserCheck />}
            active={status === 'ACTIVE'}
            onClick={() => handleFilterChange('status', status === 'ACTIVE' ? '' : 'ACTIVE')}
          >
            Active
          </FilterChip>
          <FilterChip
            tone="elevated"
            icon={<UserPlus />}
            active={status === 'INVITED'}
            onClick={() => handleFilterChange('status', status === 'INVITED' ? '' : 'INVITED')}
          >
            Invited
          </FilterChip>
          <FilterChip
            icon={<UserX />}
            active={status === 'DISABLED'}
            onClick={() => handleFilterChange('status', status === 'DISABLED' ? '' : 'DISABLED')}
          >
            Disabled
          </FilterChip>
          <FilterChip
            icon={<Users />}
            active={role === 'ADMIN'}
            onClick={() => handleFilterChange('role', role === 'ADMIN' ? '' : 'ADMIN')}
          >
            Admins
          </FilterChip>
        </>
      }
      search={{
        value: query,
        onChange: value => handleFilterChange('q', value),
        placeholder: 'Search by name or email…',
        label: 'Search users',
        debounceMs: 300,
      }}
      hasActiveFilters={hasFilters}
      onClearAll={clearFilters}
      filters={
        <>
          <FilterField label="Status" htmlFor="users-filter-status">
            <Select
              value={status || 'all'}
              onValueChange={val => handleFilterChange('status', val === 'all' ? '' : val)}
            >
              <SelectTrigger id="users-filter-status" className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="ACTIVE">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span>Active</span>
                  </div>
                </SelectItem>
                <SelectItem value="INVITED">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                    <span>Invited</span>
                  </div>
                </SelectItem>
                <SelectItem value="DISABLED">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-ink-400" aria-hidden="true" />
                    <span>Disabled</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Role" htmlFor="users-filter-role">
            <Select
              value={role || 'all'}
              onValueChange={val => handleFilterChange('role', val === 'all' ? '' : val)}
            >
              <SelectTrigger id="users-filter-role" className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="RESPONDER">Responder</SelectItem>
                <SelectItem value="AUDITOR">Auditor</SelectItem>
                <SelectItem value="USER">User</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Team" htmlFor="users-filter-team">
            <Select
              value={teamId || 'all'}
              onValueChange={val => handleFilterChange('teamId', val === 'all' ? '' : val)}
            >
              <SelectTrigger id="users-filter-team" className="h-9 w-[170px] text-sm">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        </>
      }
    />
  );
}
