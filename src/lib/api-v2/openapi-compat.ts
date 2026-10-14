/**
 * Backward-compatibility check between two OpenAPI documents. It reports changes
 * that can break an existing client: removed operations, removed or narrowed
 * response fields, new required request inputs and narrowed request enums.
 * Additive changes (new operations, new optional inputs, new response fields)
 * are allowed.
 */
type Json = Record<string, any>;
const METHODS = ['get', 'post', 'patch', 'put', 'delete'];

function deref(doc: Json, node: any, seen = new Set<string>()): any {
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    if (seen.has(node.$ref)) return { type: 'object', 'x-recursive': node.$ref };
    const target = node.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((n: any, part: string) => n?.[part], doc);
    return deref(doc, target, new Set(seen).add(node.$ref));
  }
  return node;
}

function typesOf(schema: Json): string[] {
  const t = schema?.type;
  return Array.isArray(t) ? t : t ? [t] : [];
}

function compareSchema(
  baseDoc: Json,
  nextDoc: Json,
  base: any,
  next: any,
  mode: 'request' | 'response',
  path: string,
  out: string[],
  depth = 0
) {
  if (depth > 8) return;
  const b = deref(baseDoc, base);
  const n = deref(nextDoc, next);
  if (!b || !n || b['x-recursive'] || n['x-recursive']) return;

  const bt = typesOf(b);
  const nt = typesOf(n);
  if (bt.length && nt.length) {
    const lost = bt.filter(t => !nt.includes(t));
    const gained = nt.filter(t => !bt.includes(t));
    if (mode === 'response' && lost.length)
      out.push(`${path}: response type no longer ${lost.join('|')}`);
    if (mode === 'request' && lost.length)
      out.push(`${path}: request no longer accepts ${lost.join('|')}`);
    if (mode === 'response' && gained.length && !gained.every(t => t === 'null')) {
      out.push(`${path}: response type widened to include ${gained.join('|')}`);
    }
  }

  if (Array.isArray(b.enum) && Array.isArray(n.enum)) {
    if (mode === 'request') {
      const removed = b.enum.filter((v: unknown) => !n.enum.includes(v));
      if (removed.length) out.push(`${path}: request enum narrowed, removed ${removed.join(', ')}`);
    }
  }

  if (b.properties) {
    for (const [key, schema] of Object.entries<any>(b.properties)) {
      const nextProp = n.properties?.[key];
      if (!nextProp) {
        if (mode === 'response') out.push(`${path}.${key}: response field removed`);
        else out.push(`${path}.${key}: request field removed`);
        continue;
      }
      compareSchema(baseDoc, nextDoc, schema, nextProp, mode, `${path}.${key}`, out, depth + 1);
    }
  }
  if (mode === 'request') {
    const baseRequired = new Set<string>(b.required ?? []);
    for (const key of n.required ?? []) {
      if (!baseRequired.has(key)) out.push(`${path}.${key}: field became required`);
    }
  }
  if (mode === 'response') {
    const nextRequired = new Set<string>(n.required ?? []);
    for (const key of b.required ?? []) {
      if (!nextRequired.has(key)) out.push(`${path}.${key}: response field no longer guaranteed`);
    }
  }
  if (b.items && n.items) {
    compareSchema(baseDoc, nextDoc, b.items, n.items, mode, `${path}[]`, out, depth + 1);
  }
}

export function findBreakingChanges(baseDoc: Json, nextDoc: Json): string[] {
  const out: string[] = [];
  for (const [path, baseItem] of Object.entries<Json>(baseDoc.paths ?? {})) {
    for (const method of METHODS) {
      const baseOp = baseItem[method];
      if (!baseOp) continue;
      const label = `${method.toUpperCase()} ${path}`;
      const nextOp = nextDoc.paths?.[path]?.[method];
      if (!nextOp) {
        out.push(`${label}: operation removed`);
        continue;
      }
      if (baseOp.operationId && baseOp.operationId !== nextOp.operationId) {
        out.push(
          `${label}: operationId changed from ${baseOp.operationId} to ${nextOp.operationId}`
        );
      }

      const baseParams: Json[] = baseOp.parameters ?? [];
      const nextParams: Json[] = nextOp.parameters ?? [];
      for (const param of nextParams) {
        const existing = baseParams.find(p => p.name === param.name && p.in === param.in);
        if (param.required && !existing?.required) {
          out.push(`${label}: parameter ${param.in}:${param.name} became required`);
        }
        if (existing) {
          compareSchema(
            baseDoc,
            nextDoc,
            existing.schema,
            param.schema,
            'request',
            `${label} ${param.name}`,
            out
          );
        }
      }

      const baseBody = baseOp.requestBody?.content?.['application/json']?.schema;
      const nextBody = nextOp.requestBody?.content?.['application/json']?.schema;
      if (baseBody && nextBody)
        compareSchema(baseDoc, nextDoc, baseBody, nextBody, 'request', `${label} body`, out);
      if (!baseOp.requestBody?.required && nextOp.requestBody?.required) {
        out.push(`${label}: request body became required`);
      }

      for (const [status, baseResponse] of Object.entries<Json>(baseOp.responses ?? {})) {
        if (!status.startsWith('2')) continue;
        const nextResponse = nextOp.responses?.[status];
        if (!nextResponse) {
          out.push(`${label}: success response ${status} removed`);
          continue;
        }
        const bs = deref(baseDoc, baseResponse)?.content?.['application/json']?.schema;
        const ns = deref(nextDoc, nextResponse)?.content?.['application/json']?.schema;
        if (bs && ns)
          compareSchema(baseDoc, nextDoc, bs, ns, 'response', `${label} ${status}`, out);
        if (bs && !ns) out.push(`${label}: ${status} response body removed`);
      }
    }
  }
  return out;
}
