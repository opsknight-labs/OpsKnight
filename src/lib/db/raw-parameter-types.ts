/* eslint-disable security/detect-object-injection -- indexes are positions in SQL text and Prisma argument arrays */
/* eslint-disable security/detect-unsafe-regex -- anchored dollar-quote tag pattern without nested quantifiers */
import { Prisma } from '@prisma/client';
import type { ArgType, SqlQuery } from '@prisma/driver-adapter-utils';

/**
 * Prisma 5 bound raw-SQL parameters with types derived from their JavaScript values (measured
 * with pg_typeof on Prisma 5.22): integers and bigints as int8, other numbers and Decimals as
 * numeric, booleans as bool, strings as text, Dates as timestamptz, bytes as bytea, objects as
 * jsonb and arrays of strings/integers/booleans as text[]. Prisma 7 driver adapters send every
 * parameter untyped, so PostgreSQL infers types from context. Where the context does not
 * constrain the type (select lists, VALUES lists, jsonb_build_object, arithmetic between
 * parameters, ...) statements that worked before fail with 42P18/42725/42883 or return values
 * of a different JavaScript type.
 *
 * To keep the ~850 raw-SQL call sites behaving exactly as before, statements issued through
 * $queryRaw/$executeRaw (and their Unsafe variants) have each placeholder rewritten to an
 * explicit cast of the type Prisma 5 bound. A cast of an untyped parameter is equivalent to
 * binding it with that type. Prisma-generated model SQL is never rewritten.
 */

const MAX_TRACKED_STATEMENTS = 20_000;
const rawStatements = new Set<string>();

/** Mark SQL text as application raw SQL (called synchronously by the client wrapper). */
export function registerRawSql(sql: string): void {
  if (rawStatements.has(sql)) return;
  if (rawStatements.size >= MAX_TRACKED_STATEMENTS) {
    // Evict the oldest entry; Set iteration order is insertion order.
    rawStatements.delete(rawStatements.values().next().value as string);
  }
  rawStatements.add(sql);
}

export function isRegisteredRawSql(sql: string): boolean {
  return rawStatements.has(sql);
}

/** SQL text Prisma sends for a $queryRaw/$executeRaw(Unsafe) call, or undefined if unknown. */
export function rawSqlTextFromCall(method: string, args: unknown[]): string | undefined {
  const [first] = args;
  if (method.endsWith('Unsafe')) return typeof first === 'string' ? first : undefined;
  if (
    first &&
    typeof first === 'object' &&
    typeof (first as { text?: unknown }).text === 'string' &&
    Array.isArray((first as { values?: unknown }).values)
  ) {
    return (first as { text: string }).text; // Prisma.Sql; its .sql uses "?" placeholders
  }
  if (Array.isArray(first) && 'raw' in (first as object)) {
    // Tagged template: build it exactly as Prisma does (nested fragments are flattened).
    return Prisma.sql(first as unknown as TemplateStringsArray, ...args.slice(1)).text;
  }
  return undefined;
}

function isIntegerLike(value: unknown): boolean {
  if (typeof value === 'bigint') return true;
  if (typeof value === 'number') return Number.isInteger(value);
  return typeof value === 'string' && /^-?\d+$/.test(value);
}

function scalarCast(argType: ArgType, value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  switch (argType.scalarType) {
    case 'int':
    case 'bigint':
      return 'int8';
    case 'float':
    case 'decimal':
      if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
      return isIntegerLike(value) && typeof value !== 'string' ? 'int8' : 'numeric';
    case 'boolean':
      return 'bool';
    case 'string':
    case 'uuid':
    case 'enum':
      return typeof value === 'string' ? 'text' : undefined;
    case 'datetime':
      return 'timestamptz';
    case 'bytes':
      return 'bytea';
    case 'json':
      return 'jsonb';
    default:
      if (typeof value === 'boolean') return 'bool';
      if (typeof value === 'string') return 'text';
      return undefined;
  }
}

function listCast(argType: ArgType, value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  // Prisma 5 sent string/integer/boolean arrays as text[]; other element types failed to bind.
  const textual = value.every(
    element =>
      element === null ||
      typeof element === 'string' ||
      typeof element === 'boolean' ||
      isIntegerLike(element)
  );
  if (!textual) return undefined;
  if (argType.scalarType === 'datetime' || argType.scalarType === 'bytes') return undefined;
  return 'text[]';
}

export function prisma5ParameterCast(
  argType: ArgType | undefined,
  value: unknown
): string | undefined {
  if (!argType) return undefined;
  return argType.arity === 'list' ? listCast(argType, value) : scalarCast(argType, value);
}

/**
 * Rewrite `$n` placeholders (outside literals, quoted identifiers, comments and dollar-quoted
 * bodies) to `($n::type)` for the positions in `casts`.
 */
export function castPlaceholders(sql: string, casts: ReadonlyMap<number, string>): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" || ch === '"') {
      // Quoted literal or identifier; doubled quotes escape. E'' strings may also use \'.
      const escapes = ch === "'" && (sql[i - 1] === 'E' || sql[i - 1] === 'e');
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (ch === '$') {
      const placeholder = /^\$(\d+)/.exec(sql.slice(i, i + 12));
      const previous = sql[i - 1];
      if (placeholder && !(previous && /[A-Za-z0-9_$]/.test(previous))) {
        const index = Number(placeholder[1]);
        const cast = casts.get(index);
        out += cast ? `(${placeholder[0]}::${cast})` : placeholder[0];
        i += placeholder[0].length;
        continue;
      }
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag && !(previous && /[A-Za-z0-9_]/.test(previous))) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const stop = close === -1 ? n : close + tag[0].length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

const rewriteCache = new Map<string, string>();

/** Apply Prisma 5 parameter types to a registered raw statement; other statements pass through. */
export function withPrisma5ParameterTypes(query: SqlQuery): SqlQuery {
  if (!query.args.length || !isRegisteredRawSql(query.sql)) return query;
  const casts = new Map<number, string>();
  query.args.forEach((value, index) => {
    const cast = prisma5ParameterCast(query.argTypes[index], value);
    if (cast) casts.set(index + 1, cast);
  });
  if (!casts.size) return query;
  const key = `${[...casts].map(([index, cast]) => `${index}:${cast}`).join(',')}\u0000${query.sql}`;
  let sql = rewriteCache.get(key);
  if (sql === undefined) {
    sql = castPlaceholders(query.sql, casts);
    if (rewriteCache.size >= MAX_TRACKED_STATEMENTS) {
      rewriteCache.delete(rewriteCache.keys().next().value as string);
    }
    rewriteCache.set(key, sql);
  }
  return { ...query, sql };
}
