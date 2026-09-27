---
title: Database or PgBouncer connections fail
description: Diagnose URLs, TLS, authentication, pool mode, and connection budgets.
type: troubleshooting
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

