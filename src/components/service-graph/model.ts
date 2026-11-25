/**
 * The graph page's view model: business services and technical services as one list of items, and
 * dependency, membership and support relations as links pointing from the dependent to what it
 * depends on. Pure, so the canvas, the list view and the tests share it.
 */
import type { BusinessServiceTier } from '@prisma/client';
import { STATUS_PALETTE } from '@/lib/design/status-palette';
import type { BsStatus, ImpactReason } from '@/lib/business-services/contract';
import type { GraphStatuses, ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';

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
  /** Flagged by the single-points-of-failure panel; drawn with a badge. */
  spof?: boolean;
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
  /** Dependency links only. */
  origin?: 'DECLARED' | 'OBSERVED' | null;
  dependencyType?: 'HARD' | 'SOFT' | null;
  note?: string | null;
  criticality?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  evidence?: string | null;
  /** Latest measured traffic; absent when no integration pushes stats for this edge. */
  traffic?: { requestRate: number; errorRate: number; windowStart: string } | null;
  /** Set while the Changes panel highlights what moved since a past date. */
  diff?: 'added' | 'removed';
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
      reasons: node.reasons ?? [],
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
      origin: edge.origin,
      dependencyType: edge.dependencyType ?? 'HARD',
      note: edge.note ?? null,
      criticality: edge.criticality ?? null,
      evidence: edge.evidence ?? null,
      traffic: edge.traffic ?? null,
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

export type GraphFilter = {
  query: string;
  teamId: string;
  impactedOnly: boolean;
  /** Business-service tiers to keep (technical services are not tiered and always stay). */
  tiers?: readonly BusinessServiceTier[];
  statuses?: readonly BsStatus[];
  /** Keep only dependency links of this origin. */
  origin?: 'DECLARED' | 'OBSERVED' | '';
};

const nameMatches = (item: GraphItem, query: string) =>
  item.name.toLowerCase().includes(query) || (item.teamName ?? '').toLowerCase().includes(query);

/** Items that match the search, team, tier, status and "impacted only" filters, and the links among them. */
export function filterGraph(model: GraphModel, filter: GraphFilter): GraphModel {
  const query = filter.query.trim().toLowerCase();
  const items = model.items.filter(
    item =>
      (!query || nameMatches(item, query)) &&
      (!filter.teamId || item.teamId === filter.teamId) &&
      (!filter.impactedOnly || (item.status !== 'OPERATIONAL' && item.status !== 'UNKNOWN')) &&
      (!filter.tiers?.length ||
        item.kind === 'svc' ||
        (item.criticality !== null && filter.tiers.includes(item.criticality))) &&
      (!filter.statuses?.length || filter.statuses.includes(item.status))
  );
  const keys = new Set(items.map(item => item.key));
  return {
    items,
    links: model.links.filter(
      link =>
        keys.has(link.source) &&
        keys.has(link.target) &&
        (!filter.origin || link.kind !== 'dependency' || link.origin === filter.origin)
    ),
  };
}

/** Keys of the items matching a search (name or team), in model order; empty for a blank query. */
export function matchItems(items: readonly GraphItem[], rawQuery: string): string[] {
  const query = rawQuery.trim().toLowerCase();
  return query ? items.filter(item => nameMatches(item, query)).map(item => item.key) : [];
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

export type ImpactMode = 'blast' | 'root';

export type ImpactSubgraph = {
  /** The start and everything reached. */
  keys: Set<string>;
  /** Links walked to reach them. */
  linkKeys: Set<string>;
  /** Hops from the start. */
  depth: Map<string, number>;
};

/**
 * Impact propagation from one node, transitively and cycle-safe. `blast` follows links backwards, to
 * everything that depends on the node (who is hurt if it fails); `root` follows them forwards, to
 * everything it depends on (where its trouble may come from). Business services are included, since
 * membership and support links point at what they rely on.
 */
export function impactSubgraph(
  links: readonly GraphLink[],
  start: string,
  mode: ImpactMode,
  maxDepth = Number.POSITIVE_INFINITY
): ImpactSubgraph {
  const adjacent = new Map<string, GraphLink[]>();
  for (const link of links) {
    const from = mode === 'root' ? link.source : link.target;
    const list = adjacent.get(from);
    if (list) list.push(link);
    else adjacent.set(from, [link]);
  }
  const depth = new Map<string, number>([[start, 0]]);
  const linkKeys = new Set<string>();
  let frontier = [start];
  for (let step = 1; frontier.length && step <= maxDepth; step += 1) {
    const next: string[] = [];
    for (const key of frontier)
      for (const link of adjacent.get(key) ?? []) {
        linkKeys.add(link.key);
        const other = mode === 'root' ? link.target : link.source;
        if (depth.has(other)) continue;
        depth.set(other, step);
        next.push(other);
      }
    frontier = next;
  }
  return { keys: new Set(depth.keys()), linkKeys, depth };
}

/**
 * Shortest chain of links between two nodes. Follows the dependency direction first (either way
 * round), and only if neither connects them falls back to ignoring direction.
 */
export function findPath(
  links: readonly GraphLink[],
  from: string,
  to: string
): { keys: string[]; linkKeys: string[] } | null {
  if (from === to) return { keys: [from], linkKeys: [] };
  const search = (step: (link: GraphLink, at: string) => string | null, a: string, b: string) => {
    const parent = new Map<string, { key: string; link: string }>();
    const seen = new Set([a]);
    let frontier = [a];
    while (frontier.length) {
      const next: string[] = [];
      for (const at of frontier)
        for (const link of links) {
          const other = step(link, at);
          if (other === null || seen.has(other)) continue;
          seen.add(other);
          parent.set(other, { key: at, link: link.key });
          if (other === b) {
            const keys = [b];
            const linkKeys: string[] = [];
            for (let hop = parent.get(b); hop; hop = parent.get(hop.key)) {
              keys.unshift(hop.key);
              linkKeys.unshift(hop.link);
            }
            return { keys, linkKeys };
          }
          next.push(other);
        }
      frontier = next;
    }
    return null;
  };
  const forward = (link: GraphLink, at: string) => (link.source === at ? link.target : null);
  const backward = (link: GraphLink, at: string) => (link.target === at ? link.source : null);
  const either = (link: GraphLink, at: string) =>
    link.source === at ? link.target : link.target === at ? link.source : null;
  return search(forward, from, to) ?? search(backward, from, to) ?? search(either, from, to);
}

const IMPACTED: ReadonlySet<BsStatus> = new Set(['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE']);

/** The status an edge shows when what it points at (the dependency) is itself impacted. */
export function edgeImpactStatus(
  link: GraphLink,
  byKey: ReadonlyMap<string, GraphItem>
): BsStatus | null {
  const status = byKey.get(link.target)?.status;
  return status && IMPACTED.has(status) ? status : null;
}

/** Items with fresh live statuses merged in; returns the same array when nothing changed. */
export function applyStatuses(
  items: readonly GraphItem[],
  statuses: GraphStatuses
): readonly GraphItem[] {
  let changed = false;
  const next = items.map(item => {
    const live = (item.kind === 'bs' ? statuses.businessServices : statuses.services)[item.id];
    if (
      !live ||
      (live.status === item.status &&
        live.openIncidents === item.openIncidents &&
        JSON.stringify(live.reasons) === JSON.stringify(item.reasons))
    )
      return item;
    changed = true;
    return {
      ...item,
      status: live.status,
      openIncidents: live.openIncidents,
      reasons: live.reasons,
    };
  });
  return changed ? next : items;
}

/** The union of two views (deduplicated by id); `expanded` leaves the boundary, the new one joins it. */
export function mergeViews(
  base: ServiceGraphView,
  extra: ServiceGraphView,
  expanded: string
): ServiceGraphView {
  // The fresher copy (extra) wins for the same id, so a re-fetched edge or status replaces the old one.
  const unite = <T>(a: readonly T[], b: readonly T[], keyOf: (value: T) => string) => {
    const fresh = new Map(b.map(value => [keyOf(value), value]));
    const seen = new Set(a.map(keyOf));
    return [
      ...a.map(value => fresh.get(keyOf(value)) ?? value),
      ...b.filter(value => !seen.has(keyOf(value))),
    ];
  };
  const loaded = new Set([...base.nodes, ...extra.nodes].map(node => node.id));
  return {
    ...base,
    nodes: unite(base.nodes, extra.nodes, node => node.id),
    edges: unite(base.edges, extra.edges, edge => edge.id),
    businessServices: unite(base.businessServices, extra.businessServices, bs => bs.id),
    memberEdges: unite(
      base.memberEdges,
      extra.memberEdges,
      edge => `${edge.businessServiceId}:${edge.serviceId}`
    ),
    supportEdges: unite(
      base.supportEdges,
      extra.supportEdges,
      edge => `${edge.parentId}:${edge.childId}`
    ),
    boundaryIds: [
      ...new Set([
        ...(base.boundaryIds ?? []).filter(id => id !== expanded),
        ...(extra.boundaryIds ?? []),
      ]),
    ].filter(id => loaded.has(id) && id !== expanded),
  };
}

export type TraverseDirection = 'dependency' | 'dependent' | 'next' | 'previous';

/**
 * Where an arrow key goes from `key`: Right to a dependency, Left to a dependent, Down/Up through
 * the siblings that share the previous hop. Null when there is nowhere to go.
 */
export function traverse(
  links: readonly GraphLink[],
  items: readonly GraphItem[],
  key: string,
  direction: TraverseDirection
): string | null {
  const names = new Map(items.map(item => [item.key, item.name]));
  const sorted = (keys: Iterable<string>) =>
    [...new Set(keys)].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
  if (direction === 'dependency')
    return sorted(links.filter(link => link.source === key).map(link => link.target))[0] ?? null;
  if (direction === 'dependent')
    return sorted(links.filter(link => link.target === key).map(link => link.source))[0] ?? null;
  // Siblings: other nodes that share a dependent (or, failing that, every node), in name order.
  const parents = links.filter(link => link.target === key).map(link => link.source);
  const siblings = parents.length
    ? sorted(links.filter(link => parents.includes(link.source)).map(link => link.target))
    : sorted(items.map(item => item.key));
  const at = siblings.indexOf(key);
  if (at < 0) return siblings[0] ?? null;
  const step = direction === 'next' ? 1 : -1;
  return siblings[(at + step + siblings.length) % siblings.length] ?? null;
}

/** What the canvas draws at a zoom level: dots when far out, names in the middle, full cards close up. */
export type DetailLevel = 'dot' | 'name' | 'full';
export const DOT_BELOW = 0.35;
export const FULL_ABOVE = 0.7;
export function detailLevel(zoom: number): DetailLevel {
  return zoom < DOT_BELOW ? 'dot' : zoom < FULL_ABOVE ? 'name' : 'full';
}

/** The loaded graph as JSON for export (what the viewer can already see, nothing more). */
export function exportGraphJson(model: GraphModel): string {
  return JSON.stringify(
    {
      items: model.items.map(item => ({
        id: item.key,
        name: item.name,
        kind: item.kind,
        team: item.teamName,
        status: item.status,
        openIncidents: item.openIncidents,
        tier: item.criticality,
      })),
      links: model.links.map(link => ({
        from: link.source,
        to: link.target,
        kind: link.kind,
        suggested: link.suggested,
        origin: link.origin ?? null,
        type: link.dependencyType ?? null,
        confidence: link.confidence,
      })),
    },
    null,
    2
  );
}

/** One colour per status for SVG strokes, the minimap and exports (CSS classes cannot reach those). */
export const STATUS_HEX: Readonly<Record<BsStatus, string>> = {
  OPERATIONAL: STATUS_PALETTE.ok.base,
  UNKNOWN: '#a1a1aa',
  MAINTENANCE: STATUS_PALETTE.info.base,
  DEGRADED: STATUS_PALETTE.elevated.base,
  PARTIAL_OUTAGE: '#ea580c',
  MAJOR_OUTAGE: STATUS_PALETTE.critical.base,
};

const escapeXml = (text: string) => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

/** The laid-out graph as a standalone SVG (what is loaded, at the positions shown). */
export function exportGraphSvg(
  items: readonly GraphItem[],
  links: readonly GraphLink[],
  positions: Readonly<Record<string, { x: number; y: number }>>,
  size: (item: GraphItem) => { width: number; height: number }
): string {
  const placed = items.flatMap(item => {
    const at = positions[item.key];
    return at ? [{ item, ...at, ...size(item) }] : [];
  });
  const byKey = new Map(placed.map(node => [node.item.key, node]));
  const pad = 24;
  const minX = Math.min(0, ...placed.map(n => n.x)) - pad;
  const minY = Math.min(0, ...placed.map(n => n.y)) - pad;
  const maxX = Math.max(1, ...placed.map(n => n.x + n.width)) + pad;
  const maxY = Math.max(1, ...placed.map(n => n.y + n.height)) + pad;
  const lines = links.flatMap(link => {
    const a = byKey.get(link.source);
    const b = byKey.get(link.target);
    if (!a || !b) return [];
    const dash = link.suggested
      ? ' stroke-dasharray="6 4"'
      : link.dependencyType === 'SOFT'
        ? ' stroke-dasharray="10 3 2 3"'
        : link.kind === 'member'
          ? ' stroke-dasharray="2 3"'
          : '';
    return [
      `<line x1="${a.x + a.width}" y1="${a.y + a.height / 2}" x2="${b.x}" y2="${b.y + b.height / 2}" stroke="#71717a" stroke-width="1.5"${dash} marker-end="url(#arrow)"/>`,
    ];
  });
  const boxes = placed.map(
    ({ item, x, y, width, height }) =>
      `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${item.kind === 'bs' ? 4 : 12}" fill="#fff" stroke="#d4d4d8"/><rect x="${x}" y="${y}" width="5" height="${height}" fill="${STATUS_HEX[item.status]}"/><text x="${x + 14}" y="${y + 26}" font-family="sans-serif" font-size="13" font-weight="600" fill="#18181b">${escapeXml(item.name.slice(0, 40))}</text><text x="${x + 14}" y="${y + 46}" font-family="sans-serif" font-size="11" fill="#52525b">${escapeXml(item.status.replace('_', ' ').toLowerCase())}${item.openIncidents ? ` · ${item.openIncidents} open` : ''}</text></g>`
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" width="${maxX - minX}" height="${maxY - minY}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#71717a"/></marker></defs><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#fafafa"/>${lines.join('')}${boxes.join('')}</svg>`;
}

export type SortKey = 'name' | 'team' | 'status' | 'incidents' | 'dependsOn' | 'usedBy';

const STATUS_SEVERITY: Record<BsStatus, number> = {
  OPERATIONAL: 0,
  UNKNOWN: 1,
  MAINTENANCE: 2,
  DEGRADED: 3,
  PARTIAL_OUTAGE: 4,
  MAJOR_OUTAGE: 5,
};

/** Relation counts per item key: what it depends on and what uses it. */
export function relationCounts(links: readonly GraphLink[]) {
  const dependsOn = new Map<string, number>();
  const usedBy = new Map<string, number>();
  for (const link of links) {
    dependsOn.set(link.source, (dependsOn.get(link.source) ?? 0) + 1);
    usedBy.set(link.target, (usedBy.get(link.target) ?? 0) + 1);
  }
  return { dependsOn, usedBy };
}

/** A sorted copy for the list view; ties fall back to the name so the order is stable. */
export function sortItems(
  items: readonly GraphItem[],
  links: readonly GraphLink[],
  key: SortKey,
  direction: 'asc' | 'desc'
): GraphItem[] {
  const { dependsOn, usedBy } = relationCounts(links);
  const value = (item: GraphItem): string | number => {
    switch (key) {
      case 'name':
        return item.name.toLowerCase();
      case 'team':
        return (item.teamName ?? '').toLowerCase();
      case 'status':
        return STATUS_SEVERITY[item.status] ?? 0;
      case 'incidents':
        return item.openIncidents;
      case 'dependsOn':
        return dependsOn.get(item.key) ?? 0;
      case 'usedBy':
        return usedBy.get(item.key) ?? 0;
    }
  };
  const sign = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const order =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
    return order * sign || a.name.localeCompare(b.name);
  });
}

/** Edge weight and tone from measured traffic: thicker with volume, amber/red with errors. Null without data. */
export function trafficStyle(
  traffic: GraphLink['traffic']
): { width: number; tone: 'ok' | 'warn' | 'bad' } | null {
  if (!traffic) return null;
  const width = Math.min(4, 1.5 + Math.log10(1 + Math.max(traffic.requestRate, 0)) * 0.8);
  const tone = traffic.errorRate >= 0.05 ? 'bad' : traffic.errorRate >= 0.01 ? 'warn' : 'ok';
  return { width, tone };
}

export const formatRate = (rate: number) =>
  rate >= 100 ? `${Math.round(rate)}/s` : rate >= 1 ? `${rate.toFixed(1)}/s` : `${rate.toFixed(2)}/s`;
export const formatErrorRate = (rate: number) => `${(rate * 100).toFixed(rate < 0.1 ? 2 : 1)}%`;
