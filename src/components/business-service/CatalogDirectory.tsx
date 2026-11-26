'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier, urgency), never request input */

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BusinessServiceTier } from '@prisma/client';
import { Boxes, Plus } from 'lucide-react';
import {
  DirectoryCardGrid,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  useDirectoryColumns,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns/Directory';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import TablePaginationFooter from '@/components/ui/TablePaginationFooter';
import BusinessServiceFollowButton from '@/components/service/BusinessServiceFollowButton';
import type { BsStatus } from '@/lib/business-services/contract';
import { HYGIENE_LABELS, type HygieneReason } from '@/lib/business-services/hygiene';
import { cn } from '@/lib/utils';
import BulkEditBar from './BulkEditBar';
import HealthBadge, { CRITICALITY_HINT, CRITICALITY_LABEL } from './HealthBadge';
import { catalogHref, catalogSort, type CatalogQuery } from './catalog-model';

export type CatalogRow = {
  id: string;
  name: string;
  description: string | null;
  criticality: BusinessServiceTier | null;
  ownerTeam: { id: string; name: string } | null;
  status: BsStatus;
  since: Date | null;
  memberCount: number;
  impactedMemberCount: number;
  openIncidentCount: number;
  followerCount: number;
  following: boolean;
  /** Ownership hygiene findings (stale review, inactive owner). */
  hygiene?: readonly HygieneReason[];
  /** Error budget left over the SLO window; null without an SLO target, undefined when not loaded. */
  budget?: { remainingPercent: number; burnState: 'OK' | 'AT_RISK' | 'BREACHED' } | null;
};

export type CatalogPagination = {
  page: number;
  pageSize: number;
  totalCount: number;
  prevHref?: string;
  nextHref?: string;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** One line: the tier label, with what it means as the tooltip. */
function Criticality({ tier }: { tier: BusinessServiceTier | null }) {
  if (!tier) return <span className="text-muted-foreground">Not set</span>;
  return (
    <span className="whitespace-nowrap font-medium text-foreground" title={CRITICALITY_HINT[tier]}>
      {CRITICALITY_LABEL[tier]}
    </span>
  );
}

/** Healthy rows stay quiet (soft pill, no "since"); impacted and maintenance rows get the solid pill. */
function Health({ row }: { row: CatalogRow }) {
  return row.status === 'OPERATIONAL' || row.status === 'UNKNOWN' ? (
    <HealthBadge status={row.status} />
  ) : (
    <HealthBadge status={row.status} since={row.since} variant="solid" />
  );
}

const BURN_TEXT = {
  OK: 'text-foreground',
  AT_RISK: 'text-status-elevated',
  BREACHED: 'text-status-critical',
} as const;

function Budget({ budget }: { budget: CatalogRow['budget'] }) {
  if (budget === undefined) return <span className="text-muted-foreground">—</span>;
  if (budget === null) return <span className="text-muted-foreground">No SLO</span>;
  return (
    <span className={cn('whitespace-nowrap tabular-nums', BURN_TEXT[budget.burnState])}>
      {budget.burnState === 'BREACHED'
        ? 'Spent'
        : `${Math.round(budget.remainingPercent).toLocaleString()}% left`}
    </span>
  );
}

function Members({ row }: { row: CatalogRow }) {
  return (
    <span className="tabular-nums">
      {row.memberCount.toLocaleString()}
      {row.impactedMemberCount > 0 && (
        <span className="block text-xs text-muted-foreground">
          {row.impactedMemberCount.toLocaleString()} impacted
        </span>
      )}
    </span>
  );
}

function HygieneBadges({ reasons }: { reasons?: readonly HygieneReason[] }) {
  if (!reasons?.length) return <span className="text-muted-foreground">Clean</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map(reason => (
        <span
          key={reason}
          className="whitespace-nowrap rounded-full border border-status-elevated/40 bg-status-elevated/10 px-2 py-0.5 text-xs font-medium text-status-elevated"
        >
          {HYGIENE_LABELS[reason]}
        </span>
      ))}
    </span>
  );
}

const href = (row: CatalogRow) => `/services/business/${row.id}`;

