/**
 * Wire projections: what an agent receives, never what is reviewed or hashed. The catalog keeps
 * its canonical schemas byte for byte (contract hashes cover them); these helpers return copies.
 */

import { MCP_PROJECTION_DEPTH, MCP_SENSITIVE_KEY } from '../core/projection';

type Json = unknown;
type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isEmptyObjectSchema = (value: unknown) =>
  isObject(value) &&
  (!isObject(value.properties) || Object.keys(value.properties).length === 0) &&
  !value.additionalProperties &&
  !value.anyOf &&
  !value.oneOf &&
  !value.allOf;

// Keywords whose value is a map of subschemas, a subschema, or a list of subschemas.
const SCHEMA_MAPS = new Set(['properties', '$defs', 'definitions', 'patternProperties']);
const SCHEMA_VALUES = new Set(['items', 'additionalProperties', 'not', 'contains']);
const SCHEMA_LISTS = new Set(['oneOf', 'anyOf', 'allOf', 'prefixItems']);

/**
 * Drops fragments that carry no constraint: `$schema` URLs, empty `$defs` and `required` arrays.
 * Keyword values that are data (enum, const, default, examples) are copied untouched, and
 * property names are never treated as keywords.
 */
function stripSchema(schema: Json): Json {
  if (!isObject(schema)) return schema;
  // Entries, not assignment: a key such as __proto__ stays an own property.
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'required' && Array.isArray(value) && value.length === 0) continue;
    if (SCHEMA_MAPS.has(key) && isObject(value)) {
      if (key !== 'properties' && Object.keys(value).length === 0) continue;
      entries.push([
        key,
        Object.fromEntries(
          Object.entries(value).map(([name, child]) => [name, stripSchema(child)])
        ),
      ]);
    } else if (SCHEMA_VALUES.has(key) && isObject(value)) {
      entries.push([key, stripSchema(value)]);
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      entries.push([key, value.map(stripSchema)]);
    } else {
      entries.push([key, value]);
    }
  }
  return Object.fromEntries(entries);
}

/**
 * The tool-facing view of an operation input schema. Also omits the `path` and `query` envelopes
 * of an operation that takes no such parameters (an object that admits only `{}`).
 */
export function wireInputSchema(schema: JsonObject): JsonObject {
  const stripped = stripSchema(schema) as JsonObject;
  if (!isObject(stripped.properties)) return stripped;
  const required = Array.isArray(stripped.required) ? (stripped.required as string[]) : [];
  const properties = Object.fromEntries(
    Object.entries(stripped.properties).filter(
      ([name, child]) =>
        !((name === 'path' || name === 'query') && !required.includes(name)) ||
        !isEmptyObjectSchema(child)
    )
  );
  return { ...stripped, properties };
}

/** Strips a whole JSON Schema document (no envelope pruning), e.g. a described result body. */
export function wireSchema<T extends Json>(schema: T): T {
  return stripSchema(schema) as T;
}

/**
 * Removes `null` values and empty arrays/objects from object members of a tool result: an
 * absent member reads the same as a null or empty one. Array elements are never removed, a
 * member named `data` stays explicit even when null or empty, and `evidence` (provenance and the
 * untrusted-data warning) is passed through unchanged.
 */
export function compactResult(value: Json): Json {
  if (Array.isArray(value)) return value.map(compactResult);
  if (!isObject(value)) return value;
  const entries: [string, unknown][] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'evidence') {
      entries.push([key, child]);
      continue;
    }
    const compact = compactResult(child);
    if (compact === undefined) continue;
    if (key !== 'data') {
      if (compact === null) continue;
      if (Array.isArray(compact) && compact.length === 0) continue;
      if (isObject(compact) && Object.keys(compact).length === 0) continue;
    }
    entries.push([key, compact]);
  }
  // Entries, not assignment: a domain key such as __proto__ stays an own property.
  return Object.fromEntries(entries);
}

const REF_HOPS = 16;
// Keywords a projected value may no longer satisfy, or that only constrain absent members.
const DROPPED = new Set([
  '$ref',
  '$defs',
  'definitions',
  '$schema',
  'additionalProperties',
  'patternProperties',
  'required',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'not',
  'discriminator',
  'nullable',
  'oneOf',
  'example',
  'examples',
]);

