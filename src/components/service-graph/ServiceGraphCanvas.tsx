'use client';

/**
 * React Flow canvas for the service graph. This module (and @xyflow/react with it) is only ever
 * loaded through next/dynamic from the graph page, and ELK runs in layout.worker.ts, so neither
 * library reaches the shared bundles (scripts/perf/check-performance-budgets.cjs checks this).
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  useOnViewportChange,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type OnNodesChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Boxes, Pin, RotateCcw, Server } from 'lucide-react';
import { useEffectiveTheme } from '@/hooks/use-effective-theme';
import { cn } from '@/lib/utils';
import GraphSkeleton from './GraphSkeleton';
import GraphHealthBadge, { GRAPH_STATUS_META } from './GraphHealthBadge';
import { toneClasses } from '@/components/patterns/status-tone';
import {
  GROUP_PREFIX,
  UNGROUPED,
  gridLayout,
  routePath,
  type LayoutRequest,
  type LayoutResult,
  type Point,
} from './layout';
import {
  STATUS_HEX,
  createReuseCache,
  detailLevel,
  type DetailLevel,
  edgeAppearance,
  edgeImpactStatus,
  edgeSummary,
  exportGraphSvg,
  oneHop,
  traverse,
  type GraphItem,
  type GraphLink,
} from './model';
import { Button } from '@/components/ui/shadcn/button';

const SIZE = { bs: { width: 224, height: 68 }, svc: { width: 204, height: 64 } } as const;
const ORIGIN = { x: 0, y: 0 };

type ItemData = {
  item: GraphItem;
  connectable: boolean;
  match: boolean;
  pinned: boolean;
  level: DetailLevel;
  /** Hops from the start of the highlighted impact; null outside it. */
  depth: number | null;
};
type TeamData = { label: string };
type ItemNode = Node<ItemData, 'bs' | 'svc'>;
type TeamNode = Node<TeamData, 'team'>;
type EdgeData = {
  /** ELK's route; null draws an orthogonal step between the handles (cross-team or dragged). */
  points: Point[] | null;
  label: { text: string; className: string } | null;
  dim: boolean;
};
type RoutedEdge = Edge<EdgeData, 'routed'>;

const NEUTRAL_LABEL = 'border-border bg-card text-foreground';
const LABEL_CLASS = {
  neutral: NEUTRAL_LABEL,
  elevated: toneClasses('elevated').soft,
  critical: toneClasses('critical').soft,
} as const;

const TIER_LABEL = {
  TIER_0: 'Tier 0',
  TIER_1: 'Tier 1',
  TIER_2: 'Tier 2',
  TIER_3: 'Tier 3',
} as const;

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

function useMedia(media: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const query = window.matchMedia?.(media);
      query?.addEventListener('change', onChange);
      return () => query?.removeEventListener('change', onChange);
    },
    [media]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(media).matches ?? false,
    () => false
  );
}

// Handles stay mounted (edges attach to them) but are only visible and grabbable for editors.
const handleClass = (connectable: boolean) =>
  cn(
    '!h-2.5 !w-2.5 !border-2 !border-background !bg-ink-400',
    !connectable && '!pointer-events-none !opacity-0'
  );

