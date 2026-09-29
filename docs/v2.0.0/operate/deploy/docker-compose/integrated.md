---
title: Install integrated OpsKnight with Compose
description: Start and verify a single-host integrated OpsKnight deployment with bundled PostgreSQL using Docker Compose.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Compose integrated, bundled PostgreSQL, install]
reader:
  status: READER_COMPLETE
  task: Install and validate integrated OpsKnight with bundled PostgreSQL.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/docker-compose.yml
    - src/app/api/health/route.ts
---

# Install integrated OpsKnight with Compose

This path runs Web and background responsibilities in `opsknight-app` and stores data in bundled `opsknight-db`.

## Prerequisites

Complete [Compose prerequisites](./prerequisites). Use integrated mode only when a single application failure domain and shared Web/background resources are acceptable.

## Prepare the deployment

Confirm the resolved services and immutable image:

```sh
docker compose -f deploy/compose/docker-compose.yml config --services
docker compose -f deploy/compose/docker-compose.yml config --images
```

Expected services include `opsknight-app` and `opsknight-db`. Do not add split overlays to this command.

## Install OpsKnight

1. Pull the pinned application and database images.
2. Start the stack and wait for health checks.
3. Inspect service state and recent logs.

```sh
docker compose -f deploy/compose/docker-compose.yml pull
docker compose -f deploy/compose/docker-compose.yml up -d --wait
docker compose -f deploy/compose/docker-compose.yml ps
docker compose -f deploy/compose/docker-compose.yml logs --since=10m opsknight-app
```

`opsknight-db` must be healthy before the application becomes ready. The `opsknight_postgres_data` named volume retains database files across normal container replacement.

## Verify the installation

Call readiness from the host:

```sh
curl --fail --show-error \
  'http://127.0.0.1:3000/api/health?mode=readiness'
```

Expected result is a successful HTTP response. Then access the same endpoint through the public HTTPS hostname. Open `https://opsknight.example.com/setup`, create the first administrator, and follow [Quickstart](../../../start/quickstart) to create a service and test incident.

Verify that an incident can be created, acknowledged, and resolved and that a configured notification is delivered. A ready HTTP process alone is not production acceptance.

## Operate it in production

Use the same file list for every command:

```sh
docker compose -f deploy/compose/docker-compose.yml ps
docker compose -f deploy/compose/docker-compose.yml logs --since=30m opsknight-app
```

Monitor readiness, application errors, queue age, provider failures, PostgreSQL connections, storage growth, and backup completion. Do not scale `opsknight-app` casually: integrated replicas also own background behavior.

Complete the [production checklist](./production-checklist) and [reverse proxy setup](./reverse-proxy).

## Troubleshooting

**Database is unhealthy:** inspect `opsknight-db` logs, free disk space, volume ownership, and the configured credentials. Do not delete the volume as a repair step.

**Application migration fails:** keep the application unavailable, inspect its logs, verify database privileges and version compatibility, then follow [migration troubleshooting](../../../troubleshooting/upgrades/migration-fails).

**Readiness is unhealthy:** verify database reachability, schema state, secret values, and recent application errors. Compare the direct host endpoint with the public proxy endpoint.

**Authentication redirects to localhost:** correct both public URL variables and the reverse proxy's forwarded host/protocol headers, then recreate `opsknight-app`.

## Remove or change the deployment

`docker compose -f deploy/compose/docker-compose.yml down` stops and removes containers while preserving the named database volume. Never use `down --volumes` as routine cleanup; it destroys bundled database data.

To move to split mode, take a verified backup, stop integrated ownership completely, validate the split configuration, run the split migration owner, and only then start split roles. Follow [Install split runtime](./split).

## Next steps

- [Configure the reverse proxy](./reverse-proxy)
- [Complete production acceptance](./production-checklist)
- [Upgrade Compose](./upgrade)

