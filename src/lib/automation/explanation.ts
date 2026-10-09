import type { Prisma } from '@prisma/client';

export const MAX_AUTOMATION_DECISION_BYTES = 256 * 1024;
export const MAX_AUTOMATION_TRACE_BYTES = 256 * 1024;

/** Store long context scalars once; responder policy definitions remain directly readable. */
export function encodeExplanation(input: unknown, maxBytes: number): Prisma.InputJsonObject {
  const values: Array<string | null> = [];
  const index = new Map<string, number>();
  function encode(value: unknown): unknown {
    if (typeof value === 'string' && value.length > 256) {
      let position = index.get(value);
      if (position === undefined) {
        position = values.length;
        index.set(value, position);
        values.push(value);
      }
      return { automationValueRef: position };
    }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          key === 'responderPolicy' ? child : encode(child),
        ])
      );
    return value;
  }
  const encoded = encode(input) as Record<string, unknown>;
  if (!values.length && Buffer.byteLength(JSON.stringify(encoded), 'utf8') <= maxBytes)
    return encoded as Prisma.InputJsonObject;
  const output = {
    ...encoded,
    explanationEncoding: 'STRING_TABLE_V1',
    valueTable: values,
    omittedValues: [] as number[],
  };
  // Escaped control characters and many distinct enrichment writes can exceed the
  // valid scalar bounds in aggregate. Omit diagnostic values, never routing state.
  for (
    let position = values.length - 1;
    Buffer.byteLength(JSON.stringify(output), 'utf8') > maxBytes && position >= 0;
    position--
  ) {
    values.splice(position, 1, null);
    output.omittedValues.push(position);
  }
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > maxBytes) {
    // Keep the complete pinned policy and explicitly report omitted diagnostics.
    const source = input as Record<string, unknown>;
    return {
      responderPolicy: source.responderPolicy ?? null,
      snapshotUnavailable: source.snapshotUnavailable ?? false,
      diagnosticLevel: source.diagnosticLevel ?? 'FULL',
      outcome: source.outcome ?? null,
      actual: source.actual ?? null,
      fallbackReason: source.fallbackReason ?? null,
      shadowDifferent: source.shadowDifferent ?? false,
      diagnosticsOmitted: true,
    } as Prisma.InputJsonObject;
  }
  return output as unknown as Prisma.InputJsonObject;
}

/** Backward compatible with explanations written before string-table encoding. */
export function decodeExplanation(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const root = input as Record<string, unknown>;
  if (root.explanationEncoding !== 'STRING_TABLE_V1' || !Array.isArray(root.valueTable))
    return input;
  const values = root.valueTable;
  function decode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && Number.isInteger(record.automationValueRef)) {
      const position = record.automationValueRef as number;
      return position >= 0 && position < values.length ? values.at(position) : null;
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, decode(child)]));
  }
  return decode(root);
}
