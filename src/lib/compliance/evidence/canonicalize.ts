/**
 * Canonicalizes values deterministically for hashing.
 * - Recursively sorts object keys lexicographically.
 * - Preserves array order.
 * - Formats Dates to ISO 8601 strings.
 * - Rejects functions or circular structures.
 */
export function canonicalizeEvidenceValue(val: unknown, seen = new WeakSet<object>()): unknown {
  if (val === null || val === undefined) {
    return null;
  }

  if (val instanceof Date) {
    return val.toISOString();
  }

  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
    return val;
  }

  if (typeof val === 'bigint') {
    return val.toString();
  }

  if (typeof val !== 'object') {
    throw new TypeError(`Cannot canonicalize unsupported type: ${typeof val}`);
  }

  if (seen.has(val)) {
    throw new TypeError('Circular structure detected during evidence canonicalization.');
  }

  seen.add(val);

  try {
    if (Array.isArray(val)) {
      return val.map(item => canonicalizeEvidenceValue(item, seen));
    }

    const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      // eslint-disable-next-line security/detect-object-injection
      const item = (val as Record<string, unknown>)[key];
      if (item !== undefined) {
        // eslint-disable-next-line security/detect-object-injection
        result[key] = canonicalizeEvidenceValue(item, seen);
      }
    }
    return result;
  } finally {
    seen.delete(val);
  }
}

/**
 * Returns a deterministic, canonical JSON string for evidence hashing.
 */
export function toCanonicalJson(val: unknown): string {
  const canonical = canonicalizeEvidenceValue(val);
  return JSON.stringify(canonical);
}
