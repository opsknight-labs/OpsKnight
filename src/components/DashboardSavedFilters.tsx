'use client';

import { logger } from '@/lib/logger';
import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { X, Save } from 'lucide-react';

type SavedFilter = {
  id: string;
  name: string;
  filters: {
    status?: string;
    service?: string;
    assignee?: string;
    urgency?: string;
    range?: string;
  };
};

export default function DashboardSavedFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [filterName, setFilterName] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('dashboard-saved-filters');
    if (saved) {
      try {
        setSavedFilters(JSON.parse(saved)); // eslint-disable-line react-hooks/set-state-in-effect
      } catch (e) {
        if (e instanceof Error) {
          logger.error('Failed to load saved filters', { error: e.message });
        } else {
          logger.error('Failed to load saved filters', { error: String(e) });
        }
      }
    }
  }, []);

  const saveCurrentFilter = () => {
    const currentFilters: SavedFilter['filters'] = {};
    const status = searchParams.get('status');
    const service = searchParams.get('service');
    const assignee = searchParams.get('assignee');
    const urgency = searchParams.get('urgency');
    const range = searchParams.get('range');

    if (status) currentFilters.status = status;
    if (service) currentFilters.service = service;
    if (assignee !== null) currentFilters.assignee = assignee;
    if (urgency) currentFilters.urgency = urgency;
    if (range) currentFilters.range = range;

    if (Object.keys(currentFilters).length === 0) {
      alert('No active filters to save');
      return;
    }

    if (!filterName.trim()) {
      setShowSaveDialog(true);
      return;
    }

    const newFilter: SavedFilter = {
      id: Date.now().toString(),
      name: filterName.trim(),
      filters: currentFilters,
    };

    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem('dashboard-saved-filters', JSON.stringify(updated));
    setFilterName('');
    setShowSaveDialog(false);
  };

  const loadFilter = (filter: SavedFilter) => {
    const params = new URLSearchParams();
    if (filter.filters.status) params.set('status', filter.filters.status);
    if (filter.filters.service) params.set('service', filter.filters.service);
    if (filter.filters.assignee !== undefined) params.set('assignee', filter.filters.assignee);
    if (filter.filters.urgency) params.set('urgency', filter.filters.urgency);
    if (filter.filters.range) params.set('range', filter.filters.range);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const deleteFilter = (id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    localStorage.setItem('dashboard-saved-filters', JSON.stringify(updated));
  };

  const hasActiveFilters = searchParams.toString().length > 0;

  return (
    <div className="mb-4">
      <div className="flex gap-2 items-center flex-wrap mb-2">
        <span className="text-xs text-muted-foreground font-semibold">Saved Filters:</span>
        {savedFilters.map(filter => (
          <Badge
            key={filter.id}
            variant="outline"
            className="px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-neutral-50 hover:border-primary transition-all flex items-center gap-1.5"
            onClick={() => loadFilter(filter)}
          >
            <Save className="h-3 w-3" />
            {filter.name}
            <button
              onClick={e => {
                e.stopPropagation();
                if (confirm(`Delete "${filter.name}"?`)) {
                  deleteFilter(filter.id);
                }
              }}
              className="ml-1 hover:text-foreground"
              title="Delete filter"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {hasActiveFilters && (
          <Button
            onClick={saveCurrentFilter}
            size="sm"
            className="h-7 px-3 text-xs font-semibold gap-1.5"
          >
            <Save className="h-3 w-3" />
            Save Current
          </Button>
        )}
      </div>

      {showSaveDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
          onClick={() => setShowSaveDialog(false)}
        >
          <div
            className="bg-card p-6 rounded-lg max-w-md w-[90%] shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">Save Filter Preset</h3>
            <Input
              type="text"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              placeholder="Filter name (e.g., My Active Incidents)"
              className="mb-4"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && filterName.trim()) {
                  saveCurrentFilter();
                }
                if (e.key === 'Escape') {
                  setShowSaveDialog(false);
                }
              }}
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowSaveDialog(false);
                  setFilterName('');
                }}
              >
                Cancel
              </Button>
              <Button onClick={saveCurrentFilter} disabled={!filterName.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
