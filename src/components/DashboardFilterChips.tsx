'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { X } from 'lucide-react';

type FilterChipsProps = {
  services: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
};

export default function DashboardFilterChips({ services, users }: FilterChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeFilters: Array<{ key: string; label: string; value: string }> = [];

  const status = searchParams.get('status');
  if (status && status !== 'ALL') {
    activeFilters.push({ key: 'status', label: 'Status', value: status });
  }

  const serviceId = searchParams.get('service');
  if (serviceId) {
    const service = services.find(s => s.id === serviceId);
    if (service) {
      activeFilters.push({ key: 'service', label: 'Service', value: service.name });
    }
  }

  const assigneeId = searchParams.get('assignee');
  if (assigneeId !== null) {
    if (assigneeId === '') {
      activeFilters.push({ key: 'assignee', label: 'Assignee', value: 'Unassigned' });
    } else {
      const user = users.find(u => u.id === assigneeId);
      if (user) {
        activeFilters.push({ key: 'assignee', label: 'Assignee', value: user.name });
      }
    }
  }

  const urgency = searchParams.get('urgency');
  if (urgency) {
    activeFilters.push({ key: 'urgency', label: 'Urgency', value: urgency });
  }

  const range = searchParams.get('range');
  if (range && range !== 'all') {
    activeFilters.push({ key: 'range', label: 'Time Range', value: `Last ${range} days` });
  }

  const removeFilter = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const clearAll = () => {
    router.push(pathname, { scroll: false });
  };

  if (activeFilters.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 items-center flex-wrap mt-2">
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Active Filters:
      </span>
      {activeFilters.map(filter => (
        <Badge
          key={filter.key}
          variant="secondary"
          size="xs"
          className="rounded-full font-medium flex items-center gap-1.5"
        >
          <span>
            {filter.label}: <strong>{filter.value}</strong>
          </span>
          <button
            onClick={() => removeFilter(filter.key)}
            className="hover:text-foreground transition-colors"
            title={`Remove ${filter.label} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        onClick={clearAll}
        variant="outline"
        size="sm"
        className="h-6 px-2.5 text-xs font-medium rounded-full"
      >
        Clear All
      </Button>
    </div>
  );
}
