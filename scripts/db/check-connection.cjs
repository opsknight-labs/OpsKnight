#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS operator script */
'use strict';
/**
 * Pre-upgrade database connection check for OpsKnight 2.3 (Prisma 7 / node-postgres).
 *
 * 2.3 applies libpq sslmode semantics: verify-ca/verify-full now really verify the server
 * certificate (earlier releases silently skipped verification). Run this with the new image and
 * your existing configuration BEFORE upgrading:
 *
 *   docker run --rm --env-file opsknight.env [-v /path/ca.crt:/path/ca.crt:ro] \
 *     ghcr.io/opsknight-labs/opsknight:2.3.0 node scripts/db/check-connection.cjs
 *
 * Checks DATABASE_URL, DIRECT_DATABASE_URL, WEB_DATABASE_URL and MCP_DATABASE_URL when set.
 * Exits 1 if any configured URL cannot connect. Never prints credentials.
 */
const { createPrismaClient, planPgConnection } = require('../lib/db-runtime.cjs');

const NAMES = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'WEB_DATABASE_URL', 'MCP_DATABASE_URL'];

function failureHint(kind, message) {
  if (kind === 'TlsConnectionError' || /certificate|self.signed|altname/i.test(message)) {
    return 'Provide the database CA with sslrootcert=/path/ca.crt (mounted into the container) or NODE_EXTRA_CA_CERTS.';
  }
  if (/does not support SSL/i.test(message)) {
    return 'The server does not accept TLS; use sslmode=prefer or sslmode=disable on a private network.';
  }
  return undefined;
}

async function check(name, url) {
  let plan;
  try {
    plan = planPgConnection(url);
  } catch (error) {
    return { name, ok: false, error: error.message };
  }
  const client = createPrismaClient({ url, applicationName: 'opsknight-connection-check' });
  try {
    const [row] = await client.$queryRaw`
      SELECT COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
             current_setting('server_version') AS version`;
    return {
      name,
      ok: true,
      target: plan.target,
      sslmode: plan.tls.mode,
      encrypted: row.ssl === true,
      certificateVerified: plan.tls.verifiesCertificate && row.ssl === true,
      serverVersion: row.version,
      warnings: plan.warnings,
    };
  } catch (error) {
    const cause = error?.meta?.driverAdapterError?.cause;
    const message = String(cause?.reason ?? error?.message ?? error)
      .split('\n')
      .filter(Boolean)
      .pop();
    return {
      name,
      ok: false,
      target: plan.target,
      sslmode: plan.tls.mode,
      error: cause?.kind ? `${cause.kind}: ${message}` : message,
      hint: failureHint(cause?.kind, message),
    };
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

(async () => {
  const configured = NAMES.filter(name => process.env[name]);
  if (!configured.length) {
    console.error(`No database URL is set (${NAMES.join(', ')}).`);
    process.exit(2);
  }
  const results = [];
  for (const name of configured) results.push(await check(name, process.env[name]));
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.every(result => result.ok) ? 0 : 1);
})();
