import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiV2Error, apiV2Success, authenticateV2Request, enforceV2Authorization, enforceV2RateLimit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { incidentCorrelationHash, requireIncidentDiagnosticAccess } from '@/lib/api-v2/incident-diagnostics';
import { withV2Observability } from '@/lib/api-v2/observability';

const MAX_SOURCE_KEYS = 100;
const MAX_EVIDENCE = 500;
const MAX_RELATED = 50;

/** Links incidents through recorded alert deduplication keys, not title similarity. */
export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const { id } = await params;
    await requireIncidentDiagnosticAccess(actor, id);
    const sourceAlerts = await prisma.alert.findMany({
      where: { incidentId: id, dedupKey: { not: null } },
      select: { dedupKey: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_SOURCE_KEYS + 1,
    });
    const keys = [...new Set(sourceAlerts.slice(0, MAX_SOURCE_KEYS)
      .map(alert => alert.dedupKey).filter((key): key is string => Boolean(key)))];
    if (keys.length === 0) return apiV2Success({ incidentId: id, related: [],
      evidence: 'ALERT_DEDUP_KEY', truncated: { sourceKeys: sourceAlerts.length > MAX_SOURCE_KEYS, matches: false } },
    { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } });
    const matches = await prisma.alert.findMany({
      where: {
        dedupKey: { in: keys }, incidentId: { not: id },
        incident: { is: incidentReadWhere(actor) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MAX_EVIDENCE + 1,
      select: {
        id: true, dedupKey: true, createdAt: true,
        incident: { select: { id: true, title: true, status: true, serviceId: true, createdAt: true } },
      },
    });
    const related = new Map<string, {
      incident: NonNullable<(typeof matches)[number]['incident']>;
      matchedAt: Date;
      correlationHashes: string[];
    }>();
    for (const match of matches.slice(0, MAX_EVIDENCE)) {
      if (!match.incident || !match.dedupKey) continue;
      const hash = incidentCorrelationHash(match.dedupKey);
      const existing = related.get(match.incident.id);
      if (existing) {
        if (!existing.correlationHashes.includes(hash)) existing.correlationHashes.push(hash);
      } else {
        related.set(match.incident.id, {
          incident: match.incident, matchedAt: match.createdAt, correlationHashes: [hash],
        });
      }
    }
    return apiV2Success({
      incidentId: id, evidence: 'ALERT_DEDUP_KEY',
      related: [...related.values()].slice(0, MAX_RELATED),
      truncated: {
        sourceKeys: sourceAlerts.length > MAX_SOURCE_KEYS,
        matches: matches.length > MAX_EVIDENCE || related.size > MAX_RELATED,
      },
    }, { headers: { ...rlHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
