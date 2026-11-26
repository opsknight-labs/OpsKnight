import type { Prisma } from '@prisma/client';
import { aggregatePublicRegions } from './history';
import type { PublicStatusPageSnapshot } from './public-contract';

type Ref = { id: string };

/**
 * A business service published with `showMembers: false` shows visitors the group, not its
 * parts. The group row keeps its aggregate status, counts and uptime (computed before this
 * runs); this removes the member services themselves from every public surface that reads the
 * snapshot: the service list, per-region ids, incident/maintenance/announcement service
 * references and the group's member id list. A service another visible group (or no group)
 * still lists stays visible, and so does a service the admin published directly
 * (`directServiceIds`: StatusPageService rows with viaBusinessService = false): selecting it
 * explicitly is a decision the group's `showMembers` must not override.
 */
export function concealHiddenGroupMembers(
  snapshot: PublicStatusPageSnapshot,
  directServiceIds: ReadonlySet<string> = new Set()
): PublicStatusPageSnapshot {
  const groups = snapshot.businessServices;
  if (!groups?.some(group => group.showMembers === false)) return snapshot;
  const shown = new Set(
    groups.filter(group => group.showMembers !== false).flatMap(group => group.memberServiceIds)
  );
  const concealed = new Set(
    groups
      .filter(group => group.showMembers === false)
      .flatMap(group => group.memberServiceIds)
      .filter(id => !shown.has(id) && !directServiceIds.has(id))
  );
  if (!concealed.size) return snapshot;
  const keep = <T extends Ref>(refs: T[] | undefined) => {
    const kept = refs?.filter(ref => !concealed.has(ref.id));
    return kept?.length ? kept : undefined;
  };
  const withRefs = <T extends { affectedServices?: Ref[] }>(item: T): T => {
    const { affectedServices, ...rest } = item;
    const kept = keep(affectedServices as Array<Ref & { name: string }> | undefined);
    return (kept ? { ...rest, affectedServices: kept } : rest) as T;
  };
  const services = snapshot.services.filter(service => !concealed.has(service.id));
  return {
    ...snapshot,
    services,
    businessServices: groups.map(group =>
      group.showMembers === false ? { ...group, memberServiceIds: [] } : group
    ),
    regions: snapshot.regions ? aggregatePublicRegions(services) : snapshot.regions,
    incidents: snapshot.incidents.map(incident => {
      const id = incident.service?.id;
      if (!id || !concealed.has(id)) return incident;
      const { service: _service, ...rest } = incident;
      return rest;
    }),
    ...(snapshot.maintenance ? { maintenance: snapshot.maintenance.map(withRefs) } : {}),
    ...(snapshot.announcements ? { announcements: snapshot.announcements.map(withRefs) } : {}),
    ...(snapshot.changelog ? { changelog: snapshot.changelog.map(withRefs) } : {}),
  };
}

/** Services an admin published directly on this page (never only through a business service). */
export async function directlyPublishedServiceIds(
  db: Pick<Prisma.TransactionClient, 'statusPageService'>,
  pageId: string
): Promise<Set<string>> {
  const rows = await db.statusPageService.findMany({
    where: { statusPageId: pageId, viaBusinessService: false },
    select: { serviceId: true },
  });
  return new Set(rows.map(row => row.serviceId));
}

/**
 * Serve-time wrapper: only looks up the direct selections when some group actually hides its
 * members, so ordinary pages pay nothing.
 */
export async function concealForPage(
  db: Pick<Prisma.TransactionClient, 'statusPageService'>,
  pageId: string,
  snapshot: PublicStatusPageSnapshot
): Promise<PublicStatusPageSnapshot> {
  if (!snapshot.businessServices?.some(group => group.showMembers === false)) return snapshot;
  return concealHiddenGroupMembers(snapshot, await directlyPublishedServiceIds(db, pageId));
}

/** Same rule as above for readers that query the database instead of the snapshot. */
export async function concealedServiceIdsForPage(
  db: Pick<Prisma.TransactionClient, 'statusPageBusinessService' | 'statusPageService'>,
  page: { id: string; serviceLayout: string }
): Promise<Set<string>> {
  if (page.serviceLayout === 'FLAT') return new Set();
  const mappings = await db.statusPageBusinessService.findMany({
    where: { statusPageId: page.id, showOnPage: true },
    select: {
      showMembers: true,
      businessService: { select: { members: { select: { serviceId: true } } } },
    },
  });
  const ids = (shown: boolean) =>
    mappings
      .filter(mapping => mapping.showMembers === shown)
      .flatMap(mapping => mapping.businessService.members.map(member => member.serviceId));
  const visible = new Set(ids(true));
  const hidden = ids(false).filter(id => !visible.has(id));
  if (!hidden.length) return new Set();
  const direct = await directlyPublishedServiceIds(db, page.id);
  return new Set(hidden.filter(id => !direct.has(id)));
}
