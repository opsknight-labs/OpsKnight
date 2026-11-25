import 'server-only';
import Link from 'next/link';
import { Network } from 'lucide-react';
import type { ToneKey } from '@/components/patterns/status-tone';
import {
  getServiceGraphForActor,
  type GraphNode,
} from '@/lib/intelligence/dependencies/graph-view';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { GRAPH_STATUS_META } from './GraphHealthBadge';

const BOX = { width: 176, height: 36 };
const GAP_X = 72;
const GAP_Y = 10;
const PER_COLUMN = 8;
const STRIPE: Record<ToneKey, string> = {
  critical: 'fill-status-critical',
  elevated: 'fill-status-elevated',
  ok: 'fill-status-ok',
  info: 'fill-status-info',
  shift: 'fill-status-shift',
  orange: 'fill-orange-500',
  neutral: 'fill-ink-400',
};

type Placed = { node: GraphNode; x: number; y: number };

function column(nodes: GraphNode[], index: number) {
  const shown = nodes.slice(0, PER_COLUMN);
  return {
    placed: shown.map((node, row): Placed => ({
      node,
      x: index * (BOX.width + GAP_X),
      y: row * (BOX.height + GAP_Y),
    })),
    more: nodes.length - shown.length,
  };
}

/**
 * The business service's members and what is one hop away, in the canvas's order: what depends on
 * them (left), the members, and what they depend on (right). Arrows point to the dependency, as on the
 * canvas. A plain server-rendered SVG; the interactive canvas is one click away.
 */
export default async function DependencyMiniGraph({
  businessServiceId,
}: {
  businessServiceId: string;
}) {
  const actor = await getCurrentAuthorizationActor();
  const graph = await getServiceGraphForActor(actor, prisma, {
    focus: { kind: 'bs', id: businessServiceId },
    hops: 1,
    access: 'service',
  });
  if (!graph) return null;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const memberIds = new Set(
    graph.memberEdges
      .filter(edge => edge.businessServiceId === businessServiceId)
      .map(edge => edge.serviceId)
  );
  if (memberIds.size === 0) return null;
  const active = graph.edges.filter(edge => edge.status === 'ACTIVE');
  const pick = (ids: Iterable<string>) =>
    [...new Set(ids)]
      .map(id => byId.get(id))
      .filter((node): node is GraphNode => !!node)
      .sort((a, b) => a.name.localeCompare(b.name));
  const members = pick(memberIds);
  const dependsOn = pick(
    active
      .filter(e => memberIds.has(e.downstreamServiceId) && !memberIds.has(e.upstreamServiceId))
      .map(e => e.upstreamServiceId)
  );
  const usedBy = pick(
    active
      .filter(e => memberIds.has(e.upstreamServiceId) && !memberIds.has(e.downstreamServiceId))
      .map(e => e.downstreamServiceId)
  );
  const columns = [column(usedBy, 0), column(members, 1), column(dependsOn, 2)];
  const at = new Map(columns.flatMap(col => col.placed.map(p => [p.node.id, p])));
  const rows = Math.max(...columns.map(col => col.placed.length + (col.more ? 1 : 0)), 1);
  const width = 3 * BOX.width + 2 * GAP_X;
  const height = rows * (BOX.height + GAP_Y) + 24;
  const lines = active.flatMap(edge => {
    const from = at.get(edge.downstreamServiceId);
    const to = at.get(edge.upstreamServiceId);
    // Only member ↔ neighbour edges; a line inside one column would cross the boxes.
    if (!from || !to || from.x === to.x) return [];
    // The dependent is always in a column left of its dependency, so the arrow runs left to right.
    return [
      {
        key: edge.id,
        x1: from.x + BOX.width,
        y1: from.y + BOX.height / 2 + 24,
        x2: to.x,
        y2: to.y + BOX.height / 2 + 24,
      },
    ];
  });
  const headings = ['Used by', 'Members', 'Depends on'];
  const summary = `${members.length} member services; ${usedBy.length} services depend on them and they depend on ${dependsOn.length} services (arrows point to the dependency).`;

  return (
    <figure className="space-y-2 rounded-lg border bg-card p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full max-w-3xl"
        role="img"
        aria-label={summary}
      >
        <defs>
          <marker
            id="mini-graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {headings.map((label, index) => (
          <text
            key={label}
            x={index * (BOX.width + GAP_X)}
            y={12}
            className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-wide"
          >
            {label}
          </text>
        ))}
        {lines.map(({ key, ...line }) => (
          <line
            key={key}
            {...line}
            className="stroke-muted-foreground/60"
            strokeWidth={1.5}
            markerEnd="url(#mini-graph-arrow)"
          />
        ))}
        {columns.map((col, index) => (
          <g key={index}>
            {col.placed.map(({ node, x, y }) => {
              const meta = GRAPH_STATUS_META[node.status] ?? GRAPH_STATUS_META.UNKNOWN;
              return (
                <a key={node.id} href={`/services/${node.id}`}>
                  <title>{`${node.name}: ${meta.label}${node.openIncidents ? `, ${node.openIncidents} open incidents` : ''}`}</title>
                  <rect
                    x={x}
                    y={y + 24}
                    width={BOX.width}
                    height={BOX.height}
                    rx={10}
                    className="fill-card stroke-border hover:stroke-ring"
                  />
                  <rect
                    x={x}
                    y={y + 24}
                    width={4}
                    height={BOX.height}
                    rx={2}
                    className={STRIPE[meta.tone]}
                  />
                  <text
                    x={x + 12}
                    y={y + 24 + 15}
                    className="fill-foreground text-[11px] font-medium"
                  >
                    {node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name}
                  </text>
                  <text x={x + 12} y={y + 24 + 28} className="fill-muted-foreground text-[9px]">
                    {meta.label}
                    {node.openIncidents ? ` · ${node.openIncidents} open` : ''}
                  </text>
                </a>
              );
            })}
            {col.more > 0 && (
              <text
                x={index * (BOX.width + GAP_X)}
                y={col.placed.length * (BOX.height + GAP_Y) + 24 + 14}
                className="fill-muted-foreground text-[10px]"
              >
                +{col.more} more
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{summary}</span>
        <Link
          href={`/services/graph?focus=bs:${businessServiceId}`}
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          <Network className="h-3.5 w-3.5" aria-hidden="true" />
          Open in service graph
        </Link>
      </figcaption>
    </figure>
  );
}
