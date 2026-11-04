/**
 * Database runtime surface for CommonJS/ESM operator scripts and the Kubernetes migration Job
 * (loaded through scripts/lib/db-runtime.cjs). Keep this free of '@/' path aliases so it can be
 * bundled by scripts/build-db-runtime.mjs without the Next.js/TypeScript toolchain.
 */
export { createPrismaClient, createPgAdapter } from './create-client';
export {
  driverAdapterCause,
  isDatabaseUnavailableError,
  isDriverAdapterError,
  rawSqlState,
  toPrismaClientError,
} from './errors';
export { planPgConnection, DatabaseUrlError } from './pg-config';
