'use client';

import { useRouter } from 'next/navigation';

interface FilterChipsProps {
  filters: {
    team?: string;
    service?: string;
    assignee?: string;
    status?: string;
    urgency?: string;
    window?: string;
  };
  teams: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string | null; email: string | null }>;
}

export default function FilterChips({ filters, teams, services, users }: FilterChipsProps) {
  const router = useRouter();

  const handleRemoveFilter = (filterType: string) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (key !== filterType && value && value !== 'ALL') {
        params.append(key, value);
      }
    });
    router.push(`/analytics?${params.toString()}`);
  };

  const handleClearAll = () => {
    router.push('/analytics');
  };
  const activeFilters: Array<{ type: string; label: string; value: string }> = [];

  if (filters.team && filters.team !== 'ALL') {
    const team = teams.find(t => t.id === filters.team);
    activeFilters.push({ type: 'team', label: 'Team', value: team?.name || filters.team });
  }
  if (filters.service && filters.service !== 'ALL') {
    const service = services.find(s => s.id === filters.service);
    activeFilters.push({
      type: 'service',
      label: 'Service',
      value: service?.name || filters.service,
    });
  }
  if (filters.assignee && filters.assignee !== 'ALL') {
    const user = users.find(u => u.id === filters.assignee);
    activeFilters.push({
      type: 'assignee',
      label: 'Assignee',
      value: user?.name || user?.email || filters.assignee,
    });
  }
  if (filters.status && filters.status !== 'ALL') {
    activeFilters.push({ type: 'status', label: 'Status', value: filters.status });
  }
  if (filters.urgency && filters.urgency !== 'ALL') {
    activeFilters.push({ type: 'urgency', label: 'Urgency', value: filters.urgency });
  }
  if (filters.window && filters.window !== '7') {
    activeFilters.push({ type: 'window', label: 'Window', value: `Last ${filters.window} days` });
  }

  if (activeFilters.length === 0) return null;

  return (
    <div className="analytics-filter-chips-container">
      <div className="analytics-filter-chips">
        {activeFilters.map(filter => (
          <span key={filter.type} className="analytics-filter-chip">
            <span className="analytics-filter-chip-label">{filter.label}:</span>
            <span className="analytics-filter-chip-value">{filter.value}</span>
            <button
              type="button"
              className="analytics-filter-chip-remove"
              onClick={() => handleRemoveFilter(filter.type)}
              aria-label={`Remove ${filter.label} filter`}
            >
              x
            </button>
          </span>
        ))}
      </div>
      {activeFilters.length > 1 && (
        <button type="button" className="analytics-filter-clear-all" onClick={handleClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
