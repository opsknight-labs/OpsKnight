---
title: Quickstart with Docker Compose
description: Start an isolated OpsKnight evaluation, create the first administrator, and verify it.
type: tutorial
product_area: deployment
audience: [operator, administrator]
keywords: [install OpsKnight, Docker Compose, local install, quick start, first boot]
reader:
  status: READER_COMPLETE
  task: Install an isolated OpsKnight evaluation and verify the first incident workflow.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/compose/docker-compose.yml, src/app/setup/page.tsx, src/app/setup/actions.ts]
---

# Quickstart with Docker Compose

This tutorial starts the integrated OpsKnight runtime and PostgreSQL on one Docker host. Use it for an evaluation or small test environment. For production, start with [Choose a deployment](../operate/capacity/choose-deployment).

![Incident list populated with realistic service and responder data](/docs/v2.0.0/assets/incidents-list.png)

## Before you begin

Install Git, Docker Engine, and Docker Compose v2. Ports `3000` and `5432` must be free unless you change `APP_PORT` and `POSTGRES_PORT`. Choose an explicit 2.0 image tag or immutable digest; do not rely on the Compose compatibility default or a moving `latest` tag.

## 1. Prepare the configuration

```sh
git clone https://github.com/opsknight-labs/opsknight.git
cd opsknight
cp env.example .env
```

Edit `.env` and set at least:

```dotenv
OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0
POSTGRES_PASSWORD=<unique-database-password>
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=<random-base64-secret>
ENCRYPTION_KEY=<64-hex-character-key>
```

Generate the application secrets with `openssl rand -base64 32` and `openssl rand -hex 32`. Use the externally reachable HTTPS origin for both URL values behind a proxy. Keep `ENCRYPTION_KEY` stable and backed up; losing it makes encrypted integration credentials unrecoverable.

## 2. Start and verify OpsKnight

```sh
docker compose -f deploy/compose/docker-compose.yml pull
docker compose -f deploy/compose/docker-compose.yml up -d --wait
docker compose -f deploy/compose/docker-compose.yml ps
curl --fail --show-error 'http://localhost:3000/api/health?mode=readiness'
```

Both `opsknight-db` and `opsknight-app` should be running and healthy. Readiness must return HTTP 200 with a healthy status. If startup fails, inspect both services:

```sh
docker compose -f deploy/compose/docker-compose.yml logs --tail=200 opsknight-db opsknight-app
```

## 3. Create the first administrator

Open `http://localhost:3000/setup`. Enter your display name, administrator email, application URL, and a strong unique password. Enter the setup secret only if the operator configured `SETUP_SECRET` or `BOOTSTRAP_SECRET`, then select **Create administrator**.

OpsKnight creates exactly one first user as an active Admin. Once any user exists, `/setup` redirects to `/login`. For a trusted-host alternative, use the [command-line reference](../reference/cli); do not put passwords in shell history.

## 4. Confirm the installation

Sign in and:

1. Open **Settings → Health Center** and confirm runtime and database health.
2. [Create your first service](./create-first-service).
3. [Configure on-call](./configure-on-call).
4. Complete the [first incident journey](./first-incident).

The quickstart is complete when an alert creates an incident and the intended responder can acknowledge it.

## Stop or remove the evaluation

`docker compose -f deploy/compose/docker-compose.yml down` preserves PostgreSQL data. Adding `--volumes` permanently deletes the evaluation database.

## Troubleshooting

**Setup is unavailable:** check application logs for database or migration errors and confirm the database is healthy.

**Sign-in returns to the wrong host:** make both URL settings the externally reachable origin and restart the application.

**A 2.0 feature is absent:** run `docker compose config` and confirm `opsknight-app.image` resolves to your explicit 2.0 tag or digest.
