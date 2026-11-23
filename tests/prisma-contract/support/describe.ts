/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import { Prisma } from '@prisma/client';

function isDecimal(value: object): boolean {
  const decimal = (Prisma as unknown as { Decimal?: { isDecimal?: (v: unknown) => boolean } })
    .Decimal;
  return decimal?.isDecimal?.(value) === true || value.constructor?.name === 'Decimal';
}

/** A stable, JSON-safe description of a value including its runtime type. */
export function describeValue(value: unknown): unknown {
  if (value === null) return { t: 'null' };
  if (value === undefined) return { t: 'undefined' };
  switch (typeof value) {
    case 'bigint':
      return { t: 'bigint', v: value.toString() };
    case 'number':
      return { t: 'number', v: Number.isFinite(value) ? value : String(value) };
    case 'string':
    case 'boolean':
      return { t: typeof value, v: value };
  }
  if (value instanceof Date) {
    return { t: 'Date', v: Number.isNaN(value.getTime()) ? 'Invalid' : value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return {
      t: 'bytes',
      ctor: value.constructor.name,
      v: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex'),
    };
  }
  if (Array.isArray(value)) return { t: 'array', v: value.map(describeValue) };
  if (typeof value === 'object' && isDecimal(value)) {
    return { t: 'Decimal', v: String(value) };
  }
  return {
    t: 'object',
    v: JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))),
  };
}

export function describeRow(row: Record<string, unknown> | undefined): unknown {
  if (!row) return { t: 'no-row' };
  return Object.fromEntries(
    Object.keys(row)
      .sort()
      .map(key => [key, describeValue(row[key])])
  );
}
