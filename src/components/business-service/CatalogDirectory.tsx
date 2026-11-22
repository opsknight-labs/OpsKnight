'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (status, tier, urgency), never request input */

import Link from 'next/link';
import type { BusinessServiceTier } from '@prisma/client';
import { Boxes, Plus } from 'lucide-react';
import {
  DirectoryCardGrid,
  DirectoryHeader,
  DirectoryPrimaryCell,
  DirectoryTable,
  useDirectoryView,
  type DirectoryColumn,
} from '@/components/patterns/Directory';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import TablePaginationFooter from '@/components/ui/TablePaginationFooter';
import BusinessServiceFollowButton from '@/components/service/BusinessServiceFollowButton';
import type { BsStatus } from '@/lib/business-services/contract';
import HealthBadge, { CRITICALITY_HINT, CRITICALITY_LABEL } from './HealthBadge';

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

function Criticality({ tier }: { tier: BusinessServiceTier | null }) {
  if (!tier) return <span className="text-muted-foreground">Not set</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium text-foreground">{CRITICALITY_LABEL[tier]}</span>
      <span className="block text-xs text-muted-foreground">{CRITICALITY_HINT[tier]}</span>
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

const href = (row: CatalogRow) => `/services/business/${row.id}`;

const COLUMNS: readonly DirectoryColumn<CatalogRow>[] = [
  {
    id: 'name',
    header: 'Business service',
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
    cell: row => <HealthBadge status={row.status} since={row.since} variant="solid" />,
    className: 'min-w-[11rem]',
  },
  {
    id: 'criticality',
    header: 'Criticality',
    cell: row => <Criticality tier={row.criticality} />,
  },
  {
    id: 'owner',
    header: 'Owner team',
    cell: row =>
      row.ownerTeam ? (
        <span className="truncate">{row.ownerTeam.name}</span>
      ) : (
        <span className="text-muted-foreground">No owner</span>
      ),
  },
  {
    id: 'members',
    header: 'Services',
    cell: row => <Members row={row} />,
    className: 'text-right',
  },
  {
    id: 'incidents',
    header: 'Open incidents',
    cell: row => (
      <span className={row.openIncidentCount ? 'font-medium tabular-nums' : 'tabular-nums'}>
        {row.openIncidentCount.toLocaleString()}
      </span>
    ),
    className: 'text-right',
  },
  {
    id: 'followers',
    header: 'Followers',
    cell: row => <span className="tabular-nums">{row.followerCount.toLocaleString()}</span>,
    className: 'text-right',
  },
];

function MobileRow({ row }: { row: CatalogRow }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link
          href={href(row)}
          className="truncate font-medium text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.name}
        </Link>
        {row.criticality && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {CRITICALITY_LABEL[row.criticality]}
          </span>
        )}
      </div>
      <HealthBadge status={row.status} since={row.since} variant="solid" />
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
            className="hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.name}
          </Link>
        </h3>
        {row.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{row.description}</p>
        )}
      </div>
      <HealthBadge status={row.status} since={row.since} variant="solid" />
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
}: {
  rows: readonly CatalogRow[];
  pagination: CatalogPagination;
  filtered: boolean;
  clearHref: string;
  canManage: boolean;
}) {
  const [view, setView] = useDirectoryView('business-services');

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
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/services/business/new">
              <Plus className="h-4 w-4" aria-hidden />
              Create a business service
            </Link>
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <section
      aria-label="Business service directory"
      className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm"
    >
      <DirectoryHeader
        title="Business service directory"
        summary={
          rows.length
            ? `${plural(pagination.totalCount, 'business service')}${filtered ? ' match' : ''}`
            : undefined
        }
        view={rows.length ? { value: view, onChange: setView } : undefined}
      />
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
          mobileRow={row => <MobileRow row={row} />}
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
