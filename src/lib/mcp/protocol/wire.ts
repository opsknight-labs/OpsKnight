/**
 * Wire projections: what an agent receives, never what is reviewed or hashed. The catalog keeps
 * its canonical schemas byte for byte (contract hashes cover them); these helpers return copies.
 */

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
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if (key === 'required' && Array.isArray(value) && value.length === 0) continue;
    if (SCHEMA_MAPS.has(key) && isObject(value)) {
      if (key !== 'properties' && Object.keys(value).length === 0) continue;
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, stripSchema(child)])
      );
    } else if (SCHEMA_VALUES.has(key) && isObject(value)) {
      result[key] = stripSchema(value);
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      result[key] = value.map(stripSchema);
    } else {
      result[key] = value;
    }
  }
  return result;
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
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'evidence') {
      result[key] = child;
      continue;
    }
    const compact = compactResult(child);
    if (compact === undefined) continue;
    if (key !== 'data') {
      if (compact === null) continue;
      if (Array.isArray(compact) && compact.length === 0) continue;
      if (isObject(compact) && Object.keys(compact).length === 0) continue;
    }
    result[key] = compact;
  }
  return result;
}
