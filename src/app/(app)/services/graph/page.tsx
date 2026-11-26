import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Network, Server, TriangleAlert } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/patterns';
import ServiceGraphExplorer from '@/components/service-graph/ServiceGraphExplorer';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { actorHasCapability } from '@/lib/authorization-policy';
import { isEmbedEnabled } from '@/lib/intelligence/dependencies/insights/views';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import { teamReadWhere } from '@/lib/authorization-filters';
import {
  getIncidentScopeForActor,
  getServiceGraphForActor,
} from '@/lib/intelligence/dependencies/graph-view';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { parseGraphFocus, parseGraphHops, parseIncidentId } from '@/lib/service-graph/focus';

export const metadata: Metadata = { title: 'Service graph' };
export const dynamic = 'force-dynamic';

const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const STATUSES = [
  'OPERATIONAL',
  'UNKNOWN',
  'MAINTENANCE',
  'DEGRADED',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
] as const;

type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The dependency map: business services, technical services and how they depend on each other,
 * with live health. Focus mode (`?focus=bs:<id>` or `svc:<id>`) shows `hops` (default 2) around one node;
 * `?incident=<id>` scopes it to that incident's service (when the viewer may read the incident).
 */
export default async function ServiceGraphPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
}) {
  await requirePageAccess('/services/graph');
  const [actor, raw] = await Promise.all([getCurrentAuthorizationActor(), searchParams]);
  const incidentId = parseIncidentId(first(raw?.incident));
  const incident = incidentId ? await getIncidentScopeForActor(actor, incidentId) : null;
  const focus = incident
    ? ({ kind: 'svc', id: incident.serviceId } as const)
    : parseGraphFocus(first(raw?.focus));
  const hops = parseGraphHops(first(raw?.hops), incident ? 3 : 2);
  const [loaded, teams] = await Promise.all([
    getServiceGraphForActor(actor, prisma, { focus, hops, access: 'service' }),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ]);
  const graph = loaded && incident ? { ...loaded, incident } : loaded;
  // Mirrors assertCanModifyService: admins edit anything; other managers only services of teams
  // they belong to (the dragged-from, dependent service decides).
  const isAdmin = actor.role === 'ADMIN';
  const editableTeamIds = isAdmin ? null : [...actor.teamIds];
  const isInsightAdmin = actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE);
  const seesSuggestions = actorHasCapability(actor, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ);
  // Same gate as SquireMount: "Ask" shows only where the assistant is actually mounted.
  const squire = seesSuggestions ? await getAiPublicStatus().catch(() => null) : null;
  const viewer = {
    id: actor.id,
    isAdmin: isInsightAdmin,
    canOrgViews: actorHasCapability(actor, CAPABILITIES.OPERATIONS_MANAGE),
    seesSuggestions,
    embedEnabled: isInsightAdmin ? await isEmbedEnabled() : false,
    teams: teams.filter(team => actor.teamIds.includes(team.id)),
    squireName: squire?.squireEnabled ? squire.squireName : null,
  };
  const canEdit =
    hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE) &&
    (isAdmin || actor.teamIds.length > 0);
  const focusName = !graph
    ? null
    : focus?.kind === 'bs'
      ? (graph.businessServices.find(bs => bs.id === focus.id)?.name ?? null)
      : focus
        ? (graph.nodes.find(node => node.id === focus.id)?.name ?? null)
        : null;
  const impacted = graph
    ? [...graph.nodes, ...graph.businessServices].filter(
        node => node.status !== 'OPERATIONAL' && node.status !== 'UNKNOWN'
      ).length
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Infrastructure Directory"
        title="Service graph"
        description="How business services and technical services depend on each other, with live health."
        icon={Network}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          ...(focusName
            ? [{ label: 'Service graph', href: '/services/graph' }, { label: focusName }]
            : [{ label: 'Service graph' }]),
        ]}
        stats={
          graph
            ? [
                {
                  label: 'Business services',
                  value: graph.businessServices.length,
                  icon: <Boxes className="h-3.5 w-3.5" />,
                },
                {
                  label: 'Technical services',
                  value: graph.nodes.length,
                  icon: <Server className="h-3.5 w-3.5" />,
                },
                { label: 'Dependencies', value: graph.edges.length },
                {
                  label: 'Impacted now',
                  value: impacted,
                  icon: <TriangleAlert className="h-3.5 w-3.5" />,
                },
              ]
            : undefined
        }
      />
      {!graph ? (
        <EmptyState
          variant="card"
          title="The service graph is not available to you"
          description="Ask an administrator for access to the services you work on."
        />
      ) : graph.nodes.length === 0 && graph.businessServices.length === 0 && !focus ? (
        <EmptyState
          variant="card"
          icon={<Network className="h-6 w-6" aria-hidden="true" />}
          title="No services to map yet"
          description="Services you can access, and the dependencies between them, appear here."
          primaryAction={
            <Link className="underline" href="/services">
              Go to services
            </Link>
          }
        />
      ) : (
        <ServiceGraphExplorer
          graph={graph}
          teams={teams}
          canEdit={canEdit}
          editableTeamIds={editableTeamIds}
          focusName={focusName}
          incidentUnavailable={!!incidentId && !incident}
          hops={hops}
          viewer={viewer}
          initial={{
            q: first(raw?.q) ?? '',
            team: first(raw?.team) ?? '',
            impacted: first(raw?.impacted) === '1',
            view: first(raw?.view) === 'list' ? 'list' : 'graph',
            tier: TIERS.find(tier => tier === first(raw?.tier)) ?? '',
            status: STATUSES.find(status => status === first(raw?.status)) ?? '',
            origin:
              first(raw?.origin) === 'DECLARED' || first(raw?.origin) === 'OBSERVED'
                ? (first(raw?.origin) as 'DECLARED' | 'OBSERVED')
                : '',
            filterMode: first(raw?.filter) === '1',
            impact:
              first(raw?.impact) === 'blast' || first(raw?.impact) === 'root'
                ? (first(raw?.impact) as 'blast' | 'root')
                : null,
          }}
        />
      )}
    </div>
  );
}
