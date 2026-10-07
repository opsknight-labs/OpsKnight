'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchableRunbookSelectProps = {
  kind: 'service' | 'runbook' | 'agent' | 'target' | 'pool';
  label: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  className?: string;
  placeholder?: string;
};

type Option = { value: string; label: string };

export function SearchableRunbookSelect({
  kind,
  label,
  name,
  value,
  onChange,
  required = false,
  className,
  placeholder,
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

  const selectedOption = options.find(o => o.value === selectedValue);
  const displayLabel = selectedOption
    ? selectedOption.label
    : selectedValue
      ? selectedValue
      : (placeholder ?? (required ? `Select ${label.toLowerCase()}…` : `All ${label.toLowerCase()}`));

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
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {name && <input type="hidden" name={name} value={selectedValue} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={`Select ${label.toLowerCase()}`}
            className={cn(
              'h-9 w-full justify-between text-xs font-normal px-2.5',
              !selectedValue && 'text-muted-foreground'
            )}
          >
            <span className="truncate">{displayLabel}</span>
            <div className="flex items-center gap-1 shrink-0 ml-1.5">
              {!required && selectedValue && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={handleClear}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleClear(e as unknown as React.MouseEvent);
                    }
                  }}
                  className="rounded-full p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] sm:w-[320px] p-0" align="start">
          <Command shouldFilter={false}>
            <div className="relative border-b">
              <CommandInput
                placeholder={`Search ${label.toLowerCase()}…`}
                value={search}
                onValueChange={setSearch}
                className="h-9 text-xs"
              />
              {loading && (
                <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <CommandList className="max-h-60 overflow-y-auto">
              {error ? (
                <div className="p-3 text-xs text-destructive text-center">
                  Search unavailable. Try again.
                </div>
              ) : options.length === 0 && !loading ? (
                <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                  No matching {label.toLowerCase()} found.
                </CommandEmpty>
              ) : (
                <CommandGroup>
                  {!required && (
                    <CommandItem
                      value="__clear__"
                      onSelect={() => handleSelect('')}
                      className="text-xs cursor-pointer"
                    >
                      <Check
                        className={cn(
                          'mr-2 h-3.5 w-3.5',
                          !selectedValue ? 'opacity-100' : 'opacity-0'
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
                      className="text-xs cursor-pointer"
                    >
                      <Check
                        className={cn(
                          'mr-2 h-3.5 w-3.5 shrink-0',
                          selectedValue === option.value ? 'opacity-100' : 'opacity-0'
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
