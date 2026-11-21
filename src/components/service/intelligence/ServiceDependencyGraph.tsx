import type {
  NeighbourEdge,
  NeighbourNode,
  ServiceDependencyNeighbourhood,
} from '@/lib/intelligence/surfaces/service-intelligence';
import { OVERVIEW_CHART_VARS } from '@/components/intelligence/overview/primitives';
import { cn } from '@/lib/utils';

/**
 * The service between what it depends on (left) and what depends on it (right), as plain server-rendered
 * SVG: no client JavaScript. Follows the chart kit's emphasis form: one accent for the focused service,
 * gray for context, and the reserved status tokens only for a service with open incidents, always with
 * the count in text. A suggested edge is dashed and labelled "Suggested", so it never relies on the stroke alone.
 *
 * The diagram is decorative for assistive technology (`aria-hidden`): the list rendered beside it by
 * `DependenciesPanel` carries every edge, and is the only form shown on narrow screens.
 */

const WIDTH = 720;
const NODE_W = 196;
const NODE_H = 36;
const ROW = 52;
const TOP = 34;
/** Per side; further neighbours are summarised as "+N more" and remain in the list. */
export const GRAPH_MAX_PER_SIDE = 7;

const COLUMN_X = { UPSTREAM: 0, FOCUS: (WIDTH - NODE_W) / 2, DOWNSTREAM: WIDTH - NODE_W } as const;

const clip = (name: string, max = 22) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

function incidentTone(node: NeighbourNode): string {
  return node.highestOpenUrgency === 'HIGH' ? 'fill-status-critical' : 'fill-status-elevated';
}

function Node({
  node,
  x,
  y,
  focus = false,
  href,
}: {
  node: NeighbourNode;
  x: number;
  y: number;
  focus?: boolean;
  href?: string;
}) {
  const body = (
    <g>
      <title>
        {node.name}
        {node.openIncidents > 0
          ? ` · ${node.openIncidents} open incident${node.openIncidents === 1 ? '' : 's'}`
          : ' · no open incidents'}
      </title>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        className={cn(
          'fill-card',
          focus ? 'stroke-[var(--overview-accent)]' : 'stroke-[var(--overview-context)]'
        )}
        strokeWidth={focus ? 2 : 1}
      />
      {node.openIncidents > 0 && (
        <circle cx={x + 14} cy={y + NODE_H / 2} r={4} className={incidentTone(node)} />
      )}
      <text
        x={x + (node.openIncidents > 0 ? 26 : 12)}
        y={y + NODE_H / 2 + 4}
        className={cn('fill-foreground text-xs', focus && 'font-semibold')}
      >
        {clip(node.name, node.openIncidents > 0 ? 17 : 22)}
      </text>
      {node.openIncidents > 0 && (
        <text
          x={x + NODE_W - 10}
          y={y + NODE_H / 2 + 4}
          textAnchor="end"
          className="fill-muted-foreground text-2xs"
        >
          {node.openIncidents} open
        </text>
      )}
    </g>
  );
  // Mouse shortcut only: the diagram is aria-hidden, so keyboard users reach these through the list.
  return href ? (
    <a href={href} tabIndex={-1}>
      {body}
    </a>
  ) : (
    body
  );
}

export default function ServiceDependencyGraph({ data }: { data: ServiceDependencyNeighbourhood }) {
  const byId = new Map(data.neighbours.map(node => [node.id, node]));
  const side = (direction: NeighbourEdge['direction']) => {
    const seen = new Set<string>();
    const edges = data.edges.filter(edge => {
      if (edge.direction !== direction || seen.has(edge.neighbourId)) return false;
      seen.add(edge.neighbourId);
      return true;
    });
    return { shown: edges.slice(0, GRAPH_MAX_PER_SIDE), more: edges.length - GRAPH_MAX_PER_SIDE };
  };
  const upstream = side('UPSTREAM');
  const downstream = side('DOWNSTREAM');
  const rows = Math.max(upstream.shown.length, downstream.shown.length, 1);
  const height = TOP + rows * ROW + 18;
  const focusY = TOP + ((rows - 1) * ROW) / 2;
  const rowY = (index: number, count: number) => TOP + index * ROW + ((rows - count) * ROW) / 2;

  const column = (
    direction: 'UPSTREAM' | 'DOWNSTREAM',
    group: ReturnType<typeof side>,
    heading: string
  ) => {
    const x = direction === 'UPSTREAM' ? COLUMN_X.UPSTREAM : COLUMN_X.DOWNSTREAM;
    const focusEdgeX = direction === 'UPSTREAM' ? COLUMN_X.FOCUS : COLUMN_X.FOCUS + NODE_W;
    const nodeEdgeX = direction === 'UPSTREAM' ? x + NODE_W : x;
    return (
      <g data-graph-column={direction.toLowerCase()}>
        <text
          x={direction === 'UPSTREAM' ? x : x + NODE_W}
          y={14}
          textAnchor={direction === 'UPSTREAM' ? 'start' : 'end'}
          className="fill-muted-foreground text-2xs font-medium"
        >
          {heading}
        </text>
        {group.shown.map((edge, index) => {
          const node = byId.get(edge.neighbourId);
          if (!node) return null;
          const y = rowY(index, group.shown.length);
          const suggested = edge.status === 'SUGGESTED';
          const midX = (focusEdgeX + nodeEdgeX) / 2;
          return (
            <g key={edge.id} data-edge-status={edge.status.toLowerCase()}>
              <line
                x1={nodeEdgeX}
                y1={y + NODE_H / 2}
                x2={focusEdgeX}
                y2={focusY + NODE_H / 2}
                className="stroke-[var(--overview-context)]"
                strokeWidth={suggested ? 1.5 : 2}
                strokeDasharray={suggested ? '5 4' : undefined}
              />
              {suggested && (
                <text
                  x={midX}
                  y={(y + focusY) / 2 + NODE_H / 2 - 5}
                  textAnchor="middle"
                  className="fill-muted-foreground text-2xs"
                >
                  Suggested
                </text>
              )}
              <Node
                node={node}
                x={x}
                y={y}
                href={`/services/${encodeURIComponent(node.id)}?tab=intelligence`}
              />
            </g>
          );
        })}
        {group.more > 0 && (
          <text
            x={direction === 'UPSTREAM' ? x : x + NODE_W}
            y={height - 4}
            textAnchor={direction === 'UPSTREAM' ? 'start' : 'end'}
            className="fill-muted-foreground text-2xs"
          >
            +{group.more} more in the list
          </text>
        )}
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      aria-hidden="true"
      data-testid="service-dependency-graph"
      className={cn('hidden h-auto w-full max-w-3xl sm:block', OVERVIEW_CHART_VARS)}
    >
      {column('UPSTREAM', upstream, 'Depends on')}
      {column('DOWNSTREAM', downstream, 'Depended on by')}
      <Node node={data.focus} x={COLUMN_X.FOCUS} y={focusY} focus />
    </svg>
  );
}
