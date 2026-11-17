'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';

type Team = {
  id: string;
  name: string;
};

type UserFiltersProps = {
  teams: Team[];
  /** Right-aligned slot (sort, view toggle). */
  actions?: ReactNode;
};

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'DISABLED', label: 'Disabled' },
];

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'RESPONDER', label: 'Responder' },
  { value: 'AUDITOR', label: 'Auditor' },
  { value: 'USER', label: 'User' },
];

const triggerClass = 'h-9 w-full min-w-[10rem] bg-background text-sm';

export default function UserFilters({ teams, actions }: UserFiltersProps) {
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
      if (name !== 'page') {
        params.delete('page');
      }
      return params.toString();
    },
    [searchParams]
  );

  const handleFilterChange = useCallback(
    (name: string, value: string) => {
      startTransition(() => {
        const qs = createQueryString(name, value);
        router.push(qs ? `/users?${qs}` : '/users');
      });
    },
    [createQueryString, router]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/users');
    });
  };

  const hasFilters = !!query || !!status || !!role || !!teamId;

  return (
    <FilterBar
      search={{
        value: query,
        onChange: value => handleFilterChange('q', value),
        placeholder: 'Search by name or email…',
        label: 'Search users',
        debounceMs: 300,
      }}
      chips={
        <>
          {STATUS_OPTIONS.map(option => (
            <FilterChip
              key={option.value}
              active={status === option.value}
              onClick={() =>
                handleFilterChange('status', status === option.value ? '' : option.value)
              }
            >
              {option.label}
            </FilterChip>
          ))}
          <FilterChip
            active={role === 'ADMIN'}
            onClick={() => handleFilterChange('role', role === 'ADMIN' ? '' : 'ADMIN')}
          >
            Admins
          </FilterChip>
        </>
      }
      filters={
        <>
          <FilterField label="Status" htmlFor="user-filter-status">
            <Select
              value={status || 'all'}
              onValueChange={val => handleFilterChange('status', val === 'all' ? '' : val)}
            >
              <SelectTrigger id="user-filter-status" className={triggerClass}>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Role" htmlFor="user-filter-role">
            <Select
              value={role || 'all'}
              onValueChange={val => handleFilterChange('role', val === 'all' ? '' : val)}
            >
              <SelectTrigger id="user-filter-role" className={triggerClass}>
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLE_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Team" htmlFor="user-filter-team">
            <Select
              value={teamId || 'all'}
              onValueChange={val => handleFilterChange('teamId', val === 'all' ? '' : val)}
            >
              <SelectTrigger id="user-filter-team" className={triggerClass}>
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
      hasActiveFilters={hasFilters}
      onClearAll={clearFilters}
      actions={actions}
    />
  );
}
