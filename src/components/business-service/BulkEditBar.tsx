'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
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

/** Bulk change for the selected business services: preview first (dry run), then apply. */
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
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await bulkEditAction({ ids: [...ids], changes: next, dryRun });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setResults({ dryRun: result.dryRun, items: result.results, key: currentKey });
      if (!result.dryRun) {
        notify.success(
          `Updated ${result.summary.ok} business service${result.summary.ok === 1 ? '' : 's'}${result.summary.failed ? `, ${result.summary.failed} failed` : ''}`
        );
        router.refresh();
        if (!result.summary.failed) onClear();
      }
    });
  };

  return (
    <section aria-label="Bulk edit" className="space-y-3 border-b bg-muted/40 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {ids.length} selected
          <span className="ml-2 font-normal text-muted-foreground">up to 100 at a time</span>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onClear} className="gap-1">
          <X className="h-4 w-4" aria-hidden />
          Clear selection
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Pick
          id="bulk-team"
          label="Owner team"
          value={team}
          onChange={setTeam}
          clearable
          options={teams.map(item => ({ value: item.id, label: item.name }))}
        />
        <Pick
          id="bulk-tier"
          label="Criticality"
          value={tier}
          onChange={setTier}
          clearable
          options={TIERS.map(item => ({ value: item, label: item.replace('TIER_', 'Tier ') }))}
        />
        <Pick
          id="bulk-lifecycle"
          label="Lifecycle"
          value={lifecycle}
          onChange={setLifecycle}
          options={LIFECYCLES.map(item => ({ value: item, label: item }))}
        />
        <div className="space-y-1">
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
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={clearSlo}
              onChange={event => setClearSlo(event.target.checked)}
            />
            Clear SLO target
          </label>
        </div>
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
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={event => setReviewed(event.target.checked)}
          />
          Mark as reviewed today
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => run(true)}
        >
          Preview
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isPending || !freshPreview}
          title={freshPreview ? undefined : 'Preview these changes first'}
          onClick={() => run(false)}
        >
          Apply to {ids.length}
        </Button>
      </div>
      {results && (!results.dryRun || results.key === currentKey) && (
        <div role="status" className="space-y-1 text-xs">
          <p className="font-medium">
            {results.dryRun ? 'Preview: ' : 'Result: '}
            {results.items.filter(item => item.ok).length} ok,{' '}
            {results.items.filter(item => !item.ok).length} failed
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-auto">
            {results.items.map(item => (
              <li key={item.id} className="flex items-start gap-1.5">
                {item.ok ? (
                  <Check
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-operational"
                    aria-hidden
                  />
                ) : (
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                )}
                <span>
                  {names.get(item.id) ?? item.id}
                  {!item.ok && <span className="text-muted-foreground"> · {item.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
