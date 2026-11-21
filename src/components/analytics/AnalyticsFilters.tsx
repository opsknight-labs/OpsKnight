'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarRange,
  Check,
  ChevronsUpDown,
  GitCompare,
  Server,
  User,
  Users,
} from 'lucide-react';
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/shadcn/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  ANALYTICS_RANGES,
  hasActiveAnalyticsFilters,
  parseAnalyticsParams,
  toAnalyticsSearchParams,
  UNASSIGNED,
  type AnalyticsParams,
} from '@/lib/analytics/params';

type Option = { id: string; name: string };

const RANGE_LABELS: Record<(typeof ANALYTICS_RANGES)[number], string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '180d': '6 months',
  '365d': '12 months',
  '730d': '2 years',
  '1095d': '3 years',
};
const ALL = 'all';
const TRIGGER = 'h-9 w-full text-sm sm:w-[150px]';

function MultiSelect({
  label,
  icon,
  options,
  selected,
  onChange,
  allLabel,
  extra,
}: {
  label: string;
  icon: ReactNode;
  options: Option[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  extra?: Option[];
}) {
  const [open, setOpen] = useState(false);
  const all = [...(extra ?? []), ...options];
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (all.find(option => option.id === selected[0])?.name ?? '1 selected')
        : `${selected.length} selected`;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${label}: ${summary}`}
          className="h-9 w-full justify-between px-3 text-sm font-normal sm:w-[180px]"
        >
          <span className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="truncate">{summary}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} className="h-9 text-sm" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              No matches.
            </CommandEmpty>
            <CommandGroup>
              <CommandItem value={`__all ${allLabel}`} onSelect={() => onChange([])}>
                <span className="flex-1">{allLabel}</span>
                {selected.length === 0 && <Check className="h-4 w-4" aria-hidden />}
              </CommandItem>
              {all.map(option => (
                <CommandItem
                  key={option.id}
                  value={`${option.name} ${option.id}`}
                  onSelect={() => toggle(option.id)}
                  aria-selected={selected.includes(option.id)}
                >
                  <span className="flex-1 truncate">{option.name}</span>
                  {selected.includes(option.id) && <Check className="h-4 w-4" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CustomRange({
  params,
  onApply,
}: {
  params: AnalyticsParams;
  onApply: (from: string, to: string) => void;
}) {
  const day = (date?: Date) => date?.toISOString().slice(0, 10) ?? '';
  const inclusiveTo = params.to ? new Date(params.to.getTime() - 86_400_000) : undefined;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(day(params.from));
  const [to, setTo] = useState(day(inclusiveTo));
  const today = new Date().toISOString().slice(0, 10);
  const valid = Boolean(from && to && from <= to);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex">
          <FilterChip
            active={params.range === 'custom'}
            icon={<CalendarRange />}
            onClick={() => setOpen(value => !value)}
          >
            {params.range === 'custom' ? `${day(params.from)} → ${day(inclusiveTo)}` : 'Custom'}
          </FilterChip>
        </span>
      </PopoverAnchor>
      <PopoverContent className="w-72 space-y-3" align="start">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs font-medium">
            From
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={event => setFrom(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={event => setTo(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Dates are inclusive, up to 3 years.</p>
        <Button
          size="sm"
          className="w-full"
          disabled={!valid}
          onClick={() => {
            onApply(from, to);
            setOpen(false);
          }}
        >
          Apply range
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export default function AnalyticsFilters({
  teams,
  services,
  users,
  priorities,
  actions,
}: {
  teams: Option[];
  services: Option[];
  users: Option[];
  priorities: string[];
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const params = useMemo(() => parseAnalyticsParams(searchParams), [searchParams]);

  const navigate = (next: AnalyticsParams) => {
    const query = toAnalyticsSearchParams(next).toString();
    if (query === searchParams.toString()) return;
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    );
  };
  const update = (patch: Partial<AnalyticsParams>) => navigate({ ...params, ...patch });
  const setRange = (range: AnalyticsParams['range']) =>
    update({ range, from: undefined, to: undefined });

  const chips = (
    <>
      {ANALYTICS_RANGES.map(range => (
        <FilterChip key={range} active={params.range === range} onClick={() => setRange(range)}>
          {Object.entries(RANGE_LABELS).find(([key]) => key === range)?.[1]}
        </FilterChip>
      ))}
      <CustomRange
        key={`${params.from?.getTime()}-${params.to?.getTime()}`}
        params={params}
        onApply={(from, to) => {
          const next = parseAnalyticsParams({ from, to });
          if (next.range === 'custom') update({ range: 'custom', from: next.from, to: next.to });
        }}
      />
      <span aria-hidden className="mx-1 hidden h-4 w-px bg-border sm:block" />
      <FilterChip
        icon={<GitCompare />}
        active={params.compare}
        onClick={() => update({ compare: !params.compare })}
      >
        Compare to previous period
      </FilterChip>
    </>
  );

  const filters = (
    <>
      {teams.length > 0 && (
        <FilterField label="Teams">
          <MultiSelect
            label="Teams"
            icon={<Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            options={teams}
            selected={params.teams}
            onChange={ids => update({ teams: ids, services: [] })}
            allLabel="All teams"
          />
        </FilterField>
      )}
      <FilterField label="Services">
        <MultiSelect
          label="Services"
          icon={<Server className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          options={services}
          selected={params.services}
          onChange={ids => update({ services: ids })}
          allLabel="All services"
        />
      </FilterField>
      <FilterField label="Urgency" htmlFor="analytics-urgency">
        <Select
          value={params.urgency ?? ALL}
          onValueChange={value =>
            update({ urgency: value === ALL ? undefined : (value as AnalyticsParams['urgency']) })
          }
        >
          <SelectTrigger id="analytics-urgency" className={TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All urgency</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>
      <FilterField label="Status" htmlFor="analytics-status">
        <Select
          value={params.status ?? ALL}
          onValueChange={value =>
            update({ status: value === ALL ? undefined : (value as AnalyticsParams['status']) })
          }
        >
          <SelectTrigger id="analytics-status" className={TRIGGER}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="ACTIVE">Still active</SelectItem>
            <SelectItem value="OPEN">Triggered</SelectItem>
            <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
            <SelectItem value="SNOOZED">Snoozed</SelectItem>
            <SelectItem value="SUPPRESSED">Suppressed</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </FilterField>
    </>
  );

  const advanced = (
    <>
      {priorities.length > 0 && (
        <FilterField label="Priority">
          <MultiSelect
            label="Priority"
            icon={null}
            options={priorities.map(priority => ({ id: priority, name: priority }))}
            selected={params.priorities}
            onChange={ids => update({ priorities: ids })}
            allLabel="All priorities"
          />
        </FilterField>
      )}
      <FilterField label="Assignee">
        <MultiSelect
          label="Assignee"
          icon={<User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          options={users}
          extra={[{ id: UNASSIGNED, name: 'Unassigned' }]}
          selected={params.assignee ? [params.assignee] : []}
          // Single choice: the last one picked wins.
          onChange={ids => update({ assignee: ids.at(-1) })}
          allLabel="Anyone"
        />
      </FilterField>
    </>
  );

  return (
    <div aria-busy={isPending} className={isPending ? 'opacity-80 transition-opacity' : undefined}>
      <FilterBar
        chips={chips}
        filters={filters}
        advanced={advanced}
        advancedActiveCount={params.priorities.length + Number(Boolean(params.assignee))}
        hasActiveFilters={hasActiveAnalyticsFilters(params)}
        onClearAll={() =>
          navigate({
            ...parseAnalyticsParams({}),
            range: params.range,
            from: params.from,
            to: params.to,
            compare: params.compare,
          })
        }
        clearLabel="Clear filters"
        actions={actions}
      />
    </div>
  );
}
