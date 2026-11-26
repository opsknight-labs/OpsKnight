'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (tier, lifecycle), never request input */

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Input } from '@/components/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import { bulkEditAction } from '@/app/(app)/services/business/phase5b-actions';
import type { BulkItemResult } from '@/lib/business-services/bulk';
import { CRITICALITY_LABEL, LIFECYCLE_LABEL } from './HealthBadge';

const KEEP = '__keep__';
const CLEAR = '__clear__';
const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const LIFECYCLES = ['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED'] as const;
const tagList = (text: string) =>
  text
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);

function Pick({
  id,
  label,
  value,
  onChange,
  options,
  clearable,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  clearable?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP}>No change</SelectItem>
          {clearable && <SelectItem value={CLEAR}>Clear</SelectItem>}
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** One attribute menu on the bar: its button shows the pending change, the popover holds the control. */
function AttributeMenu({
  label,
  summary,
  children,
}: {
  label: string;
  /** The pending change, e.g. "Tier 1"; undefined when this attribute is left alone. */
  summary?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={summary ? 'secondary' : 'ghost'}
          className="h-8 gap-1 text-xs"
        >
          {label}
          {summary && <span className="max-w-[9rem] truncate font-normal">: {summary}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 space-y-2 p-3 text-sm">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Bulk change for the selected business services as a floating bar at the bottom of the viewport:
 * one menu per attribute, a dry-run preview in a popover, then apply.
 */
export default function BulkEditBar({
  ids,
  names,
  teams,
  onClear,
}: {
  ids: readonly string[];
  names: ReadonlyMap<string, string>;
  teams: ReadonlyArray<{ id: string; name: string }>;
  onClear: () => void;
}) {
  const router = useRouter();
  const [team, setTeam] = useState(KEEP);
  const [tier, setTier] = useState(KEEP);
  const [lifecycle, setLifecycle] = useState(KEEP);
  const [addTags, setAddTags] = useState('');
  const [removeTags, setRemoveTags] = useState('');
  const [slo, setSlo] = useState('');
  const [clearSlo, setClearSlo] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [results, setResults] = useState<{
    dryRun: boolean;
    items: BulkItemResult[];
    key: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const changes = () => {
    const sloValue = slo.trim() === '' ? undefined : Number(slo);
    return {
      ...(team !== KEEP ? { ownerTeamId: team === CLEAR ? null : team } : {}),
      ...(tier !== KEEP
        ? { criticality: tier === CLEAR ? null : (tier as (typeof TIERS)[number]) }
        : {}),
      ...(lifecycle !== KEEP ? { lifecycle: lifecycle as (typeof LIFECYCLES)[number] } : {}),
      ...(tagList(addTags).length ? { addTags: tagList(addTags) } : {}),
      ...(tagList(removeTags).length ? { removeTags: tagList(removeTags) } : {}),
      ...(clearSlo ? { sloTarget: null } : sloValue !== undefined ? { sloTarget: sloValue } : {}),
      ...(reviewed ? { markReviewed: true as const } : {}),
    };
  };

  // A preview only describes the selection and changes it was run for; any edit makes it stale.
  const currentKey = JSON.stringify([ids, changes()]);
  const freshPreview = results?.dryRun === true && results.key === currentKey;

  const run = (dryRun: boolean) => {
    const next = changes();
    if (!Object.keys(next).length) {
      setError('Choose at least one change.');
      setPreviewOpen(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await bulkEditAction({ ids: [...ids], changes: next, dryRun });
      if (!result.ok) {
        setError(result.error);
        setPreviewOpen(true);
        return;
      }
      setResults({ dryRun: result.dryRun, items: result.results, key: currentKey });
      setPreviewOpen(true);
      if (!result.dryRun) {
        notify.success(
          `Updated ${result.summary.ok} business service${result.summary.ok === 1 ? '' : 's'}${result.summary.failed ? `, ${result.summary.failed} failed` : ''}`
        );
        router.refresh();
        if (!result.summary.failed) onClear();
      }
    });
  };

  const teamName = teams.find(item => item.id === team)?.name;
  const tags = [
    ...tagList(addTags).map(tag => `+${tag}`),
    ...tagList(removeTags).map(tag => `−${tag}`),
  ];
  const showResults = results && (!results.dryRun || results.key === currentKey);

  return (
    <section
      aria-label="Bulk edit"
      className="fixed bottom-10 left-1/2 z-40 w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="mr-1 whitespace-nowrap font-medium tabular-nums">
          {ids.length} selected
          <span className="sr-only">, up to 100 at a time</span>
        </p>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <AttributeMenu
          label="Owner"
          summary={team === KEEP ? undefined : team === CLEAR ? 'Clear' : teamName}
        >
          <Pick
            id="bulk-team"
            label="Owner team"
            value={team}
            onChange={setTeam}
            clearable
            options={teams.map(item => ({ value: item.id, label: item.name }))}
          />
        </AttributeMenu>
        <AttributeMenu
          label="Criticality"
          summary={
            tier === KEEP
              ? undefined
              : tier === CLEAR
                ? 'Clear'
                : CRITICALITY_LABEL[tier as (typeof TIERS)[number]]
          }
        >
          <Pick
            id="bulk-tier"
            label="Criticality"
            value={tier}
            onChange={setTier}
            clearable
            options={TIERS.map(item => ({ value: item, label: CRITICALITY_LABEL[item] }))}
          />
        </AttributeMenu>
        <AttributeMenu
          label="Lifecycle"
          summary={
            lifecycle === KEEP
              ? undefined
              : LIFECYCLE_LABEL[lifecycle as (typeof LIFECYCLES)[number]]
          }
        >
          <Pick
            id="bulk-lifecycle"
            label="Lifecycle"
            value={lifecycle}
            onChange={setLifecycle}
            options={LIFECYCLES.map(item => ({ value: item, label: LIFECYCLE_LABEL[item] }))}
          />
        </AttributeMenu>
        <AttributeMenu
          label="SLO"
          summary={clearSlo ? 'Clear' : slo.trim() ? `${slo.trim()}%` : undefined}
        >
          <label htmlFor="bulk-slo" className="text-xs font-semibold">
            SLO target (%)
          </label>
          <Input
            id="bulk-slo"
            value={slo}
            disabled={clearSlo}
            onChange={event => setSlo(event.target.value)}
            inputMode="decimal"
            placeholder="No change"
            className="h-9"
          />
          <div className="flex items-center gap-2 text-xs">
            <Checkbox
              id="bulk-clear-slo"
              checked={clearSlo}
              onCheckedChange={checked => setClearSlo(checked === true)}
            />
            <label htmlFor="bulk-clear-slo">Clear SLO target</label>
          </div>
        </AttributeMenu>
        <AttributeMenu label="Tags" summary={tags.length ? tags.join(' ') : undefined}>
          <div className="space-y-1">
            <label htmlFor="bulk-add-tags" className="text-xs font-semibold">
              Add tags
            </label>
            <Input
              id="bulk-add-tags"
              value={addTags}
              onChange={event => setAddTags(event.target.value)}
              placeholder="payments, pci"
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bulk-remove-tags" className="text-xs font-semibold">
              Remove tags
            </label>
            <Input
              id="bulk-remove-tags"
              value={removeTags}
              onChange={event => setRemoveTags(event.target.value)}
              placeholder="legacy"
              className="h-9"
            />
          </div>
        </AttributeMenu>
        <div className="flex items-center gap-2 px-2 text-xs">
          <Checkbox
            id="bulk-reviewed"
            checked={reviewed}
            onCheckedChange={checked => setReviewed(checked === true)}
          />
          <label htmlFor="bulk-reviewed" className="whitespace-nowrap">
            Mark reviewed today
          </label>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={isPending}
                onClick={event => {
                  // Run the dry run instead of only toggling the popover; results open it.
                  event.preventDefault();
                  run(true);
                }}
              >
                Preview
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-80 p-3 text-xs">
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              {!error && !showResults && (
                <p className="text-muted-foreground">The changes were edited; preview again.</p>
              )}
              {!error && showResults && (
                <div role="status" className="space-y-1">
                  <p className="font-medium">
                    {results.dryRun ? 'Preview: ' : 'Result: '}
                    {results.items.filter(item => item.ok).length} ok,{' '}
                    {results.items.filter(item => !item.ok).length} failed
                  </p>
                  <ul className="max-h-48 space-y-0.5 overflow-auto">
                    {results.items.map(item => (
                      <li key={item.id} className="flex items-start gap-1.5">
                        {item.ok ? (
                          <Check
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-ok"
                            aria-hidden
                          />
                        ) : (
                          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                        )}
                        <span>
                          {names.get(item.id) ?? item.id}
                          {!item.ok && (
                            <span className="text-muted-foreground"> · {item.error}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={isPending || !freshPreview}
            title={freshPreview ? undefined : 'Preview these changes first'}
            onClick={() => run(false)}
          >
            Apply to {ids.length}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClear}
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