const COLUMNS: readonly DirectoryColumn<CatalogRow>[] = [
  {
    id: 'name',
    header: 'Business service',
    sortKey: 'name',
    cell: row => (
      <DirectoryPrimaryCell
        href={href(row)}
        title={row.name}
        subtitle={row.description ?? undefined}
      />
    ),
    className: 'min-w-[14rem]',
  },
  {
    id: 'health',
    header: 'Health',
    sortKey: 'health',
    cell: row => <Health row={row} />,
    className: 'min-w-[11rem] font-normal',
  },
  {
    id: 'criticality',
    header: 'Criticality',
    sortKey: 'tier',
    hideable: true,
    cell: row => <Criticality tier={row.criticality} />,
    // Global `table td` is 600; DESIGN.md wants 400 for secondary cells.
    className: 'font-normal',
  },
  {
    id: 'owner',
    header: 'Owner team',
    sortKey: 'owner',
    hideable: true,
    cell: row =>
      row.ownerTeam ? (
        <span className="truncate">{row.ownerTeam.name}</span>
      ) : (
        <span className="text-muted-foreground">No owner</span>
      ),
    className: 'font-normal',
  },
  {
    id: 'budget',
    header: 'Error budget',
    label: 'Error budget (SLO)',
    sortKey: 'budget',
    hideable: true,
    cell: row => <Budget budget={row.budget} />,
    className: 'font-normal',
  },
  {
    id: 'members',
    header: 'Services',
    hideable: true,
    cell: row => <Members row={row} />,
    className: 'text-right font-normal',
  },
  {
    id: 'incidents',
    header: 'Open incidents',
    sortKey: 'incidents',
    hideable: true,
    cell: row => (
      <span className={row.openIncidentCount ? 'font-medium tabular-nums' : 'tabular-nums'}>
        {row.openIncidentCount.toLocaleString()}
      </span>
    ),
    className: 'text-right font-normal',
  },
  {
    id: 'hygiene',
    header: 'Hygiene',
    hideable: true,
    cell: row => <HygieneBadges reasons={row.hygiene} />,
    className: 'font-normal',
  },
  {
    id: 'followers',
    header: 'Followers',
    hideable: true,
    cell: row => <span className="tabular-nums">{row.followerCount.toLocaleString()}</span>,
    className: 'text-right font-normal',
  },
];

