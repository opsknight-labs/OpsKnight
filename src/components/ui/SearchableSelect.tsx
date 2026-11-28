'use client';

import { useId, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { cn } from '@/lib/utils';

export type SearchableOption = {
  value: string;
  label: string;
  /** A second line under the label, searched too (for example a team or an email). */
  description?: string;
  /** Options with the same group are listed together under its heading. */
  group?: string;
};

/** More than this many matches are cut off, with a hint to keep typing. */
const MAX_SHOWN = 100;

const normalise = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Every typed word must appear in the label or description, in any order. */
export function filterOptions(options: readonly SearchableOption[], query: string) {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter(option => {
    const text = normalise(`${option.label} ${option.description ?? ''}`);
    return words.every(word => text.includes(word));
  });
}

/**
 * A dropdown with search, for any list that can grow (services, people, teams, runbooks). Lists of seven or
 * fewer are better as cards or a plain select. It works in a native form (a hidden input carries the value),
 * is a labelled combobox for screen readers and keyboards, and stays usable on a phone (44 px rows, the list
 * is as wide as the field).
 */
export default function SearchableSelect({
  id,
  name,
  options,
  value,
  defaultValue = '',
  onChange,
  placeholder = 'Select…',
  /** Label of the "no selection" row; when set the field can be cleared back to this. */
  clearLabel,
  searchPlaceholder = 'Search…',
  noun = 'results',
  disabled = false,
  invalid = false,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  /** Omit for a select that only navigates and must not be submitted with its form. */
  name?: string;
  options: readonly SearchableOption[];
  /** Controlled value; leave undefined for an uncontrolled field that starts at `defaultValue`. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  searchPlaceholder?: string;
  /** What the list holds, for "No services match" and the count. */
  noun?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const generated = useId();
  const triggerId = id ?? generated;
  const listId = `${triggerId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const selected = options.find(option => option.value === current);
  const matches = useMemo(() => filterOptions(options, query), [options, query]);
  const shown = matches.slice(0, MAX_SHOWN);
  const groups = useMemo(() => {
    const byGroup = new Map<string, SearchableOption[]>();
    for (const option of shown) {
      const key = option.group ?? '';
      byGroup.set(key, [...(byGroup.get(key) ?? []), option]);
    }
    return [...byGroup.entries()];
  }, [shown]);

  const choose = (next: string) => {
    setInternal(next);
    onChange?.(next);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      <Popover
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            id={triggerId}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listId : undefined}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn(
              'flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-base text-foreground ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=open]:border-primary sm:min-h-10 md:text-sm',
              !selected && 'text-muted-foreground',
              clearLabel !== undefined && selected && 'pr-14'
            )}
          >
            <span className="truncate">
              {selected ? selected.label : (clearLabel ?? placeholder)}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-64 overflow-hidden p-1"
        >
          <Command shouldFilter={false} className="bg-transparent">
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
              aria-label={searchPlaceholder}
            />
            <CommandList id={listId} className="max-h-[min(18rem,60vh)]">
              {matches.length === 0 && (
                <CommandEmpty>
                  <span className="block px-3 text-sm text-muted-foreground">
                    No {noun} match “{query}”. Try fewer letters.
                  </span>
                </CommandEmpty>
              )}
              {clearLabel !== undefined && query === '' && (
                <CommandGroup>
                  <PickerRow
                    itemValue="__none__"
                    selected={current === ''}
                    label={clearLabel}
                    muted
                    onSelect={() => choose('')}
                  />
                </CommandGroup>
              )}
              {groups.map(([group, items]) => (
                <CommandGroup key={group} heading={group || undefined}>
                  {items.map(option => (
                    <PickerRow
                      key={option.value}
                      itemValue={option.value}
                      selected={option.value === current}
                      label={option.label}
                      description={option.description}
                      onSelect={() => choose(option.value)}
                    />
                  ))}
                </CommandGroup>
              ))}
              {matches.length > MAX_SHOWN && (
                <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
                  Showing {MAX_SHOWN} of {matches.length} {noun}. Keep typing to narrow it down.
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {clearLabel !== undefined && selected && !disabled && (
        <button
          type="button"
          onClick={() => choose('')}
          aria-label={`Clear: ${clearLabel}`}
          className="absolute right-9 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function PickerRow({
  itemValue,
  selected,
  label,
  description,
  muted,
  onSelect,
}: {
  /** Unique per row: two options may share a label, and cmdk treats equal values as one item. */
  itemValue: string;
  selected: boolean;
  label: string;
  description?: string;
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={itemValue}
      onSelect={onSelect}
      className="min-h-11 cursor-pointer gap-2 rounded-md px-2 py-1.5 sm:min-h-9"
    >
      <Check
        className={cn('h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className={cn('block truncate text-sm', muted && 'text-muted-foreground')}>
          {label}
        </span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      {selected && <span className="sr-only">(selected)</span>}
    </CommandItem>
  );
}
