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