function MobileRow({ row }: { row: CatalogRow }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link
          href={href(row)}
          className="truncate font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.name}
        </Link>
        {row.criticality && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {CRITICALITY_LABEL[row.criticality]}
          </span>
        )}
      </div>
      <Health row={row} />
      <p className="text-xs text-muted-foreground tabular-nums">
        {[
          plural(row.memberCount, 'service'),
          row.impactedMemberCount ? `${row.impactedMemberCount} impacted` : null,
          plural(row.openIncidentCount, 'open incident'),
          row.ownerTeam?.name,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

function Card({ row }: { row: CatalogRow }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 transition-colors duration-150 hover:bg-muted/40">
      <div className="min-w-0 space-y-1">
        <h3 className="truncate text-sm font-semibold">
          <Link
            href={href(row)}
            className="hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.name}
          </Link>
        </h3>
        {row.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{row.description}</p>
        )}
      </div>
      <Health row={row} />
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Services</dt>
          <dd className="font-medium tabular-nums">
            {row.memberCount}
            {row.impactedMemberCount > 0 && (
              <span className="font-normal text-muted-foreground">
                {' '}
                · {row.impactedMemberCount} impacted
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Open incidents</dt>
          <dd className="font-medium tabular-nums">{row.openIncidentCount}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Criticality</dt>
          <dd className="font-medium">
            {row.criticality ? CRITICALITY_LABEL[row.criticality] : 'Not set'}
          </dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
        <span className="truncate text-xs text-muted-foreground">
          {row.ownerTeam ? row.ownerTeam.name : 'No owner'} ·{' '}
          <span className="tabular-nums">{plural(row.followerCount, 'follower')}</span>
        </span>
        <BusinessServiceFollowButton id={row.id} name={row.name} following={row.following} />
      </div>
    </article>
  );
}

/** Directory card of the business-service catalog: table or cards, keyset pages, empty states. */
export default function CatalogDirectory({
  rows,
  pagination,
  filtered,
  clearHref,
  canManage,
  teams = [],
  query,
  refresh,
}: {
  rows: readonly CatalogRow[];
  pagination: CatalogPagination;
  filtered: boolean;
  clearHref: string;
  canManage: boolean;
  /** Owner-team choices for the bulk edit bar. */
  teams?: ReadonlyArray<{ id: string; name: string }>;
  /** Current catalog query; when given, column headers sort on the server through the URL. */
  query?: CatalogQuery;
  /** "Updated … ago" and pause control, shown in the directory header. */
  refresh?: ReactNode;
}) {
  const router = useRouter();
  const [view, setView] = useDirectoryView('business-services');
  const columns = useDirectoryColumns('business-services', COLUMNS, ['hygiene', 'followers']);
  const [picked, setSelected] = useState<ReadonlySet<string>>(new Set());
  const pageIds = rows.map(row => row.id);
  // Only ids on the visible page count: a page/filter change or the cards view (no checkboxes) must not leave a bulk bar targeting hidden rows.
  const selected: ReadonlySet<string> =
    view === 'cards' ? new Set() : new Set(pageIds.filter(id => picked.has(id)));
  const allSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const toggle = (id: string, checked: boolean) =>
    setSelected(() => {
      const next = new Set(selected);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const empty = filtered ? (
    <EmptyState
      variant="simple"
      icon={<Boxes className="h-6 w-6" aria-hidden />}
      title="No business services match these filters"
      description="Try another status, tier or team, or clear the filters to see every business service."
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={clearHref}>Clear filters</Link>
        </Button>
      }
    />
  ) : (
    <EmptyState
      variant="simple"
      icon={<Boxes className="h-6 w-6" aria-hidden />}
      title="No business services yet"
      description="A business service names something customers rely on, like Checkout or Payments, and the technical services behind it. Its health follows their incidents."
      action={
        canManage ? (
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/services/business/new">
                <Plus className="h-4 w-4" aria-hidden />
                Create a business service
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/services/business/setup">Guided setup</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/services/business/templates">Start from a template</Link>
            </Button>
          </div>
        ) : undefined
      }
    />
  );

  return (
    <section
      aria-label="Business service directory"
      className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xs"
    >
      <DirectoryHeader
        title="Business service directory"
        summary={
          rows.length
            ? `${plural(pagination.totalCount, 'business service')}${filtered ? ' match' : ''}`
            : undefined
        }
        view={rows.length ? { value: view, onChange: setView } : undefined}
        columns={rows.length && view !== 'cards' ? columns : undefined}
        density={rows.length > 0 && view !== 'cards'}
        actions={refresh}
        selectAll={
          canManage && rows.length && view !== 'cards'
            ? {
                checked: allSelected,
                indeterminate: !allSelected && pageIds.some(id => selected.has(id)),
                onCheckedChange: checked =>
                  setSelected(checked ? new Set(pageIds.slice(0, 100)) : new Set()),
                label: 'Select page',
              }
            : undefined
        }
      />
      {canManage && selected.size > 0 && (
        <BulkEditBar
          ids={[...selected]}
          names={new Map(rows.map(row => [row.id, row.name]))}
          teams={teams}
          onClear={() => setSelected(new Set())}
        />
      )}
      {rows.length === 0 ? (
        <div className="p-6">{empty}</div>
      ) : view === 'cards' ? (
        <DirectoryCardGrid>
          {rows.map(row => (
            <Card key={row.id} row={row} />
          ))}
        </DirectoryCardGrid>
      ) : (
        <DirectoryTable
          label="Business services"
          rows={rows}
          getRowId={row => row.id}
          columns={COLUMNS}
          hiddenColumns={columns.hidden}
          {...(query
            ? {
                sort: catalogSort(query.sort),
                onSortChange: (next: { key: string; direction: 'asc' | 'desc' }) =>
                  router.push(catalogHref({ ...query, sort: `${next.key}_${next.direction}` })),
              }
            : {})}
          mobileRow={row => <MobileRow row={row} />}
          selection={
            canManage
              ? {
                  selected,
                  onToggle: toggle,
                  rowLabel: row => `Select ${row.name}`,
                }
              : undefined
          }
          rowActions={row => (
            <BusinessServiceFollowButton id={row.id} name={row.name} following={row.following} />
          )}
        />
      )}
      {rows.length > 0 && (
        <nav aria-label="Business service pages">
          <TablePaginationFooter {...pagination} />
        </nav>
      )}
    </section>
  );
}
