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
  /** Pack each group (team) as its own box; edges between groups are drawn but not laid out. */
  grouped: boolean;
};
export type LayoutGroup = { id: string; x: number; y: number; width: number; height: number };
export type LayoutResult = {
  positions: Record<string, { x: number; y: number }>;
  groups: LayoutGroup[];
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
  'elk.edgeRouting': 'POLYLINE',
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

/** Absolute top-left positions for every node, and the boxes of the groups. */
export function fromElkGraph(root: ElkNode): LayoutResult {
  const positions: LayoutResult['positions'] = {};
  const groups: LayoutGroup[] = [];
  for (const child of root.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    if (child.id.startsWith(GROUP_PREFIX)) {
      groups.push({ id: child.id, x, y, width: child.width ?? 0, height: child.height ?? 0 });
      for (const node of child.children ?? []) {
        positions[node.id] = { x: x + (node.x ?? 0), y: y + (node.y ?? 0) };
      }
    } else {
      positions[child.id] = { x, y };
    }
  }
  return { positions, groups };
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
  return { positions, groups: [] };
}
