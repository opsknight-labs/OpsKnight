import { ALL_API_SCOPE_DEFINITIONS } from '@/lib/api-scope-registry';
import { V2_MUTATION_CONTRACT } from './mutation-contract';
import { V2_OPERATIONS } from './openapi-registry';
import { getOpenApiV2Spec } from './openapi';

/**
 * Renders the generated sections of docs/…/reference/api/v2.md from the same
 * registries that drive the OpenAPI document and runtime enforcement. The
 * committed Markdown is checked against this output in CI, so a documented
 * endpoint, scope or retry guarantee cannot drift from the implementation.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- arbitrary JSON documents / erased generic route plumbing
type Json = Record<string, any>;

const IDEMPOTENCY_LABEL = {
  required: 'required',
  supported: 'supported',
  natural: 'safe to repeat',
  never: 'not replayable',
} as const;

export function renderEndpointReference(): string {
  const spec = getOpenApiV2Spec() as Json;
  const byTag = new Map<string, string[]>();
  for (const definition of V2_OPERATIONS) {
    const operation = spec.paths[definition.path][definition.method] as Json;
    const tag: string = operation.tags?.[0] ?? 'Other';
    const contractKey = `${definition.method.toUpperCase()} ${`/api/v2${definition.path}`.replace(/\{(\w+)\}/g, '[$1]')}`;
    // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
    const contract = V2_MUTATION_CONTRACT[contractKey];
    const retry = contract ? ` Retries: ${IDEMPOTENCY_LABEL[contract.idempotency]}.` : '';
    const line =
      `- \`${definition.method.toUpperCase()} /api/v2${definition.path}\` ` +
      `(\`${definition.operationId}\`, scope \`${definition.scope}\`) — ${operation.summary}.${retry}`;
    byTag.set(tag, [...(byTag.get(tag) ?? []), line]);
  }
  return [...byTag.entries()]
    .map(([tag, lines]) => `### ${tag}\n\n${lines.join('\n')}`)
    .join('\n\n');
}

export function renderScopeReference(): string {
  const rows = ALL_API_SCOPE_DEFINITIONS.map(
    d =>
      `| \`${d.scope}\` | ${d.description}${d.status === 'reserved' ? ' **Not issuable.**' : ''} | ${d.issuableBy.join(', ')} |`
  );
  return ['| Scope | What it allows | Roles that can issue it |', '|---|---|---|', ...rows].join(
    '\n'
  );
}

export function renderMutationReference(): string {
  const rows = Object.entries(V2_MUTATION_CONTRACT).map(
    ([key, c]) =>
      `| \`${key.replace(/\[(\w+)\]/g, '{$1}')}\` | ${IDEMPOTENCY_LABEL[c.idempotency]} | ${c.concurrency === 'etag' ? (c.preconditionRequired ? 'Required If-Match (428 / 412)' : 'ETag / If-Match') : '—'} | ${c.rationale} |`
  );
  return ['| Operation | Idempotency | Concurrency | Why |', '|---|---|---|---|', ...rows].join(
    '\n'
  );
}

export const GENERATED_SECTIONS: Record<string, () => string> = {
  endpoints: renderEndpointReference,
  scopes: renderScopeReference,
  mutations: renderMutationReference,
};

const marker = (name: string, edge: 'BEGIN' | 'END') => `<!-- ${edge} GENERATED:${name} -->`;

/** Replace each generated block in `markdown` with freshly rendered content. */
export function applyGeneratedSections(markdown: string): string {
  let out = markdown;
  for (const [name, render] of Object.entries(GENERATED_SECTIONS)) {
    const begin = marker(name, 'BEGIN');
    const end = marker(name, 'END');
    const start = out.indexOf(begin);
    const stop = out.indexOf(end);
    if (start < 0 || stop < start) {
      throw new Error(`Missing generated block markers for "${name}"`);
    }
    out = `${out.slice(0, start + begin.length)}\n\n${render()}\n\n${out.slice(stop)}`;
  }
  return out;
}
