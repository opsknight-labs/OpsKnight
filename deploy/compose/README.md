# OpsKnight Docker Compose Deployments

This directory contains all supported Docker Compose manifests and overlays for OpsKnight.

---

## Compose Files

| File | Purpose |
| :--- | :--- |
| `docker-compose.yml` | Base stack: `opsknight-db` (PostgreSQL 15) and `opsknight-app` (integrated runtime). |
| `docker-compose.dev.yml` | Standalone local development stack with source bind-mounts and hot reload. |
| `docker-compose.split.yml` | Disables `opsknight-app` and runs a one-shot `opsknight-migration` container followed by 6 dedicated runtime roles (`web`, `scheduler`, `general-worker`, `critical-worker`, `bulk-worker`, `status-projector`). |
| `docker-compose.pgbouncer.yml` | Adds `opsknight-pgbouncer` (1.26.0) for `opsknight-web` transaction pooling while keeping migrations and workers on `DIRECT_DATABASE_URL`. |
| `docker-compose.external-db.yml` | Disables bundled `opsknight-db` and routes traffic to an external/managed PostgreSQL instance via `OPSKNIGHT_DATABASE_URL`. |
| `docker-compose.pgbouncer-ca.yml` | Mounts a custom enterprise CA certificate (`PGBOUNCER_TLS_CA_CERT`) into PgBouncer and all application roles. |

---

## Common Invocations

Run all commands from the repository root:

### 1. Integrated Runtime (Bundled PostgreSQL)

```bash
docker compose -f deploy/compose/docker-compose.yml up -d
```

### 2. Split Runtime (Bundled PostgreSQL)

> [!IMPORTANT]
> Split mode requires an explicit `OPSKNIGHT_IMAGE` tag or digest built with split-runtime role support (for example `2.0.0` or later; `1.4.0` predates split runtime).

```bash
export OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0
node deploy/scripts/validate-runtime-capacity.cjs
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  up -d
```

### 3. Split Runtime + PgBouncer (Bundled PostgreSQL)

```bash
export OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0
export PGBOUNCER_ENABLED=true
node deploy/scripts/validate-runtime-capacity.cjs
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.pgbouncer.yml \
  up -d
```

### 4. Split Runtime + PgBouncer + External PostgreSQL (+ Optional Custom CA)

> [!NOTE]
> When mounting a custom enterprise CA bundle with `docker-compose.pgbouncer-ca.yml`, set `PGBOUNCER_TLS_CA_CERT` to an **absolute host path** (e.g. `/etc/ssl/certs/enterprise-ca.crt`). Relative volume paths in Docker Compose are resolved relative to `deploy/compose/`, not the caller's working directory.

```bash
export OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0
export OPSKNIGHT_DATABASE_URL="postgresql://user:pass@db.example.com:5432/opsknight_db?sslmode=verify-full"
export EXTERNAL_DB_HOST="db.example.com"
export EXTERNAL_DB_PASSWORD="pass"
export PGBOUNCER_ENABLED=true
node deploy/scripts/validate-runtime-capacity.cjs
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.pgbouncer.yml \
  -f deploy/compose/docker-compose.external-db.yml \
  up -d
```
