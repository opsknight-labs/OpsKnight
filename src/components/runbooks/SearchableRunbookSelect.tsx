'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import {
  Check,
  ChevronsUpDown,
  Cpu,
  Crosshair,
  Layers,
  Loader2,
  Server,
  Workflow,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchableRunbookSelectProps = {
  kind: 'service' | 'runbook' | 'agent' | 'target' | 'pool' | 'agent-history';
  label: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
};

type Option = { value: string; label: string };

const KIND_ICONS = {
  service: Server,
  runbook: Workflow,
  agent: Cpu,
  'agent-history': Cpu,
  pool: Layers,
  target: Crosshair,
} as const;

export function SearchableRunbookSelect({
  kind,
  label,
  name,
  value,
  onChange,
  required = false,
  className,
  placeholder,
  ariaLabel,
}: SearchableRunbookSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [internalValue, setInternalValue] = useState(value ?? '');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedValue = value !== undefined ? (value === 'all' ? '' : value) : internalValue;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const params = new URLSearchParams({ kind, q: search });
        if (selectedValue) params.set('selected', selectedValue);
        const response = await fetch(`/api/runbooks/options?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search failed');
        const json = await response.json();
        const opts = json.options ?? json.data?.options ?? [];
        setOptions(opts);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, search, selectedValue]);

  const fallbackLabel = label.toLowerCase();
  const selectedOption = options.find(o => o.value === selectedValue);
  const displayLabel = selectedOption
    ? selectedOption.label
    : selectedValue
      ? selectedValue
      : (placeholder ??
        (required
          ? label
            ? `Select ${fallbackLabel}…`
            : 'Select…'
          : label
            ? `All ${fallbackLabel}`
            : 'All'));

  const KindIcon = KIND_ICONS[kind] ?? Server;

  const handleSelect = (val: string) => {
    const nextVal = val === selectedValue ? '' : val;
    setInternalValue(nextVal);
    onChange?.(nextVal || 'all');
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInternalValue('');
    onChange?.('all');
  };

  return (
    <div className={cn('space-y-1.5 min-w-0', className)}>
      {label ? (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      ) : null}
      {name && <input type="hidden" name={name} value={selectedValue} />}
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative flex items-center w-full">
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={
                ariaLabel ?? (label ? `Select ${fallbackLabel}` : (placeholder ?? 'Select option'))
              }
              className={cn(
                'h-9 w-full justify-between rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium px-2.5 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=open]:border-primary/50 data-[state=open]:ring-2 data-[state=open]:ring-primary/20',
                !required && selectedValue ? 'pr-12' : 'pr-2.5',
                !selectedValue && 'text-muted-foreground'
              )}
            >
              <div className="flex items-center gap-2 min-w-0 truncate">
                <KindIcon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 transition-colors',
                    selectedValue ? 'text-primary' : 'text-muted-foreground/70'
                  )}
                  aria-hidden="true"
                />
                <span className={cn('truncate', !selectedValue && 'font-normal')}>
                  {displayLabel}
                </span>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1.5 transition-transform" />
            </Button>
          </PopoverTrigger>
          {!required && selectedValue && (
            <button
              type="button"
              onClick={handleClear}
              aria-label={label ? `Clear ${fallbackLabel} selection` : 'Clear selection'}
              className="absolute right-7 top-1/2 -translate-y-1/2 rounded-full p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground z-10 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <PopoverContent
          className="w-[280px] sm:w-[320px] p-1.5 rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl overflow-hidden"
          align="start"
        >
          <Command shouldFilter={false} className="bg-transparent">
            <div className="relative border-b border-border/60 pb-1.5 mb-1 px-1">
              <CommandInput
                placeholder={
                  label
                    ? `Search ${fallbackLabel}…`
                    : placeholder
                      ? `Search ${placeholder.toLowerCase()}…`
                      : 'Search…'
                }
                value={search}
                onValueChange={setSearch}
                className="h-8 text-xs rounded-lg"
              />
              {loading && (
                <Loader2 className="absolute right-2.5 top-2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <CommandList className="max-h-60 overflow-y-auto space-y-0.5">
              {error ? (
                <div className="p-3 text-xs text-destructive text-center">
                  Search unavailable. Try again.
                </div>
              ) : options.length === 0 && !loading ? (
                <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                  No matching {label ? fallbackLabel : 'options'} found.
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {!required && (
                    <CommandItem
                      value="__clear__"
                      onSelect={() => handleSelect('')}
                      className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors duration-150 hover:bg-muted/70 aria-selected:bg-primary/10 aria-selected:text-primary flex items-center gap-2"
                    >
                      <Check
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-opacity',
                          !selectedValue ? 'opacity-100 text-primary' : 'opacity-0'
                        )}
                      />
                      <span className="text-muted-foreground font-medium">
                        {required ? 'None' : 'All'}
                      </span>
                    </CommandItem>
                  )}
                  {options.map(option => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => handleSelect(option.value)}
                      className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors duration-150 hover:bg-muted/70 aria-selected:bg-primary/10 aria-selected:text-primary flex items-center gap-2"
                    >
                      <Check
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-opacity',
                          selectedValue === option.value ? 'opacity-100 text-primary' : 'opacity-0'
                        )}
                      />
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
