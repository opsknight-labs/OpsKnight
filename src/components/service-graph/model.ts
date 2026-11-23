/**
 * The graph page's view model: business services and technical services as one list of items, and
 * dependency, membership and support relations as links pointing from the dependent to what it
 * depends on. Pure, so the canvas, the list view and the tests share it.
 */
import type { BusinessServiceTier } from '@prisma/client';
import type { BsStatus, ImpactReason } from '@/lib/business-services/contract';
import type { ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';

export type GraphItem = {
  key: string;
  kind: 'bs' | 'svc';
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  status: BsStatus;
  openIncidents: number;
  reasons: ImpactReason[];
  criticality: BusinessServiceTier | null;
  memberCount: number | null;
};

export type GraphLink = {
  key: string;
  /** The dependent. */
  source: string;
  /** What it depends on. */
  target: string;
  kind: 'dependency' | 'member' | 'support';
  suggested: boolean;
  /** ServiceDependency id, for dependency links. */
  dependencyId: string | null;
  confidence: number | null;
};

export type GraphModel = { items: GraphItem[]; links: GraphLink[] };

export const bsKey = (id: string) => `bs:${id}`;
export const svcKey = (id: string) => `svc:${id}`;

export function buildGraphModel(view: ServiceGraphView): GraphModel {
  const items: GraphItem[] = [
    ...view.businessServices.map(bs => ({
      key: bsKey(bs.id),
      kind: 'bs' as const,
      id: bs.id,
      name: bs.name,
      teamId: bs.teamId,
      teamName: bs.teamName,
      status: bs.status,
      openIncidents: bs.openIncidents,
      reasons: bs.reasons,
      criticality: bs.criticality,
      memberCount: bs.memberCount,
    })),
    ...view.nodes.map(node => ({
      key: svcKey(node.id),
      kind: 'svc' as const,
      id: node.id,
      name: node.name,
      teamId: node.teamId,
      teamName: node.teamName,
      status: node.status,
      openIncidents: node.openIncidents,
      reasons: [],
      criticality: null,
      memberCount: null,
    })),
  ];
  const links: GraphLink[] = [
    ...view.edges.map(edge => ({
      key: `dep:${edge.id}`,
      source: svcKey(edge.downstreamServiceId),
      target: svcKey(edge.upstreamServiceId),
      kind: 'dependency' as const,
      suggested: edge.status === 'SUGGESTED',
      dependencyId: edge.id,
      confidence: edge.confidence,
    })),
    ...view.memberEdges.map(edge => ({
      key: `mem:${edge.businessServiceId}:${edge.serviceId}`,
      source: bsKey(edge.businessServiceId),
      target: svcKey(edge.serviceId),
      kind: 'member' as const,
      suggested: false,
      dependencyId: null,
      confidence: null,
    })),
    ...view.supportEdges.map(edge => ({
      key: `sup:${edge.parentId}:${edge.childId}`,
      source: bsKey(edge.parentId),
      target: bsKey(edge.childId),
      kind: 'support' as const,
      suggested: false,
      dependencyId: null,
      confidence: null,
    })),
  ];
  return { items, links };
}

export type GraphFilter = { query: string; teamId: string; impactedOnly: boolean };

/** Items that match the search, team and "impacted only" filters, and the links among them. */
export function filterGraph(model: GraphModel, filter: GraphFilter): GraphModel {
  const query = filter.query.trim().toLowerCase();
  const items = model.items.filter(
    item =>
      (!query ||
        item.name.toLowerCase().includes(query) ||
        (item.teamName ?? '').toLowerCase().includes(query)) &&
      (!filter.teamId || item.teamId === filter.teamId) &&
      (!filter.impactedOnly || (item.status !== 'OPERATIONAL' && item.status !== 'UNKNOWN'))
  );
  const keys = new Set(items.map(item => item.key));
  return {
    items,
    links: model.links.filter(link => keys.has(link.source) && keys.has(link.target)),
  };
}

/** The item and everything one link away in either direction. */
export function oneHop(links: readonly GraphLink[], key: string): Set<string> {
  const near = new Set([key]);
  for (const link of links) {
    if (link.source === key) near.add(link.target);
    if (link.target === key) near.add(link.source);
  }
  return near;
}

/** Above this many items the full view groups services by team. */
export const GROUP_THRESHOLD = 300;
