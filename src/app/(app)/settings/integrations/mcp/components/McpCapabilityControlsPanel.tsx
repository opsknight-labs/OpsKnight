'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Layers,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/shadcn/select';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import type { McpCapability, McpRisk } from '@/lib/mcp/catalog/capabilities';
import type { UpdateMcpCapabilitiesResult } from '../capability-actions';

const PAGE_SIZE = 25;
const DOMAIN_PREFIX = 'domain:';

// Brand typography; the stacks fall back to the app's bundled face where these are not installed.
const HEADING_FONT = "font-['Space_Grotesk',var(--font-manrope),system-ui,sans-serif]";
const BODY_FONT = "font-['Inter',var(--font-manrope),system-ui,sans-serif]";
// Small controls opt out of the page-wide compact-button padding (topbar.css, 1024–1600px) and the
// 44px touch minimum (globals.css); the whole labelled row is the touch target instead.
const COMPACT_CONTROL = 'ml-0 min-h-0 min-w-0 p-0';

const RISK: Record<McpRisk, { title: string; className: string }> = {
  R0: {
    title: 'Read only',
    className:
      'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-200',
  },
  R1: {
    title: 'Routine change',
    className:
      'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200',
  },
  R2: {
    title: 'Sensitive change',
    className:
      'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-500/50 dark:bg-orange-500/10 dark:text-orange-200',
  },
  R3: {
    title: 'Destructive or high-impact change',
    className:
      'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-200',
  },
};

const DOMAIN_LABELS: Record<string, string> = {
  mcp: 'Generic MCP tools',
  approvals: 'Approval workflow',
  prompts: 'Prompts',
};

function domainLabel(domain: string) {
  if (Object.hasOwn(DOMAIN_LABELS, domain))
    return DOMAIN_LABELS[domain as keyof typeof DOMAIN_LABELS];
  const words = domain.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindLabel(capability: McpCapability) {
  if (capability.kind === 'prompt') return 'Prompt';
  if (capability.kind === 'tool')
    return capability.domain === 'mcp' ? 'Generic tool' : 'Curated tool';
  return capability.curated ? 'Curated tool' : 'Catalog operation';
}

function Pill({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-4 tracking-wide',
        className
      )}
    >
      {children}
    </span>
  );
}

type Props = {
  capabilities: McpCapability[];
  initialDisabled: string[];
  action: (input: {
    disabled: string[];
    baseline: string[];
  }) => Promise<UpdateMcpCapabilitiesResult>;
};

