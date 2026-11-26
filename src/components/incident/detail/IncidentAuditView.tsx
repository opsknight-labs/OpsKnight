'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Loader2, Plug, Sparkles } from 'lucide-react';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import {
  countAuditKinds,
  groupAuditTrail,
  type AuditActorKind,
  type AuditTrailRow,
} from '@/lib/incidents/audit-trail';
import { loadIncidentAuditAction } from '../audit-actions';

const CHIP =
  'inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-2xs font-semibold';

const KINDS: { kind: AuditActorKind; filter: string; chip: string }[] = [
  { kind: 'person', filter: 'People', chip: 'Person' },
  { kind: 'automation', filter: 'Automation', chip: 'Automation' },
  { kind: 'ai', filter: 'AI (Squire)', chip: 'Squire' },
  { kind: 'api', filter: 'API/MCP', chip: 'API' },
];

function KindChip({ row }: { row: AuditTrailRow }) {
  const label = KINDS.find(k => k.kind === row.kind)?.chip;
  return (
    <span className={cn(CHIP, toneClasses(row.kind === 'automation' ? 'info' : 'neutral').soft)}>
      {row.kind === 'ai' && <Sparkles className="h-3 w-3" aria-hidden />}
      {row.kind === 'api' && <Plug className="h-3 w-3" aria-hidden />}
      {row.kind === 'api' && row.source === 'MCP' ? 'MCP' : label}
    </span>
  );
}

/**
 * Who changed what on the incident: people, automation, Squire or API/MCP clients. Loaded through the
 * server action only when the view is opened, 30 rows at a time; needs the audit-log permission.
 */
export default function IncidentAuditView({ incidentId }: { incidentId: string }) {
  const { userTimeZone } = useTimezone();
  const [rows, setRows] = useState<AuditTrailRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [allowed, setAllowed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuditActorKind | 'all'>('all');
  const [pending, start] = useTransition();

  const load = (after: string | null) =>
    start(async () => {
      try {
        const page = await loadIncidentAuditAction(incidentId, after);
        if (!page.allowed) {
          setAllowed(false);
          return;
        }
        setRows(current => (after ? [...current, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
        setError(null);
      } catch {
        setError('Could not load the audit history. Try again.');
      } finally {
        setLoaded(true);
      }
    });

  useEffect(() => {
    load(null);
    // Load once per incident.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  const counts = useMemo(() => countAuditKinds(rows), [rows]);
  const groups = useMemo(
    () => groupAuditTrail(filter === 'all' ? rows : rows.filter(row => row.kind === filter)),
    [rows, filter]
  );

  if (!loaded)
    return (
      <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading audit history…
      </p>
    );
  if (!allowed)
    return (
      <p className="py-6 text-xs text-muted-foreground">
        Audit history needs the audit-log permission.
      </p>
    );
  if (error && rows.length === 0)
    return (
      <p role="alert" className="py-6 text-xs text-muted-foreground">
        {error}{' '}
        <button
          type="button"
          onClick={() => load(null)}
          className="font-medium text-primary hover:underline"
        >
          Retry
        </button>
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="py-6 text-xs text-muted-foreground">No audited changes on this incident yet.</p>
    );

  const filterChip = (key: AuditActorKind | 'all', label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      className={cn(
        'inline-flex h-6.5 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
        filter === key
          ? 'border-foreground bg-foreground font-semibold text-background'
          : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      )}
    >
      {label}
      {/* eslint-disable-next-line security/detect-object-injection -- key is one of the fixed filter names */}
      <span className="text-2xs font-semibold tabular-nums opacity-75">{counts[key]}</span>
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by actor">
        {filterChip('all', 'All')}
        {KINDS.map(k => filterChip(k.kind, k.filter))}
      </div>
      {groups.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">No loaded entries of this kind.</p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
          {groups.map(row => (
            <li key={row.id} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
              <span
                className="shrink-0 whitespace-nowrap font-mono text-2xs tabular-nums text-muted-foreground"
                title={
                  row.count > 1
                    ? `${formatDateTime(row.firstAt, userTimeZone, { format: 'datetime' })} – ${formatDateTime(row.at, userTimeZone, { format: 'datetime' })}`
                    : undefined
                }
                suppressHydrationWarning
              >
                {formatDateTime(row.at, userTimeZone, { format: 'datetime' })}
              </span>
              <KindChip row={row} />
              <span className="max-w-[40%] shrink-0 truncate text-xs font-medium text-foreground sm:max-w-48">
                {row.actor}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {row.count > 1 && (
                  <span className="font-semibold tabular-nums text-foreground">{row.count} × </span>
                )}
                {row.summary}
              </span>
              {row.source && (
                <span className="hidden shrink-0 text-2xs text-muted-foreground md:inline">
                  via {row.source}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          disabled={pending}
          onClick={() => load(cursor)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-2xs hover:bg-muted/60 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Load older entries
        </button>
      )}
    </div>
  );
}
