import fs from 'node:fs';
import type {
  SqlDriverAdapter,
  SqlQuery,
  SqlQueryable,
  Transaction,
} from '@prisma/driver-adapter-utils';
import { withPrisma5ParameterTypes } from './raw-parameter-types';

/**
 * Adapter instrumentation applied to every OpsKnight Prisma client:
 *
 * - every statement passes through the Prisma 5 raw-parameter typing (raw-parameter-types.ts);
 * - with OPSKNIGHT_SQL_PARAM_AUDIT=<file.jsonl>, each distinct parameterized statement and its
 *   Prisma argument types are recorded for scripts/db/audit-sql-parameter-types.mjs. Developer
 *   and CI tooling only; parameter values are never recorded.
 */
const seen = new Set<string>();

function valueKind(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (value instanceof Uint8Array) return 'bytes';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function record(file: string, query: SqlQuery) {
  if (!query.args.length || seen.has(query.sql)) return;
  seen.add(query.sql);
  const line = JSON.stringify({
    sql: query.sql,
    argTypes: query.argTypes,
    valueKinds: query.args.map(valueKind),
    stack: new Error().stack?.split('\n').slice(2, 14).join('\n'),
  });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer-supplied audit file
  fs.appendFileSync(file, `${line}\n`);
}

function wrapQueryable<T extends SqlQueryable>(target: T, file: string | undefined): T {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (property === 'queryRaw' || property === 'executeRaw') {
        return (query: SqlQuery) => {
          if (file) record(file, query);
          const execute = value as (q: SqlQuery) => Promise<unknown>;
          return execute.call(object, withPrisma5ParameterTypes(query));
        };
      }
      if (property === 'startTransaction') {
        return async (...args: unknown[]) => {
          const start = value as (...a: unknown[]) => Promise<Transaction>;
          return wrapQueryable(await start.apply(object, args), file);
        };
      }
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}

export function instrumentAdapter(adapter: SqlDriverAdapter): SqlDriverAdapter {
  return wrapQueryable(adapter, process.env.OPSKNIGHT_SQL_PARAM_AUDIT);
}
