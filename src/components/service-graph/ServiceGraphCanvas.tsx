'use client';

/**
 * React Flow canvas for the service graph. This module (and @xyflow/react with it) is only ever
 * loaded through next/dynamic from the graph page, and ELK runs in layout.worker.ts, so neither
 * library reaches the shared bundles (scripts/perf/check-performance-budgets.cjs checks this).
 */
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Boxes, Server } from 'lucide-react';
import { useEffectiveTheme } from '@/hooks/use-effective-theme';
import { cn } from '@/lib/utils';
import GraphHealthBadge, { GRAPH_STATUS_META } from './GraphHealthBadge';
import { toneClasses } from '@/components/patterns/status-tone';
import {
  GROUP_PREFIX,
  UNGROUPED,
  gridLayout,
  type LayoutRequest,
  type LayoutResult,
} from './layout';
import { oneHop, type GraphItem, type GraphLink } from './model';

const SIZE = { bs: { width: 224, height: 68 }, svc: { width: 204, height: 64 } } as const;

type ItemData = { item: GraphItem; connectable: boolean };
type TeamData = { label: string };
type ItemNode = Node<ItemData, 'bs' | 'svc'>;
type TeamNode = Node<TeamData, 'team'>;

function useLayout(request: LayoutRequest): LayoutResult | null {
  const [state, setState] = useState<{ request: LayoutRequest; result: LayoutResult } | null>(null);
  useEffect(() => {
    let worker: Worker | null = null;
    let done = false;
    const finish = (result: LayoutResult) => {
      if (done) return;
      done = true;
      setState({ request, result });
      worker?.terminate();
    };
    try {
      worker = new Worker(new URL('./layout.worker.ts', import.meta.url));
    } catch {
      finish(gridLayout(request));
      return;
    }
    worker.onmessage = (event: MessageEvent<{ result?: LayoutResult; error?: string }>) =>
      finish(event.data.result ?? gridLayout(request));
    worker.onerror = () => finish(gridLayout(request));
    worker.postMessage({ id: 1, request });
    return () => {
      done = true;
      worker?.terminate();
    };
  }, [request]);
  return state?.request === request ? state.result : null;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
const usePrefersReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
    () => false
  );

const handleClass = '!h-2.5 !w-2.5 !border-2 !border-background !bg-ink-400';

