'use client';

import { useEffect, useState } from 'react';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { GRAPH_STATUS_META } from './GraphHealthBadge';
import { EMBED_NODE, layoutEmbed, type EmbedPayload } from './embed-layout';
import { STATUS_HEX } from './model';
import type { BsStatus } from '@/lib/business-services/contract';

const statusOf = (status: string): BsStatus => (status in GRAPH_STATUS_META ? (status as BsStatus) : 'UNKNOWN');

/** The anonymized graph for a share token, drawn as plain SVG with a text list underneath. */
export default function GraphEmbed({ token }: { token: string }) {
  const [state, setState] = useState<'loading' | 'missing' | EmbedPayload>('loading');
  useEffect(() => {
    let stale = false;
    fetch(`/api/graph-embed/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(response => (response.ok ? (response.json() as Promise<EmbedPayload>) : null))
      .then(payload => !stale && setState(payload ?? 'missing'))
      .catch(() => !stale && setState('missing'));
    return () => {
      stale = true;
    };
  }, [token]);

  if (state === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading graph…</p>;
  if (state === 'missing')
    return (
      <InlineNotice tone="warning">
        This link is not valid, has expired, or sharing has been turned off.
      </InlineNotice>
    );

  const { nodes, edges, width, height } = layoutEmbed(state);
  const at = new Map(nodes.map(node => [node.ref, node]));
  return (
    <>
      <h1 className="font-display text-lg font-semibold">Dependency graph</h1>
      <p className="text-xs text-muted-foreground">
        Read-only and anonymized: services are labelled B (business) and S (technical). Refreshes when the page is
        reloaded.
      </p>
      {state.truncated && <InlineNotice tone="info">Only part of a large graph is shown.</InlineNotice>}
      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to show.</p>
      ) : (
        <div className="overflow-auto rounded-lg border bg-card">
          <svg
            role="img"
            aria-label={`Dependency graph with ${nodes.length} services. A list follows.`}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className="max-w-none"
          >
            <defs>
              <marker id="embed-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" className="fill-muted-foreground" />
              </marker>
            </defs>
            {edges.map(edge => {
              const a = at.get(edge.from)!;
              const b = at.get(edge.to)!;
              const x1 = a.x + EMBED_NODE.width;
              const y1 = a.y + EMBED_NODE.height / 2;
              const x2 = b.x;
              const y2 = b.y + EMBED_NODE.height / 2;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${edge.kind}:${edge.from}>${edge.to}`}
                  d={`M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                  fill="none"
                  className="stroke-muted-foreground"
                  strokeWidth={edge.kind === 'member' ? 1 : 1.5}
                  strokeDasharray={edge.kind === 'member' ? '2 3' : undefined}
                  markerEnd="url(#embed-arrow)"
                />
              );
            })}
            {nodes.map(node => (
              <g key={node.ref} transform={`translate(${node.x} ${node.y})`}>
                <rect
                  width={EMBED_NODE.width}
                  height={EMBED_NODE.height}
                  rx={node.kind === 'bs' ? 4 : 14}
                  className="fill-card stroke-border"
                />
                <rect width={6} height={EMBED_NODE.height} rx={3} fill={STATUS_HEX[statusOf(node.status)]} />
                <text x={16} y={EMBED_NODE.height / 2 + 4} className="fill-foreground text-xs font-medium">
                  {node.ref}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 md:grid-cols-4">
        {nodes.map(node => (
          <li key={node.ref} className="flex items-center justify-between gap-2">
            <span className="font-medium">{node.ref}</span>
            <span className="text-xs text-muted-foreground">{GRAPH_STATUS_META[statusOf(node.status)].label}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
