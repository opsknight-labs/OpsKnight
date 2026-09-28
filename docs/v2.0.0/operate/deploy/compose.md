---
title: Deploy with Docker Compose
description: Run the integrated or split OpsKnight topology with Compose.
type: deployment
product_area: deployment
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - deploy/compose/docker-compose.yml
    - deploy/compose/docker-compose.split.yml
---

# Deploy with Docker Compose

Use the base Compose file for the integrated runtime. Apply the split overlay
when web, scheduler, general worker, critical worker, bulk worker, and status
projector need separate ownership or scaling.

Provide unique secrets, explicit public URLs, and a tested immutable image. Run
migrations through the migration owner before admitting web traffic. Verify
database health, readiness, each enabled runtime role, notification processing,
and status projection. Persist PostgreSQL outside disposable containers and
exercise backup and restore before production use.

## Choose the Compose profile

- Integrated: one application runtime owns web and background processing. Use it
  when simple single-host operation matters more than independent scaling.
- Split: a migration job plus web, scheduler, general, critical, bulk, and
  status-projector roles. Use it for isolation and role-specific scaling.
- Split + PgBouncer: pools web transactions while direct roles and migrations
  continue using `DIRECT_DATABASE_URL`.

Layer the checked-in Compose files rather than copying services into an
unmaintained local stack. Pin `OPSKNIGHT_IMAGE` to the intended release digest.

## Verify

Confirm the migration owner exits successfully, readiness is healthy, every
selected role is running exactly once or at the intended replica count, and a
synthetic incident completes ingestion, escalation, notification, and status
projection. Then validate the [database connection budget](../capacity/sizing/).

## Common mistakes

- Running integrated and split background owners at the same time.
- Sending migrations through PgBouncer transaction pooling.
- Scaling all workers when only one lane is constrained.
- Treating a container restart as proof that backup and restore work.
