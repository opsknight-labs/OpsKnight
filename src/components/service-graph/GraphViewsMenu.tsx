'use client';

import { useEffect, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';

type SavedView = { name: string; search: string };
const STORAGE_KEY = 'opsknight:service-graph:views';

function read(): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (view): view is SavedView =>
              typeof view?.name === 'string' && typeof view?.search === 'string'
          )
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function write(views: SavedView[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Storage can be blocked; the view is then only in the URL.
  }
}

/** Named filter sets, kept in this browser. The current view is always in the URL too, so it can be shared. */
export default function GraphViewsMenu({
  currentSearch,
  onApply,
}: {
  /** The filter state as a query string. */
  currentSearch: () => string;
  onApply: (search: string) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState('');
  useEffect(() => setViews(read()), []);
  const save = () => {
    const label = name.trim().slice(0, 40);
    if (!label) return;
    const next = [
      ...views.filter(view => view.name !== label),
      { name: label, search: currentSearch() },
    ].slice(-20);
    setViews(next);
    write(next);
    setName('');
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Bookmark className="h-4 w-4" aria-hidden="true" /> Views
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            aria-label="Name for this view"
            placeholder="Name this view"
            value={name}
            maxLength={40}
            onChange={event => setName(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Save
          </Button>
        </form>
        {views.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Saved views keep your search and filters for next time.
          </p>
        ) : (
          <ul className="space-y-1">
            {views.map(view => (
              <li key={view.name} className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => onApply(view.search)}
                >
                  <span className="truncate">{view.name}</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label={`Delete view ${view.name}`}
                  onClick={() => {
                    const next = views.filter(other => other.name !== view.name);
                    setViews(next);
                    write(next);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