const ItemCard = memo(function ItemCard({ data, selected }: NodeProps<ItemNode>) {
  const { item, connectable, match, pinned, level, depth } = data;
  // Semantic zoom: colour tiles far out, names in the middle, the full card up close.
  const tone = toneClasses(GRAPH_STATUS_META[item.status]?.tone ?? 'neutral');
  const Icon = item.kind === 'bs' ? Boxes : Server;
  const ring = (selected || match) && 'ring-2 ring-ring ring-offset-1 ring-offset-background';
  const tierZero = item.criticality === 'TIER_0';
  const chip = 'shrink-0 rounded-sm border px-1 text-2xs font-semibold tabular-nums';
  return (
    <div
      className={cn(
        'h-full w-full text-left',
        level === 'dot'
          ? cn(
              'sg-tile rounded-md',
              tone.solid,
              ring,
              tierZero && 'outline outline-2 outline-offset-2 outline-foreground'
            )
          : cn(
              'sg-card flex flex-col justify-center gap-1 border border-l-4 bg-card px-3 shadow-xs group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1',
              item.kind === 'bs' ? 'rounded-sm' : 'rounded-xl',
              // Tier 0 business services carry a heavier frame so they read first.
              tierZero &&
                'border-y-2 border-r-2 border-y-foreground/60 border-r-foreground/60 shadow-sm',
              item.filteredOut && 'border-dashed',
              tone.borderLeft,
              ring
            )
      )}
      title={`${item.name}${item.teamName ? ` · ${item.teamName}` : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={connectable}
        className={handleClass(connectable)}
      />
      {level !== 'dot' && (
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
          {item.criticality && (
            <span
              className={cn(
                chip,
                tierZero
                  ? 'border-foreground bg-foreground text-background'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {TIER_LABEL[item.criticality]}
            </span>
          )}
          {depth !== null && (
            <span className={cn(chip, NEUTRAL_LABEL)} title="Hops from the selected service">
              {depth === 0 ? 'start' : `${depth} hop${depth === 1 ? '' : 's'}`}
            </span>
          )}
          {item.filteredOut && (
            <span
              className={cn(chip, 'bg-muted text-muted-foreground')}
              title="Hidden by the filters; shown because the highlight runs through it"
            >
              filtered
            </span>
          )}
          {item.spof && (
            <span
              className={cn(
                'shrink-0 rounded-sm border px-1 text-2xs font-semibold',
                toneClasses('critical').soft
              )}
              title="Single point of failure"
            >
              SPOF
            </span>
          )}
          {pinned && (
            <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pinned position" />
          )}
        </div>
      )}
      {level === 'full' && (
        <div className="flex min-w-0 items-center gap-1.5">
          <GraphHealthBadge status={item.status} />
          {item.openIncidents > 0 && (
            <span className="text-2xs font-semibold tabular-nums text-foreground">
              {item.openIncidents} open
            </span>
          )}
          <span className="min-w-0 truncate text-2xs text-muted-foreground">
            {item.memberCount !== null &&
              `${item.memberCount} service${item.memberCount === 1 ? '' : 's'} · `}
            {item.teamName ?? 'No team'}
          </span>
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={connectable}
        className={handleClass(connectable)}
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

/** Draws ELK's orthogonal route when it has one, else a step path between the two handles. */
const RoutedEdgeView = memo(function RoutedEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps<RoutedEdge>) {
  const points = data?.points;
  const { path, x, y } = useMemo(() => {
    if (points?.length) return routePath(points);
    const [step, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 6,
    });
    return { path: step, x: labelX, y: labelY };
  }, [points, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth}
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <span
            aria-hidden="true"
            className={cn(
              'nodrag nopan pointer-events-none absolute rounded-sm border px-1 text-2xs font-semibold tabular-nums',
              data.label.className,
              data.dim && 'opacity-20'
            )}
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
          >
            {data.label.text}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { bs: ItemCard, svc: ItemCard, team: TeamBox };
const edgeTypes = { routed: RoutedEdgeView };

/**
 * Muted, not faded: the status accent and colour go grey but text keeps a readable contrast
 * (muted-foreground on card), so a de-emphasised node can still be read.
 */
const dimRules = (scope: string) =>
  `${scope} .sg-card{border-color:hsl(var(--ui-border));box-shadow:none;background:hsl(var(--ui-muted))}` +
  `${scope} .sg-card>*{filter:grayscale(1)}` +
  `${scope} .sg-card,${scope} .sg-card *{color:hsl(var(--ui-muted-foreground))!important}` +
  `${scope} .sg-tile{opacity:.25}`;

/** What to emphasise: an impact subgraph or a path. Everything else dims. */
export type Emphasis = {
  keys: ReadonlySet<string>;
  linkKeys: ReadonlySet<string>;
  /** Hops from the start, drawn as labels on the cards. */
  depth?: ReadonlyMap<string, number>;
};

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
  emphasis?: Emphasis | null;
  /** Search matches, ringed on the canvas. */
  matches?: ReadonlySet<string>;
  /** Pan and zoom to these nodes whenever `token` changes. */
  fit?: { keys: readonly string[]; token: number } | null;
  /** Identifies this graph for remembering dragged positions for the session. */
  layoutId: string;
  /** Hands the parent a function that renders the current layout as SVG (null on unmount). */
  onExportReady?: (exportSvg: (() => string) | null) => void;
};

type Positions = Record<string, { x: number; y: number }>;

function loadPositions(storageKey: string): Positions {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, { x: number; y: number }] =>
          typeof (entry[1] as { x?: unknown })?.x === 'number' &&
          typeof (entry[1] as { y?: unknown })?.y === 'number'
      )
    );
  } catch {
    return {};
  }
}

function savePositions(storageKey: string, positions: Positions) {
  try {
    if (Object.keys(positions).length === 0) window.sessionStorage.removeItem(storageKey);
    else window.sessionStorage.setItem(storageKey, JSON.stringify(positions));
  } catch {
    // Storage can be blocked; dragged positions then last until the page is left.
  }
}

/** Pans and zooms to the requested nodes; lives inside <ReactFlow> to reach its viewport. */
function FitController({
  fit,
  duration,
}: {
  fit: ServiceGraphCanvasProps['fit'];
  duration: number;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!fit || fit.keys.length === 0) return;
    void fitView({ nodes: fit.keys.map(id => ({ id })), padding: 0.4, maxZoom: 1.2, duration });
  }, [fit, fitView, duration]);
  return null;
}

/** Reports the detail level when the zoom crosses a threshold (not on every pan or zoom frame). */
function ZoomWatcher({ onLevel }: { onLevel: (level: DetailLevel) => void }) {
  useOnViewportChange({ onChange: viewport => onLevel(detailLevel(viewport.zoom)) });
  return null;
}

const KEY_DIRECTION = {
  ArrowRight: 'dependency',
  ArrowLeft: 'dependent',
  ArrowDown: 'next',
  ArrowUp: 'previous',
} as const;

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
  emphasis = null,
  matches,
  fit = null,
  layoutId,
  onExportReady,
}: ServiceGraphCanvasProps) {
  const theme = useEffectiveTheme();
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const compact = useMedia('(max-width: 639px)');
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ key: string; x: number; y: number } | null>(null);
  const storageKey = `sg-pos:${layoutId}`;
  const [pinned, setPinned] = useState<Positions>(() => loadPositions(storageKey));
  const root = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<DetailLevel>('full');

  // The layout depends on the structure only. A live status update hands in new item objects but the
  // same ids and links, and must not re-run ELK or move anything.
  const signature = useMemo(
    () =>
      `${grouped}|${items.map(item => `${item.key}:${item.teamId ?? ''}`).join(',')}|${links
        .map(link => link.key)
        .join(',')}`,
    [items, links, grouped]
  );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `signature` on purpose
    [signature]
  );
  const layout = useLayout(request);
  const near = useMemo(() => {
    if (emphasis) return null;
    const key = hovered ?? selectedKey;
    return key ? oneHop(links, key) : null;
  }, [hovered, selectedKey, links, emphasis]);

  const teamNames = useMemo(
    () => new Map(items.map(item => [item.teamId ?? UNGROUPED, item.teamName ?? 'No team'])),
    [items]
  );
  const itemByKey = useMemo(() => new Map(items.map(item => [item.key, item])), [items]);
  // Node and edge objects are reused while their inputs are the same, so a selection, search,
  // highlight or status poll re-renders only the cards that changed, not all 2,000.
  const [nodeCache] = useState(() => createReuseCache<ItemNode>());
  const [edgeCache] = useState(() => createReuseCache<RoutedEdge>());
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
    const built = items.map(item => {
      const position = pinned[item.key] ?? layout.positions[item.key] ?? ORIGIN;
      const connectable = canEdit && item.kind === 'svc';
      const match = !!matches?.has(item.key);
      const isPinned = item.key in pinned;
      const dim = !!emphasis && !emphasis.keys.has(item.key);
      const depth = emphasis?.depth?.get(item.key) ?? null;
      const selected = item.key === selectedKey;
      return nodeCache.get(
        item.key,
        [item, position, connectable, match, isPinned, level, dim, depth, selected],
        (): ItemNode => ({
          id: item.key,
          type: item.kind,
          position,
          // `group` lets the card show a focus ring when the node wrapper has keyboard focus.
          className: cn('group', dim && 'sg-dim'),
          data: { item, connectable, match, pinned: isPinned, level, depth },
          selected,
          ariaLabel: `${item.kind === 'bs' ? 'Business service' : 'Service'} ${item.name}${item.criticality ? `, ${TIER_LABEL[item.criticality]}` : ''}, ${GRAPH_STATUS_META[item.status]?.label ?? item.status}, ${item.openIncidents} open incidents${depth ? `, ${depth} hop${depth === 1 ? '' : 's'} away` : ''}${item.filteredOut ? ', hidden by filters' : ''}. Arrow keys move along dependencies.`,
          ...SIZE[item.kind],
          connectable,
        })
      );
    });
    nodeCache.sweep();
    return [...teams, ...built];
  }, [layout, items, selectedKey, canEdit, teamNames, pinned, emphasis, matches, level, nodeCache]);

  const edges = useMemo<RoutedEdge[]>(() => {
    const built = links.map(link => {
      const lit = emphasis?.linkKeys.has(link.key) ?? false;
      const dim = !!emphasis && !lit;
      const impacted = lit ? edgeImpactStatus(link, itemByKey) : null;
      // A dragged end leaves ELK's route behind; draw a step to where the card is now.
      const points =
        link.source in pinned || link.target in pinned ? null : (layout?.routes[link.key] ?? null);
      return edgeCache.get(link.key, [link, lit, dim, impacted, points], (): RoutedEdge => {
        const look = edgeAppearance(link, lit, impacted);
        const label = look.label && {
          text: look.label.text,
          className: LABEL_CLASS[look.label.tone],
        };
        return {
          id: link.key,
          type: 'routed',
          source: link.source,
          target: link.target,
          data: { points, label, dim },
          focusable: link.kind === 'dependency',
          // A wide invisible hit area, so a 1.5px line is not a precision task.
          interactionWidth: 24,
          ariaLabel:
            link.kind === 'dependency'
              ? `${edgeSummary(link).join(', ')}; activate to ${link.suggested ? 'review' : 'see details'}`
              : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: look.stroke },
          style: { strokeWidth: look.width, stroke: look.stroke, strokeDasharray: look.dash },
          className: cn(link.suggested && 'graph-edge-suggested', dim && 'sg-dim-edge'),
        };
      });
    });
    edgeCache.sweep();
    return built;
  }, [links, emphasis, itemByKey, layout, pinned, edgeCache]);

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
    return `${dimRules(`.sg-canvas .react-flow__node:not(.react-flow__node-team)${notNear}`)}.sg-canvas .react-flow__edge${notLit}{opacity:.15}`;
  }, [near, links]);

  const onNodesChange = useCallback<OnNodesChange<ItemNode | TeamNode>>(changes => {
    for (const change of changes)
      if (change.type === 'position' && change.position) {
        const { id, position } = change;
        setPinned(current => ({ ...current, [id]: position }));
      }
  }, []);
  useEffect(() => savePositions(storageKey, pinned), [storageKey, pinned]);
  const resetLayout = () => setPinned({});

  const exportSvg = useCallback(() => {
    const routes = Object.fromEntries(
      links.flatMap(link => {
        const route = layout?.routes[link.key];
        return route && !(link.source in pinned) && !(link.target in pinned)
          ? [[link.key, route] as const]
          : [];
      })
    );
    return exportGraphSvg(
      items,
      links,
      { ...(layout?.positions ?? {}), ...pinned },
      item => SIZE[item.kind],
      { theme, routes }
    );
  }, [items, links, layout, pinned, theme]);
  useEffect(() => {
    onExportReady?.(layout ? exportSvg : null);
    return () => onExportReady?.(null);
  }, [layout, exportSvg, onExportReady]);

  if (!layout) return <GraphSkeleton label={`Laying out ${items.length} services`} />;

  return (
    <div
      ref={root}
      className="sg-canvas relative h-full w-full"
      onKeyDown={event => {
        const direction = KEY_DIRECTION[event.key as keyof typeof KEY_DIRECTION] ?? null;
        const element = (event.target as HTMLElement).closest<HTMLElement>(
          '.react-flow__node:not(.react-flow__node-team)'
        );
        const from = element?.getAttribute('data-id');
        if (!direction || !from) return;
        event.preventDefault();
        const to = traverse(links, items, from, direction);
        if (!to) return;
        onSelect(to);
        requestAnimationFrame(() =>
          root.current
            ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(to)}"]`)
            ?.focus()
        );
      }}
    >
      <style>{`.sg-canvas .react-flow__node,.sg-canvas .react-flow__edge{transition:opacity 150ms}@media (prefers-reduced-motion:reduce){.sg-canvas .react-flow__node,.sg-canvas .react-flow__edge{transition:none}}${dimRules('.sg-canvas .sg-dim')}.sg-canvas .sg-dim-edge{opacity:.15}.sg-canvas .react-flow__node:focus-visible{outline:none}${highlight}`}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        forceColorMode={theme}
        fitView
        fitViewOptions={{ padding: '12%', duration: reducedMotion ? 0 : 200 }}
        minZoom={0.05}
        onlyRenderVisibleElements={items.length > 300}
        nodesDraggable
        nodesConnectable={canEdit}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={(_event, node) => {
          if (node.type === 'team' || !(node.id in pinned)) return;
          const rest = Object.fromEntries(
            Object.entries(pinned).filter(([key]) => key !== node.id)
          );
          setPinned(rest);
        }}
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
        onEdgeMouseEnter={(event, edge) => {
          const box = root.current?.getBoundingClientRect();
          if (box)
            setTip({ key: edge.id, x: event.clientX - box.left, y: event.clientY - box.top });
        }}
        onEdgeMouseLeave={() => setTip(null)}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <ZoomWatcher onLevel={setLevel} />
        <FitController fit={fit} duration={reducedMotion ? 0 : 300} />
        {Object.keys(pinned).length > 0 && (
          <Panel position="top-right">
            <Button size="sm" variant="outline" onClick={resetLayout}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset layout
            </Button>
          </Panel>
        )}
        {items.length > 40 && (
          <MiniMap
            pannable
            zoomable
            ariaLabel="Graph overview"
            // Smaller on phones so it stays available without covering the graph.
            style={compact ? { width: 112, height: 72, margin: 8 } : undefined}
            nodeColor={node =>
              node.type === 'team'
                ? 'transparent'
                : (STATUS_HEX[(node.data as ItemData).item.status] ?? STATUS_HEX.UNKNOWN)
            }
          />
        )}
      </ReactFlow>
      {tip && byKey.get(tip.key) && (
        <EdgeTip
          link={byKey.get(tip.key)!}
          x={tip.x}
          y={tip.y}
          nameOf={key => itemByKey.get(key)?.name ?? 'a service you cannot see'}
        />
      )}
    </div>
  );
}

/** Hover card for an edge: its ends, type, criticality and measured traffic. */
function EdgeTip({
  link,
  x,
  y,
  nameOf,
}: {
  link: GraphLink;
  x: number;
  y: number;
  nameOf: (key: string) => string;
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: x + 12, top: y + 12 }}
    >
      <p className="truncate font-medium">
        {nameOf(link.source)} → {nameOf(link.target)}
      </p>
      {edgeSummary(link).map(line => (
        <p key={line} className="text-muted-foreground first-letter:uppercase">
          {line}
        </p>
      ))}
    </div>
  );
}
