---
title: Troubleshoot database failures
description: Diagnose database and PgBouncer connectivity before changing application state.
type: concept
product_area: database
audience: [operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/prisma.ts] }
---

# Troubleshoot database failures

For connection errors, pool exhaustion, or startup timeouts, use [Database or PgBouncer connections fail](./connection-failures). Capture the failing runtime role, redacted connection target, database health, pool metrics, and exact error before changing credentials or pool size.
