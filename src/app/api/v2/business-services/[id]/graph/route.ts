import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { getServiceGraphForActor } from '@/lib/intelligence/dependencies/graph-view';

/**
 * The dependency graph around one business service: its members, supporting and parent business
 * services, and every service within `hops` dependency steps, with live health. Bounded to 500
 * services (`truncated` says when more exist) and filtered to what the caller can read.
 */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The graph loader filters services, business services and incidents to the actor's scope.
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({ hops: z.coerce.number().int().min(1).max(3).default(1) }).strict(),
  handler: async ({ actor, params, query }) => {
    const graph = await getServiceGraphForActor(actor, undefined, {
      focus: { kind: 'bs', id: params.id },
      hops: query.hops,
      access: 'service',
    });
    if (!graph?.businessServices.some(bs => bs.id === params.id))
      throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return {
      data: {
        businessServiceId: params.id,
        hops: query.hops,
        truncated: graph.truncated,
        businessServices: graph.businessServices.map(bs => ({
          id: bs.id,
          name: bs.name,
          criticality: bs.criticality,
          status: bs.status,
          openIncidentCount: bs.openIncidents,
          memberCount: bs.memberCount,
        })),
        services: graph.nodes.map(node => ({
          id: node.id,
          name: node.name,
          teamId: node.teamId,
          status: node.status,
          openIncidentCount: node.openIncidents,
        })),
        dependencies: graph.edges,
        members: graph.memberEdges,
        supports: graph.supportEdges,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
