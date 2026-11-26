/**
 * ELK layout for the service graph, kept free of the ELK runtime so the worker, the client fallback
 * and the node benchmark share one definition. Edges point from the dependent to what it depends
 * on, so business services sit on the left and the deepest dependencies on the right.
 */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

export type LayoutNodeInput = { id: string; width: number; height: number; group?: string | null };
export type LayoutEdgeInput = { id: string; source: string; target: string };
export type LayoutRequest = {
  nodes: LayoutNodeInput[];
  edges: LayoutEdgeInput[];
  /**
   * Pack each group (team) as its own box. ELK routes the edges inside a group; edges between
   * groups have no route and the canvas draws them as orthogonal steps between the cards.
   */
  grouped: boolean;
};
export type LayoutGroup = { id: string; x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type LayoutResult = {
  positions: Record<string, Point>;
  groups: LayoutGroup[];
  /** ELK's orthogonal route per edge id, in absolute coordinates (start, bends, end). */
  routes: Record<string, Point[]>;
};
export type ElkLike = { layout(graph: ElkNode): Promise<ElkNode> };

export const UNGROUPED = '__ungrouped__';
export const GROUP_PREFIX = 'group:';
const GROUP_PADDING = 28;

const LAYERED = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.componentComponent': '48',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.thoroughness': '2',
  'elk.edgeRouting': 'ORTHOGONAL',
};

function layered(
  id: string,
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  padding = 0
): ElkNode {
  const ids = new Set(nodes.map(node => node.id));
  return {
    id,
    layoutOptions: {
      ...LAYERED,
      'elk.padding': `[top=${padding},left=${padding},bottom=${padding},right=${padding}]`,
    },
    children: nodes.map(({ id: nodeId, width, height }) => ({ id: nodeId, width, height })),
    edges: edges
      .filter(edge => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target))
      .map((edge): ElkExtendedEdge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
  };
}

export function toElkGraph(request: LayoutRequest): ElkNode {
  if (!request.grouped) return layered('root', request.nodes, request.edges);
  const byGroup = new Map<string, LayoutNodeInput[]>();
  for (const node of request.nodes) {
    const key = node.group ?? UNGROUPED;
    const list = byGroup.get(key);
    if (list) list.push(node);
    else byGroup.set(key, [node]);
  }
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'rectpacking',
      'elk.spacing.nodeNode': '40',
      'elk.aspectRatio': '1.6',
    },
    children: [...byGroup].map(([group, nodes]) =>
      layered(`${GROUP_PREFIX}${group}`, nodes, request.edges, GROUP_PADDING)
    ),
  };
}

/** Edge routes of one ELK node, shifted by its offset (ELK gives them relative to their container). */
function collectRoutes(container: ElkNode, dx: number, dy: number, routes: LayoutResult['routes']) {
  for (const edge of container.edges ?? []) {
    const section = edge.sections?.[0];
    if (!section) continue;
    routes[edge.id] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
      point => ({ x: point.x + dx, y: point.y + dy })
    );
  }
}

/** Absolute top-left positions for every node, the boxes of the groups and the edge routes. */
export function fromElkGraph(root: ElkNode): LayoutResult {
  const positions: LayoutResult['positions'] = {};
  const groups: LayoutGroup[] = [];
  const routes: LayoutResult['routes'] = {};
  collectRoutes(root, 0, 0, routes);
  for (const child of root.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (child.id.startsWith(GROUP_PREFIX)) {
      groups.push({ id: child.id, x, y, width: child.width ?? 0, height: child.height ?? 0 });
      for (const node of child.children ?? []) {
        positions[node.id] = { x: x + (node.x ?? 0), y: y + (node.y ?? 0) };
      }
      collectRoutes(child, x, y, routes);
    } else {
      positions[child.id] = { x, y };
    }
  }
  return { positions, groups, routes };
}

/** An SVG path through a route, and the point halfway along it (where an edge label sits). */
export function routePath(points: readonly Point[]): { path: string; x: number; y: number } {
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
  const segments: Array<{ a: Point; b: Point; length: number }> = [];
  if (points.length > 1)
    points.reduce((a, b) => {
      segments.push({ a, b, length: Math.hypot(b.x - a.x, b.y - a.y) });
      return b;
    });
  let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  for (const { a, b, length } of segments) {
    if (remaining <= length && length > 0) {
      const t = remaining / length;
      return { path, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  const first = points.at(0);
  return { path, x: first?.x ?? 0, y: first?.y ?? 0 };
}

export async function runLayout(elk: ElkLike, request: LayoutRequest): Promise<LayoutResult> {
  return fromElkGraph(await elk.layout(toElkGraph(request)));
}

/** A plain grid, used while the worker runs and where workers are unavailable. */
export function gridLayout(request: LayoutRequest, columns = 6): LayoutResult {
  const positions: LayoutResult['positions'] = {};
  request.nodes.forEach((node, index) => {
    positions[node.id] = { x: (index % columns) * 240, y: Math.floor(index / columns) * 96 };
  });
  return { positions, groups: [], routes: {} };
}
