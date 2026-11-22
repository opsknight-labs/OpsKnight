import Link from 'next/link';
import { Megaphone, Wrench } from 'lucide-react';
import { RelativeTime } from '@/components/patterns';
import { toneClasses } from '@/components/patterns/status-tone';
import type { StatusBoardNotice, StatusBoardTile } from '@/lib/business-services/dashboards';
import { cn } from '@/lib/utils';
import HealthBadge, { BS_STATUS_META, CRITICALITY_LABEL, byWorstStatus } from './HealthBadge';
import { isImpacted } from './catalog-model';

const TIER_ORDER = { TIER_0: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 } as const;

/** Worst status first, then the most critical tier, then the board's own order. */
export function sortTiles(tiles: readonly StatusBoardTile[]): StatusBoardTile[] {
  return [...tiles].sort(
    (a, b) =>
      byWorstStatus(a.health, b.health) ||
      (a.criticality ? TIER_ORDER[a.criticality] : 4) -
        (b.criticality ? TIER_ORDER[b.criticality] : 4)
  );
}

function OverallBanner({ tiles }: { tiles: readonly StatusBoardTile[] }) {
  const impacted = tiles.filter(tile => isImpacted(tile.health.status));
  const maintenance = tiles.filter(tile => tile.health.status === 'MAINTENANCE').length;
  const worst = sortTiles(tiles)[0]?.health.status ?? 'OPERATIONAL';
  const meta =
    BS_STATUS_META[impacted.length ? worst : maintenance ? 'MAINTENANCE' : 'OPERATIONAL'];
  const Icon = meta.icon;
  const headline = impacted.length
    ? `${impacted.length} of ${tiles.length} business ${tiles.length === 1 ? 'service' : 'services'} impacted`
    : maintenance
      ? 'Operational, with maintenance in progress'
      : 'All business services are operational';
  return (
    <section
      aria-live="polite"
      aria-label="Overall status"
      className={cn(
        'flex items-center gap-3 rounded-lg border px-4 py-3',
        toneClasses(meta.tone).soft
      )}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{headline}</h2>
        {impacted.length > 0 && (
          <p className="text-xs opacity-90">
            Most affected:{' '}
            {impacted
              .slice(0, 3)
              .map(
                tile => `${tile.name} (${BS_STATUS_META[tile.health.status].label.toLowerCase()})`
              )
              .join(', ')}
            {impacted.length > 3 ? ` and ${impacted.length - 3} more` : ''}.
          </p>
        )}
      </div>
    </section>
  );
}

function Notices({ notices, now }: { notices: readonly StatusBoardNotice[]; now: Date }) {
  if (!notices.length) return null;
  return (
    <section aria-labelledby="board-notices" className="space-y-2">
      <h2
        id="board-notices"
        className="text-xs font-semibold uppercase tracking-wider text-ink-600"
      >
        Announcements and maintenance
      </h2>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {notices.map(notice => {
          const Icon = notice.kind === 'MAINTENANCE' ? Wrench : Megaphone;
          const upcoming = notice.startsAt.getTime() > now.getTime();
          return (
            <li key={`${notice.kind}-${notice.id}`} className="flex gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium text-foreground">{notice.title}</p>
                {notice.message && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{notice.message}</p>
                )}
                <p className="text-xs text-muted-foreground tabular-nums">
                  {notice.kind === 'MAINTENANCE' ? 'Maintenance' : 'Announcement'} ·{' '}
                  {upcoming ? 'starts ' : 'started '}
                  <RelativeTime date={notice.startsAt} />
                  {notice.endsAt && (
                    <>
                      {' '}
                      · ends <RelativeTime date={notice.endsAt} />
                    </>
                  )}
                  {notice.businessServiceNames.length > 0 &&
                    ` · ${notice.businessServiceNames.join(', ')}`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Tile({ tile, linkTiles }: { tile: StatusBoardTile; linkTiles: boolean }) {
  const { health } = tile;
  const tone = BS_STATUS_META[health.status].tone;
  const body = (
    <>
      <span
        aria-hidden
        data-status-rail
        className={cn('absolute inset-y-3 left-1.5 w-1 rounded-full', toneClasses(tone).solid)}
      />
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{tile.name}</h3>
        {tile.criticality && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {CRITICALITY_LABEL[tile.criticality]}
          </span>
        )}
      </div>
      <HealthBadge status={health.status} since={health.since} variant="solid" />
      <p className="text-xs text-muted-foreground tabular-nums">
        {health.impactedMemberCount > 0
          ? `${health.impactedMemberCount} of ${health.memberCount} services impacted`
          : `${health.memberCount} ${health.memberCount === 1 ? 'service' : 'services'}`}
        {health.openIncidentCount > 0 &&
          ` · ${health.openIncidentCount} open ${health.openIncidentCount === 1 ? 'incident' : 'incidents'}`}
      </p>
    </>
  );
  const frame =
    'relative flex h-full min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 pl-5 shadow-xs';
  return (
    <li>
      {linkTiles ? (
        <Link
          href={`/services/business/${tile.id}`}
          aria-label={`${tile.name}: ${BS_STATUS_META[health.status].label}`}
          className={cn(
            frame,
            'transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            toneClasses(tone).hoverBorder
          )}
        >
          {body}
        </Link>
      ) : (
        <div className={frame}>{body}</div>
      )}
    </li>
  );
}

/**
 * The internal status board: overall banner, live notices, then a tile per business service, worst
 * first. Shows status, since and counts only, so it is safe for stakeholders.
 */
export default function StatusBoard({
  tiles,
  notices,
  now,
  linkTiles = true,
}: {
  tiles: readonly StatusBoardTile[];
  notices: readonly StatusBoardNotice[];
  /** When the board was computed; decides "starts" vs "started" for notices. */
  now: Date;
  linkTiles?: boolean;
}) {
  const sorted = sortTiles(tiles);
  return (
    <div className="space-y-4 sm:space-y-6">
      <OverallBanner tiles={sorted} />
      <Notices notices={notices} now={now} />
      <section aria-labelledby="board-tiles" className="space-y-2">
        <h2
          id="board-tiles"
          className="text-xs font-semibold uppercase tracking-wider text-ink-600"
        >
          Business services
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {sorted.map(tile => (
            <Tile key={tile.id} tile={tile} linkTiles={linkTiles} />
          ))}
        </ul>
      </section>
    </div>
  );
}
