import { NextRequest, NextResponse } from 'next/server';
import { jsonOk } from '@/lib/api-response';
import { etagMatches, statusCacheControl, statusEtag } from '@/lib/status-pages/cache-policy';
import { getOpenStatusSnapshot, groupScope } from '@/lib/status-pages/public-access';

const notFound = () =>
  new NextResponse(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });

/**
 * One business service (group) of a public page: status, members, uptime, children and its
 * active incidents. Gated pages answer 404 exactly like the badge, so existence never leaks.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await context.params;
  const snapshot = await getOpenStatusSnapshot(slug);
  const scope = snapshot ? groupScope(snapshot, id) : null;
  if (!snapshot || !scope) return notFound();
  const { group } = scope;
  const headers = {
    'Cache-Control': statusCacheControl(snapshot.page),
    ETag: statusEtag([snapshot.page.id, snapshot.revision, 'group', id]),
  };
  if (etagMatches(req.headers.get('if-none-match'), headers.ETag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  const byId = new Map(snapshot.services.map(service => [service.id, service]));
  const members =
    group.showMembers === false
      ? []
      : group.memberServiceIds.flatMap(memberId => {
          const service = byId.get(memberId);
          // Deliberately no owner/team/meta fields: only what the public row already shows.
          return service
            ? [
                {
                  id: service.id,
                  name: service.name,
                  status: service.status,
                  ...(service.statusSince ? { statusSince: service.statusSince } : {}),
                  activeIncidentCount: service.activeIncidentCount,
                  ...(service.uptime ? { uptime: service.uptime } : {}),
                },
              ]
            : [];
        });
  const incidents = snapshot.incidents
    .filter(
      incident =>
        (incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED') &&
        ((incident.businessServices ?? []).some(item => scope.scope.some(g => g.id === item.id)) ||
          (incident.service?.id !== undefined && scope.memberIds.has(incident.service.id)))
    )
    .map(incident => ({
      id: incident.id ?? incident.publicEventId,
      title: incident.title,
      status: incident.status,
      publicImpact: incident.publicImpact,
      createdAt: incident.createdAt,
    }));
  return jsonOk(
    {
      id: group.id,
      name: group.name,
      description: group.description ?? null,
      status: group.status,
      ...(group.statusSince ? { statusSince: group.statusSince } : {}),
      parentId: group.parentId ?? null,
      childIds: group.childIds ?? [],
      members,
      activeIncidentCount: group.activeIncidentCount,
      impactedServiceCount: group.impactedServiceCount,
      ...(group.uptime ? { uptime: group.uptime } : {}),
      incidents,
      generatedAt: snapshot.generatedAt,
    },
    200,
    headers
  );
}
