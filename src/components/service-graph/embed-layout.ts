/**
 * A small deterministic layered layout for the public embed (anonymized refs only). Business
 * services sit in the first column, then technical services by how far they are from anything that
 * depends on them. No ELK, no worker: the embed has to load fast with no app chrome.
 */
export type EmbedPayload = {
  truncated: boolean;
  services: Array<{ ref: string; status: string }>;
  businessServices: Array<{ ref: string; status: string }>;
  /** `from` is the dependency (upstream), `to` the dependent. */
  dependencies: Array<{ from: string; to: string }>;
  members: Array<{ businessService: string; service: string }>;
};

export type EmbedNode = { ref: string; status: string; kind: 'bs' | 'svc'; x: number; y: number };
export type EmbedEdge = { from: string; to: string; kind: 'dependency' | 'member' };

export const EMBED_NODE = { width: 96, height: 32, gapX: 72, gapY: 16, pad: 16 } as const;

export function layoutEmbed(payload: EmbedPayload): {
  nodes: EmbedNode[];
  edges: EmbedEdge[];
  width: number;
  height: number;
} {
  const known = new Set(payload.services.map(s => s.ref));
  const dependentsOf = new Map<string, string[]>();
  for (const edge of payload.dependencies)
    if (known.has(edge.from) && known.has(edge.to))
      (dependentsOf.get(edge.from) ?? dependentsOf.set(edge.from, []).get(edge.from)!).push(edge.to);
  // Column = longest chain of dependents above the service. The visiting set breaks any cycle.
  const memo = new Map<string, number>();
  const depth = (ref: string, visiting = new Set<string>()): number => {
    const cached = memo.get(ref);
    if (cached !== undefined) return cached;
    if (visiting.has(ref)) return 0;
    visiting.add(ref);
    const above = payload.dependencies.filter(e => e.from === ref && known.has(e.to));
    const value = above.length ? 1 + Math.max(...above.map(e => depth(e.to, visiting))) : 0;
    visiting.delete(ref);
    memo.set(ref, value);
    return value;
  };
  const columns: EmbedNode[][] = [];
  const place = (ref: string, status: string, kind: 'bs' | 'svc', column: number) =>
    // eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input
    (columns[column] ??= []).push({ ref, status, kind, x: 0, y: 0 });
  const hasBs = payload.businessServices.length > 0;
  if (hasBs) for (const bs of payload.businessServices) place(bs.ref, bs.status, 'bs', 0);
  for (const s of payload.services) place(s.ref, s.status, 'svc', depth(s.ref) + (hasBs ? 1 : 0));
  const filled = columns.filter(Boolean);
  const { width, height, gapX, gapY, pad } = EMBED_NODE;
  filled.forEach((column, c) =>
    column.forEach((node, r) => {
      node.x = pad + c * (width + gapX);
      node.y = pad + r * (height + gapY);
    })
  );
  const nodes = filled.flat();
  const refs = new Set(nodes.map(n => n.ref));
  return {
    nodes,
    edges: [
      // Drawn from the dependent to what it depends on, like the app's graph.
      ...payload.dependencies
        .filter(e => refs.has(e.from) && refs.has(e.to))
        .map((e): EmbedEdge => ({ from: e.to, to: e.from, kind: 'dependency' })),
      ...payload.members
        .filter(m => refs.has(m.businessService) && refs.has(m.service))
        .map((m): EmbedEdge => ({ from: m.businessService, to: m.service, kind: 'member' })),
    ],
    width: pad * 2 + filled.length * width + Math.max(filled.length - 1, 0) * gapX,
    height: pad * 2 + Math.max(0, ...filled.map(c => c.length)) * (height + gapY) - gapY,
  };
}