export default function McpCapabilityControlsPanel({
  capabilities,
  initialDisabled,
  action,
}: Props) {
  const idPrefix = useId();
  const [baseline, setBaseline] = useState<string[]>(initialDisabled);
  const [entries, setEntries] = useState<Set<string>>(() => new Set(initialDisabled));
  const [query, setQuery] = useState('');
  const [onlyDisabled, setOnlyDisabled] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [selectedRisk, setSelectedRisk] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pages, setPages] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);

  type GroupItem = McpCapability & { searchText: string };

  const groups = useMemo(() => {
    const byDomain = new Map<string, GroupItem[]>();
    for (const capability of capabilities) {
      const list = byDomain.get(capability.domain) ?? [];
      const searchText =
        `${capability.id} ${capability.tool ?? ''} ${capability.domain} ${domainLabel(capability.domain)} ${capability.summary}`.toLowerCase();
      list.push({ ...capability, searchText });
      byDomain.set(capability.domain, list);
    }
    // Generic surfaces first: they gate everything else; then domains alphabetically.
    const first = ['mcp', 'approvals'];
    return [...byDomain.entries()]
      .map(([domain, items]) => ({
        domain,
        items: items.sort(
          (a, b) => Number(b.curated) - Number(a.curated) || a.id.localeCompare(b.id)
        ),
      }))
      .sort((a, b) => {
        const rank = (domain: string) =>
          first.includes(domain) ? first.indexOf(domain) : first.length;
        return (
          rank(a.domain) - rank(b.domain) ||
          domainLabel(a.domain).localeCompare(domainLabel(b.domain))
        );
      });
  }, [capabilities]);

  const isDisabled = useCallback(
    (capability: McpCapability) =>
      entries.has(capability.id) || entries.has(DOMAIN_PREFIX + capability.domain),
    [entries]
  );

  const exposedCount = useMemo(
    () => capabilities.filter(capability => !isDisabled(capability)).length,
    [capabilities, isDisabled]
  );

  const sortedEntries = useMemo(() => [...entries].sort(), [entries]);
  const dirty = useMemo(
    () =>
      sortedEntries.length !== baseline.length ||
      sortedEntries.some((entry, i) => entry !== baseline.at(i)),
    [sortedEntries, baseline]
  );

  const update = useCallback((mutate: (next: Set<string>) => void) => {
    setEntries(previous => {
      const next = new Set(previous);
      mutate(next);
      return next;
    });
    setStatus('idle');
  }, []);

  const setItem = useCallback(
    (capability: McpCapability, exposed: boolean, members: McpCapability[]) =>
      update(next => {
        const marker = DOMAIN_PREFIX + capability.domain;
        if (exposed) {
          // Re-enabling one item of a fully disabled group keeps the rest of the group disabled.
          if (next.delete(marker))
            for (const member of members) if (member.id !== capability.id) next.add(member.id);
          next.delete(capability.id);
        } else next.add(capability.id);
      }),
    [update]
  );

  const setGroup = useCallback(
    (domain: string, members: McpCapability[], exposed: boolean) =>
      update(next => {
        for (const member of members) next.delete(member.id);
        if (exposed) next.delete(DOMAIN_PREFIX + domain);
        else next.add(DOMAIN_PREFIX + domain);
      }),
    [update]
  );

  const toggleExpanded = useCallback((domain: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (!next.delete(domain)) next.add(domain);
      return next;
    });
  }, []);

  const deferredQuery = useDeferredValue(query);
  const needle = useMemo(() => deferredQuery.trim().toLowerCase(), [deferredQuery]);
  const filtering =
    needle.length > 0 || onlyDisabled || selectedDomain !== 'all' || selectedRisk !== 'all';

  const visibleGroups = useMemo(() => {
    return groups
      .filter(group => selectedDomain === 'all' || group.domain === selectedDomain)
      .map(group => ({
        ...group,
        matches: group.items.filter(
          capability =>
            (!onlyDisabled || isDisabled(capability)) &&
            (selectedRisk === 'all' || capability.risk === selectedRisk) &&
            (!needle || capability.searchText.includes(needle))
        ),
      }))
      .filter(group => !filtering || group.matches.length > 0);
  }, [groups, selectedDomain, selectedRisk, onlyDisabled, needle, filtering, isDisabled]);

  const matchCount = useMemo(
    () => visibleGroups.reduce((sum, group) => sum + group.matches.length, 0),
    [visibleGroups]
  );

  const allExpanded = groups.length > 0 && expanded.size === groups.length;
  const toggleAllExpanded = useCallback(() => {
    if (allExpanded) {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(groups.map(g => g.domain)));
    }
  }, [allExpanded, groups]);

  const allExposed = exposedCount === capabilities.length;
  const noneExposed = exposedCount === 0;
  const isCapabilitiesIndeterminate = !allExposed && !noneExposed;

  const capabilitiesMasterRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (capabilitiesMasterRef.current) {
      capabilitiesMasterRef.current.indeterminate = isCapabilitiesIndeterminate;
    }
  }, [isCapabilitiesIndeterminate]);

  const setAll = useCallback(
    (exposed: boolean) =>
      update(next => {
        next.clear();
        if (!exposed) {
          for (const group of groups) {
            next.add(DOMAIN_PREFIX + group.domain);
          }
        }
      }),
    [update, groups]
  );

  function save() {
    if (saving.current) return;
    saving.current = true;
    const disabled = [...entries].sort();
    startTransition(async () => {
      try {
        const result = await action({ disabled, baseline });
        if (result.ok) {
          setBaseline(result.disabled);
          setEntries(new Set(result.disabled));
          setStatus('saved');
          notify.success(
            result.added.length || result.removed.length
              ? 'Exposed capabilities saved'
              : 'No changes to save',
            { id: 'settings:mcp:capabilities' }
          );
        } else if (result.code === 'MCP_POLICY_CONFLICT') {
          setBaseline(result.disabled);
          setEntries(new Set(result.disabled));
          setStatus('error');
          notify.error(
            'Another administrator changed exposed capabilities. Their version is loaded; review it and make your change again.',
            { id: 'settings:mcp:capabilities' }
          );
        } else {
          setStatus('error');
          notify.error(
            `Unknown capabilities were not saved: ${result.invalid.join(', ')}. Reload the page.`,
            { id: 'settings:mcp:capabilities' }
          );
        }
      } catch (error) {
        setStatus('error');
        notify.error(error, { id: 'settings:mcp:capabilities' });
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <div className={BODY_FONT} aria-busy={pending}>
      <SettingsSection
        title="Exposed capabilities"
        description="Turn off anything assistants must never reach through MCP. This applies to every connection, whatever a user's role or consent allows, and takes effect on their next request."
        action={
          <p
            className={cn('text-sm tabular-nums text-muted-foreground', HEADING_FONT)}
            aria-live="polite"
          >
            <span className="text-base font-semibold text-foreground">{exposedCount}</span> of{' '}
            {capabilities.length} capabilities exposed
          </p>
        }
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            {dirty && !pending && (
              <span className="mr-auto text-sm text-muted-foreground">Unsaved changes</span>
            )}
            <SaveIndicator
              status={pending ? 'saving' : status}
              error={status === 'error' ? 'Capabilities were not saved.' : null}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-0"
              disabled={!dirty || pending}
              onClick={() => {
                setEntries(new Set(baseline));
                setStatus('idle');
              }}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              className="ml-0"
              disabled={!dirty || pending}
              onClick={save}
            >
              {pending ? 'Saving…' : 'Save capabilities'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 grow space-y-1.5">
              <label htmlFor={`${idPrefix}-search`} className="text-sm font-medium">
                Filter capabilities
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id={`${idPrefix}-search`}
                  type="search"
                  value={query}
                  maxLength={100}
                  placeholder="Search tool, operation, or domain..."
                  className="pl-9 pr-8 h-9 text-xs"
                  onChange={event => {
                    setQuery(event.target.value);
                    setPages({});
                  }}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setPages({});
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Domain Dropdown Filter with scrollable menu */}
            <div className="space-y-1.5 w-full sm:w-56">
              <label htmlFor={`${idPrefix}-domain-filter`} className="text-sm font-medium">
                Domain
              </label>
              <Select
                value={selectedDomain}
                onValueChange={val => {
                  setSelectedDomain(val);
                  setPages({});
                }}
              >
                <SelectTrigger
                  id={`${idPrefix}-domain-filter`}
                  className="h-9 w-full rounded-lg border-border/80 bg-background text-xs font-medium focus:ring-1 focus:ring-primary"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      {selectedDomain === 'all'
                        ? `All Domains (${groups.length})`
                        : domainLabel(selectedDomain)}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="max-h-60 w-64 overflow-y-auto overscroll-contain rounded-xl border-border/80 shadow-xl"
                >
                  <SelectGroup>
                    <SelectLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Capability Domains
                    </SelectLabel>
                    <SelectItem
                      value="all"
                      className="rounded-lg text-xs font-medium cursor-pointer"
                    >
                      All Domains ({capabilities.length})
                    </SelectItem>
                    {groups.map(g => (
                      <SelectItem
                        key={g.domain}
                        value={g.domain}
                        className="rounded-lg text-xs font-medium cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2 w-full">
                          <span>{domainLabel(g.domain)}</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {g.items.length}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Risk Level Dropdown Filter */}
            <div className="space-y-1.5 w-full sm:w-48">
              <label htmlFor={`${idPrefix}-risk-filter`} className="text-sm font-medium">
                Risk level
              </label>
              <Select
                value={selectedRisk}
                onValueChange={val => {
                  setSelectedRisk(val);
                  setPages({});
                }}
              >
                <SelectTrigger
                  id={`${idPrefix}-risk-filter`}
                  className="h-9 w-full rounded-lg border-border/80 bg-background text-xs font-medium focus:ring-1 focus:ring-primary"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      {selectedRisk === 'all'
                        ? 'All Risk Levels'
                        : `${selectedRisk} · ${RISK[selectedRisk as McpRisk]?.title ?? selectedRisk}`}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="max-h-60 w-60 overflow-y-auto overscroll-contain rounded-xl border-border/80 shadow-xl"
                >
                  <SelectGroup>
                    <SelectLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Risk Classification
                    </SelectLabel>
                    <SelectItem
                      value="all"
                      className="rounded-lg text-xs font-medium cursor-pointer"
                    >
                      All Risk Levels
                    </SelectItem>
                    <SelectItem
                      value="R0"
                      className="rounded-lg text-xs font-medium cursor-pointer"
                    >
                      R0 · Read only
                    </SelectItem>
                    <SelectItem
                      value="R1"
                      className="rounded-lg text-xs font-medium cursor-pointer"
                    >
                      R1 · Routine change
                    </SelectItem>
                    <SelectItem
                      value="R2"
                      className="rounded-lg text-xs font-medium cursor-pointer"
                    >
                      R2 · Sensitive change
                    </SelectItem>
                    <SelectItem
                      value="R3"
                      className="rounded-lg text-xs font-medium cursor-pointer"
                    >
                      R3 · Destructive or high-impact
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:pb-1">
              <label
                htmlFor={`${idPrefix}-capabilities-master-select`}
                className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-foreground select-none"
              >
                <input
                  ref={capabilitiesMasterRef}
                  id={`${idPrefix}-capabilities-master-select`}
                  type="checkbox"
                  checked={allExposed}
                  onChange={e => setAll(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-1 focus:ring-primary accent-primary cursor-pointer"
                />
                <span className="hidden sm:inline">
                  {allExposed ? 'All exposed' : noneExposed ? 'All disabled' : 'Select all'}
                </span>
                <span className="sm:hidden">All</span>
              </label>

              <div className="flex items-center gap-1 text-xs">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAll(true)}
                  disabled={allExposed}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  Select all
                </Button>
                <span className="text-border" aria-hidden="true">
                  •
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAll(false)}
                  disabled={noneExposed}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  Uncheck all
                </Button>
              </div>

              <div className="h-4 w-px bg-border/80 hidden lg:block" />

              <label
                htmlFor={`${idPrefix}-only-disabled`}
                className="flex cursor-pointer items-center gap-2 text-xs font-medium"
              >
                <Switch
                  id={`${idPrefix}-only-disabled`}
                  data-icon-button
                  className={COMPACT_CONTROL}
                  checked={onlyDisabled}
                  onCheckedChange={checked => {
                    setOnlyDisabled(checked);
                    setPages({});
                  }}
                />
                Show disabled only
              </label>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleAllExpanded}
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </Button>
            </div>
          </div>

          {filtering && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <p role="status" aria-live="polite">
                Showing <span className="font-semibold text-foreground">{matchCount}</span> of{' '}
                {capabilities.length} capabilities
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-primary"
                onClick={() => {
                  setQuery('');
                  setSelectedDomain('all');
                  setSelectedRisk('all');
                  setOnlyDisabled(false);
                  setPages({});
                }}
              >
                Reset all filters
              </Button>
            </div>
          )}

          {visibleGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No capabilities match this filter.
            </p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {visibleGroups.map(group => {
                const open = filtering || expanded.has(group.domain);
                const exposed = group.items.filter(capability => !isDisabled(capability)).length;
                const marked = entries.has(DOMAIN_PREFIX + group.domain);
                const pageCount = Math.max(1, Math.ceil(group.matches.length / PAGE_SIZE));
                const page = Math.min(pages[group.domain] ?? 0, pageCount - 1);
                const shown = group.matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
                const regionId = `${idPrefix}-${group.domain}-items`;
                const groupSwitchId = `${idPrefix}-${group.domain}-all`;
                const label = domainLabel(group.domain);
                return (
                  <div key={group.domain} role="group" aria-label={label}>
                    <div className="flex items-center gap-3 bg-muted/30 px-3 py-2.5 sm:gap-4 sm:px-4">
                      <button
                        type="button"
                        data-icon-button
                        aria-expanded={open}
                        aria-controls={regionId}
                        disabled={filtering}
                        onClick={() => toggleExpanded(group.domain)}
                        className="ml-0 flex min-w-0 grow items-center gap-2 rounded-md p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                      >
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                            !open && '-rotate-90'
                          )}
                          aria-hidden="true"
                        />
                        <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                          <span className={cn('truncate text-sm font-semibold', HEADING_FONT)}>
                            {label}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {exposed} of {group.items.length} exposed
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground mr-1">
                          <button
                            type="button"
                            onClick={() => setGroup(group.domain, group.items, true)}
                            disabled={exposed === group.items.length}
                            className="hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                          >
                            Select all
                          </button>
                          <span className="text-border">/</span>
                          <button
                            type="button"
                            onClick={() => setGroup(group.domain, group.items, false)}
                            disabled={exposed === 0}
                            className="hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                          >
                            Uncheck all
                          </button>
                        </div>
                        <label
                          htmlFor={groupSwitchId}
                          className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                        >
                          <span className="hidden md:inline">
                            {exposed === group.items.length
                              ? 'All on'
                              : exposed === 0
                                ? 'All off'
                                : 'Some off'}
                          </span>
                          <Switch
                            id={groupSwitchId}
                            data-icon-button
                            className={COMPACT_CONTROL}
                            checked={exposed === group.items.length}
                            aria-label={`Expose all ${label} capabilities`}
                            onCheckedChange={checked =>
                              setGroup(group.domain, group.items, checked)
                            }
                          />
                        </label>
                      </div>
                    </div>
                    {open && (
                      <div id={regionId}>
                        {marked && (
                          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground sm:px-4">
                            The whole group is off, including capabilities added to it in future
                            releases.
                          </p>
                        )}
                        <ul className="divide-y divide-border border-t border-border">
                          {shown.map(capability => {
                            const off = isDisabled(capability);
                            const switchId = `${idPrefix}-cap-${capability.id}`;
                            const risk = RISK[capability.risk];
                            return (
                              <li key={capability.id}>
                                <label
                                  htmlFor={switchId}
                                  className={cn(
                                    'flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-muted/40 sm:px-4',
                                    off && 'bg-muted/20'
                                  )}
                                >
                                  <span className="min-w-0 grow space-y-1">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      <code
                                        className={cn(
                                          'break-all font-mono text-[13px] font-medium',
                                          off &&
                                            'text-muted-foreground line-through decoration-muted-foreground/60'
                                        )}
                                      >
                                        {capability.kind === 'operation' && capability.tool
                                          ? capability.tool
                                          : capability.id}
                                      </code>
                                      <Pill
                                        className={risk.className}
                                        title={
                                          capability.read && capability.risk !== 'R0'
                                            ? 'Reviewed sensitive configuration read'
                                            : risk.title
                                        }
                                      >
                                        {capability.read
                                          ? `${capability.risk} ${capability.risk === 'R0' ? 'Read' : 'Sensitive read'}`
                                          : `${capability.risk} Change`}
                                      </Pill>
                                      <Pill
                                        className={
                                          capability.curated
                                            ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-200'
                                            : 'border-border bg-transparent text-muted-foreground'
                                        }
                                      >
                                        {kindLabel(capability)}
                                      </Pill>
                                      {capability.approval && (
                                        <Pill className="border-border bg-transparent text-muted-foreground">
                                          Needs approval
                                        </Pill>
                                      )}
                                    </span>
                                    <span className="block break-words text-xs text-muted-foreground">
                                      {capability.kind === 'operation' && capability.tool && (
                                        <>
                                          <span className="font-mono">{capability.id}</span>
                                          {' · '}
                                        </>
                                      )}
                                      {capability.summary}
                                    </span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2 pt-0.5">
                                    <span
                                      className={cn(
                                        'hidden w-7 text-right text-xs sm:inline',
                                        off ? 'text-muted-foreground' : 'text-foreground'
                                      )}
                                      aria-hidden="true"
                                    >
                                      {off ? 'Off' : 'On'}
                                    </span>
                                    <Switch
                                      id={switchId}
                                      data-icon-button
                                      className={COMPACT_CONTROL}
                                      checked={!off}
                                      aria-label={`Expose ${capability.tool ?? capability.id}`}
                                      onCheckedChange={checked =>
                                        setItem(capability, checked, group.items)
                                      }
                                    />
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        {pageCount > 1 && (
                          <nav
                            aria-label={`${label} pages`}
                            className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 sm:px-4"
                          >
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {page * PAGE_SIZE + 1}–
                              {Math.min((page + 1) * PAGE_SIZE, group.matches.length)} of{' '}
                              {group.matches.length}
                            </span>
                            <span className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                data-icon-button
                                className="ml-0 h-8 w-8"
                                disabled={page === 0}
                                aria-label={`Previous ${label} page`}
                                onClick={() =>
                                  setPages(previous => ({ ...previous, [group.domain]: page - 1 }))
                                }
                              >
                                <ChevronLeft aria-hidden="true" />
                              </Button>
                              <span className="px-1 text-xs tabular-nums text-muted-foreground">
                                {page + 1} / {pageCount}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                data-icon-button
                                className="ml-0 h-8 w-8"
                                disabled={page >= pageCount - 1}
                                aria-label={`Next ${label} page`}
                                onClick={() =>
                                  setPages(previous => ({ ...previous, [group.domain]: page + 1 }))
                                }
                              >
                                <ChevronRight aria-hidden="true" />
                              </Button>
                            </span>
                          </nav>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Turning off an operation removes its curated tool and hides it from search, describe,
            call_operation, plans and approvals; requests already approved are refused when
            committed. Capabilities also need the access switches above and each user&apos;s own
            permissions.
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
