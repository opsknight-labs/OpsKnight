---
title: Quickstart with Docker Compose
description: Start an evaluation environment and verify that OpsKnight is healthy.
type: tutorial
product_area: deployment
audience: [operator, administrator]
keywords: [install OpsKnight, Docker Compose, local install, quick start, first boot]
verification:
  level: runtime
  verified_at: 2026-09-27
  evidence:
    - deploy/compose/docker-compose.yml
    - tests/docs/environment/compose.yaml
    - generated/docs-evidence/current/incidents/list.png
---

# Quickstart with Docker Compose

![Incident list populated with realistic service and responder data](/docs/v2.0.0/assets/incidents-list.png)

Use this path for an isolated evaluation. Choose an immutable tested image for
the release you are evaluating; do not use a production database or credentials.

## Before you begin

Install Docker with Compose support and reserve a host that is not using the
evaluation ports. Prepare unique secrets before starting the stack.

1. Clone the repository and enter it.
2. Export unique database, authentication, and encryption secrets.
3. Set `OPSKNIGHT_IMAGE` to the tested image tag or digest.
4. Start the integrated topology:

   ```sh
   docker compose -f deploy/compose/docker-compose.yml up -d --wait
   ```

5. Confirm readiness:

   ```sh
   curl --fail 'http://localhost:3000/api/health?mode=readiness'
   ```

6. Create the initial administrator from the application container. Supply the
   password through your shell's secret mechanism, not command history. See the
   [command-line reference](../reference/cli).
7. Sign in at the configured `NEXTAUTH_URL`, then complete the
   [first incident](./first-incident).

For cleanup, run `docker compose -f deploy/compose/docker-compose.yml down`.
Add `--volumes` only when you intentionally want to destroy the evaluation data.

## Completion criteria

- The database migration completes.
- The web runtime reports ready.
- The integrated runtime reports healthy; split deployments additionally require
  the scheduler and every configured worker role to report healthy.
- An administrator can sign in and reach the application shell.
- The [first incident journey](./first-incident) succeeds.
