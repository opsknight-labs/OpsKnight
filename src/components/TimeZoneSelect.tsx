'use client';

import { useEffect, useState, useMemo } from 'react';
import { getAllTimeZones } from '@/lib/timezone';
import { Check, ChevronsUpDown, Globe2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Badge } from '@/components/ui/shadcn/badge';

type ZoneOption = ReturnType<typeof getAllTimeZones>[number];

type TimeZoneSelectProps = {
  name: string;
  defaultValue?: string;
  id?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
};

export default function TimeZoneSelect({
  name,
  defaultValue = 'UTC',
  id,
  disabled,
  onChange,
}: TimeZoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [search, setSearch] = useState('');

  const localTimeZone =
    typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC';

  const zones = useMemo(() => getAllTimeZones(), []);

  // Group timezones by region (e.g., America, Europe) and add a "Common" group
  const groupedTimeZones = useMemo(() => {
    const groups: Record<string, typeof zones> = {};

    zones.forEach(zone => {
      const parts = zone.value.split('/');
      const region = parts.length > 1 ? parts[0] : 'Others';
      if (!groups[region]) {
        groups[region] = [];
      }
      groups[region].push(zone);
    });

    // Sort regions alphabetically
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [zones]);

  const commonValues = Array.from(
    new Set([
      localTimeZone,
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Singapore',
      'Asia/Tokyo',
      'Asia/Kolkata',
      'Australia/Sydney',
    ])
  );

  const commonZones = useMemo(
    () =>
      commonValues
        .map(val => zones.find(z => z.value === val))
        .filter((z): z is (typeof zones)[number] => !!z),
    [commonValues, zones]
  );

  // Sync value if props change
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleSelect = (currentValue: string) => {
    setValue(currentValue);
    setOpen(false);
    if (onChange) {
      onChange(currentValue);
    }
  };

  // Find the label for the display button.
  // We flatten the groups again or simpler, just look it up.
  // Optimization: Just default to value if not found, but we want the nice label.
  const selectedLabel = useMemo(() => {
    for (const [_, zones] of groupedTimeZones) {
      const found = zones.find(z => z.value === value);
      if (found) return found.label;
    }
    return value;
  }, [groupedTimeZones, value]);

  const filteredCommon = useMemo(
    () => commonZones.filter(zone => matchesSearch(zone, search)),
    [commonZones, search]
  );

  const filteredGroups = useMemo(
    () =>
      groupedTimeZones
        .map(([region, z]) => [region, z.filter(zone => matchesSearch(zone, search))] as const)
        .filter(([, z]) => z.length > 0),
    [groupedTimeZones, search]
  );

  return (
    <div className="relative">
      {/* Hidden input for formData support */}
      <input type="hidden" name={name} value={value} id={id} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            disabled={disabled}
          >
            {value ? selectedLabel : 'Select timezone...'}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search city, country, or offset…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[320px]">
              <CommandEmpty>No timezone found.</CommandEmpty>
              {filteredCommon.length > 0 && (
                <CommandGroup heading="Common">
                  {filteredCommon.map(zone => (
                    <CommandItem
                      key={`common-${zone.value}`}
                      value={zone.value}
                      onSelect={() => handleSelect(zone.value)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === zone.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="flex flex-col items-start">
                        <span>{zone.label}</span>
                        {zone.description ? (
                          <span className="text-xs text-muted-foreground">{zone.description}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {filteredGroups.map(([region, zones]) => (
                <CommandGroup key={region} heading={region}>
                  {zones.map(zone => (
                    <CommandItem
                      key={zone.value}
                      value={zone.value}
                      onSelect={() => handleSelect(zone.value)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === zone.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex flex-col items-start gap-0.5">
                        <span>{zone.label}</span>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Globe2 className="h-3 w-3" />
                          <span className="truncate">{zone.description || zone.value}</span>
                          <Badge variant="outline" className="h-4 text-[11px] px-1 py-0">
                            {zone.offsetLabel}
                          </Badge>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function matchesSearch(zone: ZoneOption, rawQuery: string): boolean {
  const query = normalize(rawQuery);
  if (!query) return true;

  const tokens = [
    zone.value,
    zone.label,
    zone.description,
    zone.countryName,
    ...(zone.mainCities || []),
    ...(zone.keywords || []),
  ]
    .filter((token): token is string => Boolean(token))
    .map(normalize);

  const haystack = tokens.join(' ');

  // exact word match (avoids “Indian/” zones for query “india”)
  const wordBoundary = new RegExp(`\\b${escapeRegExp(query)}\\b`, 'i');
  if (wordBoundary.test(haystack)) return true;

  // short prefixes (<=4 chars) to support incremental typing like “kol” → Kolkata
  if (query.length <= 4 && tokens.some(t => t.startsWith(query))) return true;

  return false;
}

function escapeRegExp(str: string): string {
  // Escapes characters that have special meaning in RegExp charsets
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
