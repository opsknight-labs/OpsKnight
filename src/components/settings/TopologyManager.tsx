'use client';

import { useActionState, useId } from 'react';
import {
  addTopologySourceAction,
  importCatalogAction,
  removeTopologySourceAction,
  setTopologySourceBusinessSyncAction,
  syncTopologySourceAction,
  type DependencyActionState,
} from '@/app/(app)/settings/intelligence/response/actions';
import { Button } from '@/components/ui/shadcn/button';
import { ActionMessage as Status, fieldClass } from '@/components/settings/form-kit';

const initial: DependencyActionState = { message: '', ok: false };

export function CatalogImportForm() {
  const [state, action, pending] = useActionState(importCatalogAction, initial);
  const id = useId();
  return (
    <form action={action} className="space-y-2 py-4">
      <label htmlFor={`${id}-catalog`} className="text-sm font-medium">
        Paste a Backstage catalog (YAML or JSON)
      </label>
      <textarea
        id={`${id}-catalog`}
        name="catalog"
        rows={6}
        required
        className={`${fieldClass} font-mono text-xs`}
        placeholder={
          'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: checkout\nspec:\n  dependsOn: [component:payments]'
        }
      />
      <p className="text-xs text-muted-foreground">
        Entities are matched to services by the{' '}
        <code className="rounded bg-muted px-1">opsknight.com/service-id</code> annotation or by
        exact name. Matched <code className="rounded bg-muted px-1">spec.dependsOn</code> entries
        become declared dependencies; nothing else is created.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Importing…' : 'Import now'}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function AddTopologySourceForm() {
  const [state, action, pending] = useActionState(addTopologySourceAction, initial);
  const id = useId();
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <input id={`${id}-name`} name="name" required maxLength={100} className={fieldClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-url`} className="text-sm font-medium">
          Catalog URL (https)
        </label>
        <input
          id={`${id}-url`}
          name="url"
          type="url"
          required
          maxLength={500}
          className={fieldClass}
          placeholder="https://backstage.example.com/api/catalog/entities?filter=kind=component"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-interval`} className="text-sm font-medium">
          Every (min)
        </label>
        <input
          id={`${id}-interval`}
          name="intervalMinutes"
          type="number"
          min={15}
          max={1440}
          defaultValue={60}
          className={fieldClass}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add source'}
      </Button>
      <BusinessSyncFields idPrefix={id} className="sm:col-span-4" />
      <div className="sm:col-span-4">
        <Status state={state} />
      </div>
    </form>
  );
}

/** The two business-service sync switches, shared by the add form and each source. */
function BusinessSyncFields({
  idPrefix,
  className,
  defaults,
}: {
  idPrefix: string;
  className?: string;
  defaults?: { syncBusinessServices: boolean; syncDomains: boolean };
}) {
  return (
    <fieldset className={className}>
      <legend className="sr-only">Business services</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <label htmlFor={`${idPrefix}-bs`} className="inline-flex items-center gap-2">
          <input
            id={`${idPrefix}-bs`}
            name="syncBusinessServices"
            type="checkbox"
            defaultChecked={defaults?.syncBusinessServices}
            className="h-4 w-4 rounded border-border"
          />
          Sync Systems as business services
        </label>
        <label htmlFor={`${idPrefix}-domains`} className="inline-flex items-center gap-2">
          <input
            id={`${idPrefix}-domains`}
            name="syncDomains"
            type="checkbox"
            defaultChecked={defaults?.syncDomains}
            className="h-4 w-4 rounded border-border"
          />
          Include Domains
        </label>
      </div>
    </fieldset>
  );
}

type BusinessSyncSummary = {
  status: 'OK' | 'FAILED';
  created: number;
  updated: number;
  removed: string[];
  skipped: string[];
  unmatched: string[];
  error?: string;
};

type SourceRow = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  intervalMinutes: number;
  syncBusinessServices: boolean;
  syncDomains: boolean;
  lastSyncedAt: Date | null;
  lastStatus: string | null;
  lastSummary: {
    matched: number;
    edgesDeclared: number;
    unmatched: string[];
    businessServices?: BusinessSyncSummary;
  } | null;
};

export function describeBusinessSync(summary: BusinessSyncSummary): string {
  if (summary.status === 'FAILED')
    return `business services not synced: ${summary.error ?? 'failed'}`;
  const parts = [`business services ${summary.created} created, ${summary.updated} updated`];
  if (summary.removed.length) parts.push(`${summary.removed.length} marked removed`);
  if (summary.skipped.length) parts.push(`${summary.skipped.length} owned by another source`);
  if (summary.unmatched.length) parts.push(`${summary.unmatched.length} references unmatched`);
  return parts.join(', ');
}

function BusinessSyncForm({ source }: { source: SourceRow }) {
  const [state, action, pending] = useActionState(setTopologySourceBusinessSyncAction, initial);
  const id = useId();
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={source.id} />
      <BusinessSyncFields idPrefix={id} defaults={source} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <Status state={state} />
    </form>
  );
}

function SourceActions({ id }: { id: string }) {
  const [syncState, sync, syncing] = useActionState(syncTopologySourceAction, initial);
  const [removeState, remove, removing] = useActionState(removeTopologySourceAction, initial);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={sync}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" variant="outline" disabled={syncing}>
          {syncing ? 'Queuing…' : 'Sync now'}
        </Button>
      </form>
      <form action={remove}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" variant="ghost" disabled={removing}>
          Remove
        </Button>
      </form>
      <Status state={syncState.message ? syncState : removeState} />
    </div>
  );
}

export function TopologySourceList({
  sources,
  canManage,
}: {
  sources: SourceRow[];
  canManage: boolean;
}) {
  if (sources.length === 0)
    return <p className="py-2 text-sm text-muted-foreground">No catalog sources yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {sources.map(source => (
        <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">{source.name}</p>
            <p className="truncate text-xs text-muted-foreground">{source.url}</p>
            <p className="text-xs text-muted-foreground">
              Every {source.intervalMinutes} min ·{' '}
              {source.lastSyncedAt
                ? `last sync ${source.lastSyncedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ${source.lastStatus ?? 'unknown'}`
                : 'not synced yet'}
              {source.lastSummary
                ? ` · ${source.lastSummary.matched} matched, ${source.lastSummary.edgesDeclared} edges declared${source.lastSummary.unmatched.length ? `, ${source.lastSummary.unmatched.length} unmatched` : ''}`
                : ''}
              {source.syncBusinessServices && source.lastSummary?.businessServices
                ? ` · ${describeBusinessSync(source.lastSummary.businessServices)}`
                : ''}
            </p>
            {canManage && <BusinessSyncForm source={source} />}
          </div>
          {canManage && <SourceActions id={source.id} />}
        </li>
      ))}
    </ul>
  );
}
