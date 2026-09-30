---
title: Database or PgBouncer connections fail
description: Diagnose URLs, TLS, authentication, pool mode, and connection budgets.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify connection failures.
product_area: data
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [deploy/compose/docker-compose.pgbouncer.yml, src/lib/db-utils.ts]
---

# Database or PgBouncer connections fail

Test name resolution and TCP reachability from the failing runtime, then validate
URI encoding, database name, credentials, TLS mode, CA material, and PgBouncer
user list. Compare pool mode and direct migration URL requirements. Sum configured
connections across replicas and workers; saturation can resemble an authentication
failure. Never print full database URLs in shared logs.

## Diagnostic sequence

1. Identify whether the failure affects the web, scheduler, migration, or worker role.
2. From that container or pod, resolve the database hostname and test TCP port 5432.
3. Run the readiness endpoint and inspect the first database error in runtime logs.
4. Compare `DATABASE_URL` with `DIRECT_DATABASE_URL`; migrations must not use a
   transaction-pooling endpoint when a direct endpoint is required.
5. Check active connections, reserved capacity, and the sum of per-replica limits.

An authentication error points to credentials, database name, or PgBouncer user
configuration. A timeout points to DNS, routing, NetworkPolicy, TLS, or exhausted
connection capacity. A certificate error points to CA material or `sslmode`, not
application credentials.

## Recover and verify

Correct the secret or connection budget, restart only affected roles, and confirm
readiness plus a successful migration-health check. Preserve redacted URLs,
runtime role, PostgreSQL/PgBouncer logs, and connection counts for escalation.
