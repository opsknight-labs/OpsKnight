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

interface AnalyticsFiltersProps {
  teams: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string | null; email: string | null }>;
  currentFilters: {
    team?: string;
    service?: string;
    assignee?: string;
    status?: string;
    urgency?: string;
    window?: string;
  };
}

const STATUS_OPTIONS = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED', 'RESOLVED'];
const URGENCY_OPTIONS = ['HIGH', 'MEDIUM', 'LOW'];
const WINDOW_OPTIONS = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const DEFAULT_WINDOW = '7';

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
const windowLabel = (days: number | string) =>
  `Last ${days} ${Number(days) === 1 ? 'day' : 'days'}`;
const triggerClass = 'h-9 w-full bg-background text-sm';

export default function AnalyticsFilters({
  teams,
  services,
  users,
  currentFilters,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const getUserName = (user: { name: string | null; email: string | null }) =>
    user.name || user.email || 'Unknown user';

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'ALL') {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      return params.toString();
    },
    [searchParams]
  );

  const handleFilterChange = (name: string, value: string) => {
    startTransition(() => {
      const qs = createQueryString(name, value);
      router.push(qs ? `/analytics?${qs}` : '/analytics');
    });
  };

  const clearFilters = () => {
    startTransition(() => {
      router.push('/analytics');
    });
  };

  const isSet = (value?: string) => Boolean(value && value !== 'ALL');
  const activeTokens: Array<{ key: string; label: string }> = [];
  if (isSet(currentFilters.team)) {
    const team = teams.find(t => t.id === currentFilters.team);
    activeTokens.push({ key: 'team', label: `Team: ${team?.name ?? currentFilters.team}` });
  }
  if (isSet(currentFilters.service)) {
    const service = services.find(s => s.id === currentFilters.service);
    activeTokens.push({
      key: 'service',
      label: `Service: ${service?.name ?? currentFilters.service}`,
    });
  }
  if (isSet(currentFilters.assignee)) {
    const user = users.find(u => u.id === currentFilters.assignee);
    activeTokens.push({
      key: 'assignee',
      label: `Assignee: ${user ? getUserName(user) : currentFilters.assignee}`,
    });
  }
  if (isSet(currentFilters.status)) {
    activeTokens.push({ key: 'status', label: `Status: ${titleCase(currentFilters.status!)}` });
  }
  if (isSet(currentFilters.urgency)) {
    activeTokens.push({ key: 'urgency', label: `Urgency: ${titleCase(currentFilters.urgency!)}` });
  }
  if (currentFilters.window && currentFilters.window !== DEFAULT_WINDOW) {
    activeTokens.push({ key: 'window', label: windowLabel(currentFilters.window) });
  }

  return (
    <FilterBar
      chips={
        activeTokens.length > 0
          ? activeTokens.map(token => (
              <FilterChip key={token.key} onRemove={() => handleFilterChange(token.key, '')}>
                {token.label}
              </FilterChip>
            ))
          : undefined
      }
      hasActiveFilters={activeTokens.length > 0}
      onClearAll={clearFilters}
      filters={
        <>
          <FilterField label="Time window" htmlFor="analytics-filter-window">
            <Select
              value={currentFilters.window || DEFAULT_WINDOW}
              onValueChange={val => handleFilterChange('window', val)}
            >
              <SelectTrigger id="analytics-filter-window" className={triggerClass}>
                <SelectValue placeholder="Last 7 days" />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map(days => (
                  <SelectItem key={days} value={`${days}`}>
                    {windowLabel(days)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Team" htmlFor="analytics-filter-team">
            <Select
              value={currentFilters.team || 'ALL'}
              onValueChange={val => handleFilterChange('team', val)}
            >
              <SelectTrigger id="analytics-filter-team" className={triggerClass}>
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All teams</SelectItem>
                {teams
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(team => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Service" htmlFor="analytics-filter-service">
            <Select
              value={currentFilters.service || 'ALL'}
              onValueChange={val => handleFilterChange('service', val)}
            >
              <SelectTrigger id="analytics-filter-service" className={triggerClass}>
                <SelectValue placeholder="All services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All services</SelectItem>
                {services
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(service => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Assignee" htmlFor="analytics-filter-assignee">
            <Select
              value={currentFilters.assignee || 'ALL'}
              onValueChange={val => handleFilterChange('assignee', val)}
            >
              <SelectTrigger id="analytics-filter-assignee" className={triggerClass}>
                <SelectValue placeholder="All assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All assignees</SelectItem>
                {users
                  .slice()
                  .sort((a, b) => getUserName(a).localeCompare(getUserName(b)))
                  .map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {getUserName(user)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Status" htmlFor="analytics-filter-status">
            <Select
              value={currentFilters.status || 'ALL'}
              onValueChange={val => handleFilterChange('status', val)}
            >
              <SelectTrigger id="analytics-filter-status" className={triggerClass}>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_OPTIONS.map(status => (
                  <SelectItem key={status} value={status}>
                    {titleCase(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Urgency" htmlFor="analytics-filter-urgency">
            <Select
              value={currentFilters.urgency || 'ALL'}
              onValueChange={val => handleFilterChange('urgency', val)}
            >
              <SelectTrigger id="analytics-filter-urgency" className={triggerClass}>
                <SelectValue placeholder="All urgencies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All urgencies</SelectItem>
                {URGENCY_OPTIONS.map(urgency => (
                  <SelectItem key={urgency} value={urgency}>
                    {titleCase(urgency)}
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