const ItemCard = memo(function ItemCard({ data, selected }: NodeProps<ItemNode>) {
  const { item, connectable } = data;
  const tone = toneClasses(GRAPH_STATUS_META[item.status]?.tone ?? 'neutral');
  const Icon = item.kind === 'bs' ? Boxes : Server;
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col justify-center gap-1 border border-l-4 bg-card px-3 text-left shadow-xs',
        item.kind === 'bs' ? 'rounded-sm' : 'rounded-xl',
        tone.borderLeft,
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      )}
      title={`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={connectable}
        className={handleClass}
      />
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <GraphHealthBadge status={item.status} />
        {item.openIncidents > 0 && (
          <span className="text-2xs font-semibold tabular-nums text-foreground">
            {item.openIncidents} open
          </span>
        )}
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {item.teamName ?? 'No team'}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={connectable}
        className={handleClass}
      />
    </div>
  );
});

function TeamBox({ data }: NodeProps<TeamNode>) {
  return (
    <div className="h-full w-full rounded-lg border border-dashed bg-muted/30">
      <span className="absolute left-3 top-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {data.label}
      </span>
    </div>
  );
}

const nodeTypes = { bs: ItemCard, svc: ItemCard, team: TeamBox };

export type ServiceGraphCanvasProps = {
  items: readonly GraphItem[];
  links: readonly GraphLink[];
  grouped: boolean;
  selectedKey: string | null;
  canEdit: boolean;
  /** A connection starts from the dependent service, which must belong to one of these teams; null = any. */
  editableTeamIds?: readonly string[] | null;
  onSelect: (key: string | null) => void;
  /** Dragged from `dependentId` to `dependencyId` (both technical services). */
  onConnect: (dependentId: string, dependencyId: string) => void;
  onLinkClick: (link: GraphLink) => void;
};

export default function ServiceGraphCanvas({
  items,
  links,
  grouped,
  selectedKey,
  canEdit,
  editableTeamIds = null,
  onSelect,
  onConnect,
  onLinkClick,
}: ServiceGraphCanvasProps) {
  const theme = useEffectiveTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState<string | null>(null);

  const request = useMemo<LayoutRequest>(
    () => ({
      nodes: items.map(item => ({
        id: item.key,
        ...SIZE[item.kind],
        group: item.teamId,
      })),
      edges: links.map(link => ({ id: link.key, source: link.source, target: link.target })),
      grouped,
    }),
    [items, links, grouped]
  );
  const layout = useLayout(request);
  const near = useMemo(() => {
    const key = hovered ?? selectedKey;
    return key ? oneHop(links, key) : null;
  }, [hovered, selectedKey, links]);

  const teamNames = useMemo(
    () => new Map(items.map(item => [item.teamId ?? UNGROUPED, item.teamName ?? 'No team'])),
    [items]
  );
  const nodes = useMemo<Array<ItemNode | TeamNode>>(() => {
    if (!layout) return [];
    const teams: TeamNode[] = layout.groups.map(group => ({
      id: group.id,
      type: 'team',
      position: { x: group.x, y: group.y },
      data: { label: teamNames.get(group.id.slice(GROUP_PREFIX.length)) ?? 'No team' },
      style: { width: group.width, height: group.height },
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: -1,
    }));
    return [
      ...teams,
      ...items.map((item): ItemNode => ({
        id: item.key,
        type: item.kind,
        position: layout.positions[item.key] ?? { x: 0, y: 0 },
        data: {
          item,
          connectable: canEdit && item.kind === 'svc',
        },
        selected: item.key === selectedKey,
        ariaLabel: `${item.kind === 'bs' ? 'Business service' : 'Service'} ${item.name}, ${GRAPH_STATUS_META[item.status]?.label ?? item.status}, ${item.openIncidents} open incidents`,
        ...SIZE[item.kind],
        connectable: canEdit && item.kind === 'svc',
      })),
    ];
  }, [layout, items, selectedKey, canEdit, teamNames]);

  const edges = useMemo<Edge[]>(
    () =>
      links.map(link => {
        return {
          id: link.key,
          source: link.source,
          target: link.target,
          focusable: link.kind === 'dependency',
          ariaLabel:
            link.kind === 'dependency'
              ? `${link.suggested ? 'Suggested dependency' : 'Dependency'}; activate to ${link.suggested ? 'review' : 'remove'}`
              : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: {
            strokeWidth: link.kind === 'member' ? 1 : 1.5,
            strokeDasharray: link.suggested ? '6 4' : link.kind === 'member' ? '2 3' : undefined,
          },
          className: link.suggested ? 'graph-edge-suggested' : undefined,
        };
      }),
    [links]
  );

  const itemByKey = useMemo(() => new Map(items.map(item => [item.key, item])), [items]);
  const byKey = useMemo(() => new Map(links.map(link => [link.key, link])), [links]);
  // Hover/selection highlight is a style rule, so nodes and edges keep their identity while the
  // pointer moves (re-creating 2000 nodes per hover is slow and interrupts drag-to-connect).
  const highlight = useMemo(() => {
    if (!near) return '';
    const notNear = [...near].map(key => `:not([data-id="${key}"])`).join('');
    const notLit = links
      .filter(link => near.has(link.source) && near.has(link.target))
      .map(link => `:not([data-id="${link.key}"])`)
      .join('');
    return `.sg-canvas .react-flow__node:not(.react-flow__node-team)${notNear}{opacity:.3}.sg-canvas .react-flow__edge${notLit}{opacity:.15}`;
  }, [near, links]);

  if (!layout) {
    return (
      <div
        role="status"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        Laying out {items.length} services…
      </div>
    );
  }

  return (
    <div className="sg-canvas h-full w-full">
      <style>{`.sg-canvas .react-flow__node,.sg-canvas .react-flow__edge{transition:opacity 150ms}@media (prefers-reduced-motion:reduce){.sg-canvas .react-flow__node,.sg-canvas .react-flow__edge{transition:none}}${highlight}`}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        forceColorMode={theme}
        fitView
        fitViewOptions={{ padding: '12%', duration: reducedMotion ? 0 : 200 }}
        minZoom={0.05}
        onlyRenderVisibleElements={items.length > 300}
        nodesDraggable={false}
        nodesConnectable={canEdit}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        isValidConnection={(connection: Connection | Edge) =>
          connection.source !== connection.target &&
          connection.source.startsWith('svc:') &&
          connection.target.startsWith('svc:') &&
          (!editableTeamIds ||
            editableTeamIds.includes(itemByKey.get(connection.source)?.teamId ?? ''))
        }
        onConnect={connection => {
          if (connection.source && connection.target)
            onConnect(connection.source.slice(4), connection.target.slice(4));
        }}
        onNodeClick={(_event, node) => node.type !== 'team' && onSelect(node.id)}
        onNodeMouseEnter={(_event, node) => node.type !== 'team' && setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onPaneClick={() => onSelect(null)}
        onEdgeClick={(_event, edge) => {
          const link = byKey.get(edge.id);
          if (link?.kind === 'dependency') onLinkClick(link);
        }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        {items.length > 40 && (
          <MiniMap pannable zoomable ariaLabel="Graph overview" className="!hidden sm:!block" />
        )}
      </ReactFlow>
    </div>
  );
}
