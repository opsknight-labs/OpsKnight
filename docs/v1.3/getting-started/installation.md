---
order: 1
title: Installation
description: Install OpsKnight with Docker Compose, Helm, Kustomize, or a Node.js development checkout and verify the complete incident path.
---

# Installation

For the fastest evaluation, use Docker Compose. For production, choose the deployment method whose database, secrets, ingress, monitoring, backup, upgrade, and recovery lifecycle your team can own.

If you want the shortest end-to-end tutorial, follow [Getting started](./README). This page covers installation choices and source development.

## Choose a method

| Method                       | Intended use                                                       | Next guide                             |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| Docker Compose               | Evaluation, development, or an accepted single-host topology.      | [Docker Compose](../deployment/docker) |
| Helm                         | Values-driven Kubernetes release managed by a platform team.       | [Helm](../deployment/helm)             |
| Kustomize                    | Raw Kubernetes manifests with reviewed environment overlays.       | [Kustomize](../deployment/kustomize)   |
| Node.js development checkout | Application development and local testing, not a packaged release. | [From source](#install-from-source)    |

All methods require PostgreSQL. The published Compose and Kubernetes examples use PostgreSQL 15; the project declares PostgreSQL 14+ support. The production image and source package use Node.js 20 (`>=20 <21`).

## Install with Docker Compose

### 1. Prepare the repository and secrets

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
cp env.example .env
openssl rand -base64 32
openssl rand -hex 32
```

Edit `.env` and paste the generated values. Dotenv files do not evaluate `$(...)` shell substitutions.

```dotenv
POSTGRES_USER=opsknight
POSTGRES_PASSWORD=replace-with-a-long-database-password
POSTGRES_DB=opsknight_db
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=replace-with-the-base64-output
ENCRYPTION_KEY=replace-with-the-64-hex-character-output
APP_PORT=3000
```

For a production origin, use the exact public HTTPS URL for both URL settings and store the secrets outside the repository. Keep `ENCRYPTION_KEY` stable and backed up; it is required to decrypt stored provider credentials.

### 2. Render, start, and inspect

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 opsknight-app
curl --fail http://localhost:3000/api/health?mode=readiness
```

The Compose stack runs the application plus PostgreSQL 15 in the `opsknight_postgres_data` named volume. The application startup attempts database migrations. Inspect migration logs even when the container is running, because startup can continue after repeated migration failure.

### 3. Bootstrap the first Admin

Open `http://localhost:3000`. When no users exist, OpsKnight redirects to `/setup`.

1. Enter the first Admin's name and email.
2. Create the account.
3. Copy the generated password; it is shown once.
4. Sign in, change the generated password, and create a second Admin.

Setup stops accepting another bootstrap after the first user exists.

### 4. Verify a product workflow

Do not stop at the login page:

1. Create a team, schedule, escalation policy, and service.
2. Create a controlled incident for that service.
3. Confirm the expected assignment/escalation state.
4. Acknowledge and resolve it.
5. After configuring a provider, verify an external notification and its history.

The [15-minute getting-started path](./README) gives the exact UI sequence.

## Install on Kubernetes

Use one packaging path:

- [Helm](../deployment/helm) for the chart at `helm/opsknight`.
- [Kustomize](../deployment/kustomize) for overlays based on `k8s/kustomization.yaml`.

Both checked-in defaults contain example or placeholder values. Before applying, pin an image, replace every secret, configure the exact public HTTPS origin, choose an owned PostgreSQL topology, render/server-dry-run resources, and define backup/recovery. See [Kubernetes deployment](../deployment/kubernetes) for the shared runtime and scaling boundaries.

## Install from source

Use this path for contribution and development. It is not a substitute for the tested production image/entrypoint.

### Prerequisites

- Node.js 20 and npm.
- PostgreSQL 14+ reachable from the host.
- Build tools required by Node dependencies on your operating system.

### Set up the application

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
npm ci
cp env.example .env
openssl rand -base64 32
openssl rand -hex 32
```

Edit `.env`. For PostgreSQL exposed from Compose to the development host, the hostname is `localhost`, not the container-only `opsknight-db` name:

```dotenv
DATABASE_URL=postgresql://opsknight:YOUR_PASSWORD@localhost:5432/opsknight_db?sslmode=prefer
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_SECRET=PASTE_BASE64_OUTPUT
ENCRYPTION_KEY=PASTE_64_HEX_CHARACTER_OUTPUT
```

Create or select a disposable development database, then:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000`, bootstrap the Admin, and run the same controlled incident workflow. Production builds use `npm run build`; use the packaged deployment guides for an operated installation.

## Common installation failures

### PostgreSQL is unhealthy or unreachable

```bash
docker compose ps
docker compose logs --tail=200 opsknight-db
docker compose exec -T opsknight-db \
  pg_isready -U "${POSTGRES_USER:-opsknight}" -d "${POSTGRES_DB:-opsknight_db}"
```

Check database credentials, hostname, port, disk/volume state, TLS requirements, and application migration logs. Inside the application container, `localhost` refers to that container, not PostgreSQL.

### Port 3000 is already used

Set a different host port without changing the container port:

```dotenv
APP_PORT=3001
NEXTAUTH_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

Recreate the application and open port 3001.

### Login redirects repeatedly

The browser origin must exactly match `NEXTAUTH_URL`, including scheme and port. Behind a proxy, forward the original host and scheme. Keep the same `NEXTAUTH_SECRET` across restarts/replicas; replacing it invalidates existing sessions and does not fix an origin mismatch.

### You need a clean disposable database

Do not use `docker compose down -v` as a routine troubleshooting command: `-v` deletes the named PostgreSQL volume. For a disposable install only, first confirm the Compose project/volume target and that no data or backup is needed. Production recovery must use the [backup and restore](../deployment/backup-restore) runbook.

## Next steps

- [First steps](./first-steps) — first-week configuration.
- [Configuration reference](./configuration) — supported environment behavior.
- [Authentication](../administration/authentication) — bootstrap, OIDC, sessions, and recovery.
- [Monitoring](../deployment/monitoring) — readiness, logs, and synthetic validation.
- [Upgrade and rollback](../deployment/upgrade-rollback) — controlled release workflow.
- [Troubleshooting](../troubleshooting) — application and integration diagnosis.
