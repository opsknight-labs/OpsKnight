'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { cn } from '@/lib/utils';
import { searchBusinessServiceOptionsAction } from '@/app/(app)/services/business/actions';

export type Option = { id: string; name: string; hint?: string | null };

/** Pick many from a searchable list; selected rows stay on top so the choice is visible. */
export function MultiPicker({
  label,
  description,
  options: initialOptions,
  kind,
  value,
  onChange,
  emptyText,
  rowAddon,
}: {
  label: string;
  description: string;
  options: Option[];
  /** Searches the server as the user types; the initial list is only the first page. Omit to filter `options` locally. */
  kind?: 'services' | 'users';
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  /** Extra control beside a selected row (outside its label, so controls never nest). */
  rowAddon?: (option: Option) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState(initialOptions);
  const selected = new Set(value);
  useEffect(() => {
    const needle = query.trim();
    if (!needle || !kind) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchBusinessServiceOptionsAction(kind, needle)
        .then(found => {
          if (cancelled) return;
          setOptions(current => {
            const known = new Set(current.map(option => option.id));
            return [...current, ...found.filter(option => !known.has(option.id))];
          });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .filter(
        option =>
          !needle ||
          option.name.toLowerCase().includes(needle) ||
          !!option.hint?.toLowerCase().includes(needle)
      )
      .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sort on selection is intentional
  }, [options, query, value]);
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-foreground">
        {label}{' '}
        <span className="font-normal text-muted-foreground tabular-nums">({value.length})</span>
      </legend>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={`${id}-search`}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          aria-label={`Search ${label.toLowerCase()}`}
          className="h-9 pl-8 text-sm"
        />
      </div>
      <ul
        className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border"
        aria-label={label}
      >
        {visible.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</li>
        ) : (
          visible.map(option => {
            const checked = selected.has(option.id);
            return (
              <li key={option.id} className={cn('flex items-center', checked && 'bg-muted/30')}>
                <label
                  className={cn(
                    'flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50'
                  )}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    onChange={() =>
                      onChange(
                        checked ? value.filter(item => item !== option.id) : [...value, option.id]
                      )
                    }
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background'
                    )}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{option.name}</span>
                  {option.hint && (
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </label>
                {checked && rowAddon && <span className="shrink-0 pr-2">{rowAddon(option)}</span>}
              </li>
            );
          })
        )}
      </ul>
    </fieldset>
  );
}