function typesOf(schema: JsonObject): string[] | undefined {
  if (typeof schema.type === 'string') return [schema.type];
  return Array.isArray(schema.type) ? (schema.type as string[]) : undefined;
}

/**
 * One subschema as projectMcpData leaves its value: `depth` counts like the projection does,
 * from the root of the domain result. References are inlined, so the depth is exact.
 */
function projectSchema(
  schema: Json,
  definitions: ReadonlyMap<string, Json>,
  depth: number,
  hops = 0
): Json {
  if (depth > MCP_PROJECTION_DEPTH || !isObject(schema)) return {};
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace(/^#\/\$defs\//, '');
    return hops < REF_HOPS && definitions.has(name)
      ? projectSchema(definitions.get(name), definitions, depth, hops + 1)
      : {};
  }
  const entries: [string, unknown][] = [];
  let types = typesOf(schema);
  // OpenAPI 3.0 `nullable` is not JSON Schema; a validator would refuse the null it allows.
  if (schema.nullable === true && types && !types.includes('null')) types = [...types, 'null'];
  const values = [
    ...(Array.isArray(schema.enum) ? schema.enum : []),
    ...('const' in schema ? [schema.const] : []),
  ];
  // Any string may be rewritten (redacted, invisible characters stripped), so fixed string
  // values can no longer be promised.
  const rewritable = types?.includes('string') || values.some(value => typeof value === 'string');
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED.has(key)) continue;
    if (key === 'type') {
      entries.push([key, types && types.length === 1 ? types[0] : types]);
    } else if ((key === 'enum' || key === 'const') && rewritable) {
      continue;
    } else if (key === 'properties' && isObject(value)) {
      entries.push([
        key,
        Object.fromEntries(
          Object.entries(value).map(([name, child]) => [
            name,
            MCP_SENSITIVE_KEY.test(name)
              ? { type: 'string', const: '[REDACTED]' }
              : projectSchema(child, definitions, depth + 1),
          ])
        ),
      ]);
    } else if (key === 'items' || key === 'contains') {
      entries.push([key, projectSchema(value, definitions, depth + 1)]);
    } else if (key === 'prefixItems' && Array.isArray(value)) {
      entries.push([key, value.map(child => projectSchema(child, definitions, depth + 1))]);
    } else if ((key === 'anyOf' || key === 'allOf') && Array.isArray(value)) {
      entries.push([key, value.map(child => projectSchema(child, definitions, depth, hops))]);
    } else {
      entries.push([key, value]);
    }
  }
  // Rewritten strings can make several branches match, which oneOf would refuse.
  if (Array.isArray(schema.oneOf))
    entries.push([
      'anyOf',
      schema.oneOf.map(child => projectSchema(child, definitions, depth, hops)),
    ]);
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/** The evidence every catalog result carries; see executeMcpOperation. */
const EVIDENCE_SCHEMA = {
  type: 'object',
  required: ['operationId', 'source', 'observedAt', 'requestId', 'redactedFields', 'warnings'],
  properties: {
    operationId: { type: 'string' },
    source: { type: 'string' },
    observedAt: { type: 'string' },
    requestId: { type: 'string' },
    etag: { type: ['string', 'null'] },
    redactedFields: { type: 'array', items: { type: 'string' } },
    redactedCount: { type: 'integer', minimum: 0 },
    limits: { type: 'object' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * The result schema an agent can rely on: the success body as projectMcpData and compactResult
 * deliver it, not the REST contract. Sensitive members are the redaction marker whatever their
 * declared type; strings lose formats, patterns, lengths and fixed values; maps are open, since a
 * dynamic key may itself be redacted; nothing below `data` is required, because null and empty
 * members are dropped; values past the projection depth may be anything; and `data` is null for
 * a body-less (204) response. Not hashed: derived from the hashed contract.
 */
export function projectedOutputSchema(response: JsonObject | null): JsonObject {
  const definitions = new Map(
    Object.entries(isObject(response?.$defs) ? (response.$defs as JsonObject) : {})
  );
  const data = response ? projectSchema(response, definitions, 0) : {};
  return {
    type: 'object',
    required: ['evidence', 'data'],
    properties: {
      evidence: EVIDENCE_SCHEMA,
      data: isObject(data) && Object.keys(data).length ? { anyOf: [data, { type: 'null' }] } : {},
    },
  };
}
