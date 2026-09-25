---
order: 1
title: Docker Compose
description: Deploy, verify, back up, upgrade, and recover the supported OpsKnight Compose stack.
---

# Docker Compose

The repository Compose file runs the published OpsKnight image and PostgreSQL 15 on one Docker host. It is the simplest supported evaluation/small-install topology, but it is not highly available.

## Prerequisites

- Docker Engine with Compose v2. The external-database overlay requires Compose support for the `!reset` merge tag.
- Capacity for the application, PostgreSQL, backups, and image updates.
- A public HTTPS origin and reverse proxy for production.
- A durable backup destination outside the Compose volume.

## Configure production values

```bash
git clone https://github.com/opsknight-labs/OpsKnight.git
cd OpsKnight
cp env.example .env
openssl rand -base64 32
openssl rand -hex 32
```

Set at least:

```dotenv
POSTGRES_USER=opsknight
POSTGRES_PASSWORD=REPLACE_WITH_A_LONG_DATABASE_PASSWORD
POSTGRES_DB=opsknight_db
NEXTAUTH_URL=https://ops.example.com
NEXT_PUBLIC_APP_URL=https://ops.example.com
NEXTAUTH_SECRET=REPLACE_WITH_BASE64_OUTPUT
ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARACTERS
APP_PORT=3000
OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:1.4.0
```

To let Prometheus monitor OpsKnight, also provide a dedicated high-entropy
`PROMETHEUS_SCRAPE_TOKEN` and configure Prometheus to scrape the authenticated `/api/metrics`
endpoint. See [Prometheus metrics](./prometheus) for secure token handling, scrape configuration,
queries, and alerts.

Pin `OPSKNIGHT_IMAGE` to the immutable version or digest you tested. The default remains `latest` for convenience and should not be the production release policy. The `1.4.0` stable image includes fail-closed migrations and is published for amd64 and arm64; the test image built from `main` remains amd64-only.

The checked-in fallbacks are development values, not production secrets. Keep `ENCRYPTION_KEY` stable and backed up with the database; losing it means re-entering encrypted provider/integration credentials.

## Deployment topologies

OpsKnight provides full runtime parity across Docker Compose, Helm, and Kustomize. You can select between 4 canonical deployment patterns using composable overlays:

### 1. Simple (Integrated + Bundled DB)
Ideal for local evaluation or lightweight single-node deployments where an all-in-one process is preferred.
```bash
docker compose up -d
```

### 2. Integrated + Managed / External PostgreSQL
Connects the integrated all-in-one application container directly to an external database.
```bash
OPSKNIGHT_DATABASE_URL="postgresql://user:pass@db.example.com:5432/opsknight_db?sslmode=require" \
  docker compose -f docker-compose.yml -f docker-compose.external-db.yml up -d
```

### 3. Production Split (Process-Isolated Roles + Dedicated Migration)
Runs dedicated, decoupled containers for each role:
- `opsknight-migration`: One-shot container that executes Prisma migrations and online indexes before any application container starts.
- `opsknight-web`: Serves HTTP traffic and user requests on `${APP_PORT:-3000}`.
- `opsknight-scheduler`: Owns maintenance cron sweeps (`OPSKNIGHT_SCHEDULER_PROFILE=maintenance`).
- `opsknight-general-worker`: Durable general job processor.
- `opsknight-critical-worker`: Isolated emergency on-call alerting and escalation engine.
- `opsknight-bulk-worker`: Dedicated high-volume announcement fanout worker.
- `opsknight-status-projector`: High-frequency status page real-time subscriber projection.

> [!IMPORTANT]
> The split runtime overlay requires an explicit `OPSKNIGHT_IMAGE` environment variable pointing to a release image with split-runtime support (e.g. `2.0.0` or later).

Only `opsknight-web` publishes a host port (`3000`); background workers and the scheduler expose no public ports and run as non-root with dropped capabilities.
```bash
OPSKNIGHT_IMAGE="ghcr.io/opsknight-labs/opsknight:2.0.0" \
  docker compose -f docker-compose.yml -f docker-compose.split.yml up -d
```

### 4. Production Split + PgBouncer Pooling (+ Optional External DB)
Adds a dedicated PgBouncer connection pooler container (`opsknight-pgbouncer`) on port `6432` with transaction pooling, dynamic configuration, and security isolation.
- `opsknight-web` routes through PgBouncer for high-concurrency HTTP traffic (`pgbouncer=true`).
- `opsknight-migration` and `opsknight-web` preserve direct connections (`DIRECT_DATABASE_URL`) for schema commands and migrations.
- `opsknight-scheduler` and all worker containers connect directly to PostgreSQL.
- Dynamic authentication: for bundled PostgreSQL, PgBouncer credentials and userlist are generated automatically from POSTGRES_USER / POSTGRES_PASSWORD at container startup; for external PostgreSQL, explicit structured PGBOUNCER_DB_* parameters are required and validated fail-closed. If passwords contain special URI characters, they are automatically percent-encoded or WEB_DATABASE_URL can be supplied directly. Plaintext credentials are never committed.
- Least privilege: application database users are never assigned administrative PgBouncer control plane privileges (`admin_users`).
- External PostgreSQL connections support encrypted TLS verification (`PGBOUNCER_SERVER_TLS_SSLMODE=verify-full`). A standard root CA bundle is mounted into `/etc/ssl/certs/ca-certificates.crt`, and custom enterprise CA bundles can be mounted via `PGBOUNCER_TLS_CA_CERT=/path/to/custom-ca.crt`.
```bash
# With bundled PostgreSQL:
OPSKNIGHT_IMAGE="ghcr.io/opsknight-labs/opsknight:2.0.0" \
  docker compose -f docker-compose.yml -f docker-compose.split.yml -f docker-compose.pgbouncer.yml up -d

# With external managed PostgreSQL:
OPSKNIGHT_IMAGE="ghcr.io/opsknight-labs/opsknight:2.0.0" \
OPSKNIGHT_DATABASE_URL="postgresql://enterprise_user:enterprise_password@db.example.com:5432/opsknight_db?sslmode=verify-full" \
PGBOUNCER_DB_HOST="db.example.com" \
PGBOUNCER_DB_PORT="5432" \
PGBOUNCER_DB_NAME="opsknight_db" \
PGBOUNCER_DB_USER="enterprise_user" \
PGBOUNCER_DB_PASSWORD="enterprise_password" \
PGBOUNCER_SERVER_TLS_SSLMODE="verify-full" \
PGBOUNCER_TLS_CA_CERT="/path/to/enterprise-ca.crt" \
  docker compose -f docker-compose.yml -f docker-compose.split.yml -f docker-compose.pgbouncer.yml -f docker-compose.external-db.yml up -d
```

## Scaling architecture in Docker Compose

Compose split mode provides clean process isolation across roles:
- **Worker and scheduler scaling**: Background worker lanes can be horizontally scaled directly with Compose:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.split.yml up -d \
    --scale opsknight-general-worker=3 \
    --scale opsknight-critical-worker=2
  ```
- **Web horizontal scaling**: By default, `opsknight-web` binds host port `3000` (`${APP_PORT:-3000}:3000`) for direct access in single-instance deployments. Scaling `opsknight-web` beyond 1 replica requires placing an external reverse proxy / ingress load balancer (such as NGINX, HAProxy, Envoy, or AWS ALB) in front of Compose and removing the static host port binding or routing to dynamically assigned ports, mirroring production Kubernetes Ingress/HPA topologies.

## Connection capacity and budgeting

Before scaling split containers or altering pool sizes, validate your connection budget against PostgreSQL capacity:
```bash
node scripts/validate-runtime-capacity.cjs
```
This utility calculates total connection demand across web pool / PgBouncer backends and direct worker lanes, ensuring demand never exceeds `database.maxApplicationConnections`.

## Database connection behavior

With the bundled PostgreSQL service, Compose constructs the application `DATABASE_URL` using the internal hostname `opsknight-db`. The host-oriented `DATABASE_URL` in `env.example` is therefore not passed into the Compose application container.

For managed PostgreSQL, TLS options, PgBouncer, or credentials that require URI percent-encoding, set the complete URL and apply the external-database overlay:

```dotenv
OPSKNIGHT_DATABASE_URL=postgresql://user:ENCODED_PASSWORD@db.example.com:5432/opsknight_db?sslmode=require&connection_limit=40
```

```bash
docker compose -f docker-compose.yml -f docker-compose.external-db.yml config
docker compose -f docker-compose.yml -f docker-compose.external-db.yml up -d
```

The overlay removes the application's bundled-database dependency and places `opsknight-db` behind an inactive profile, so an unused local PostgreSQL container, volume, health check, or port cannot block the managed-database deployment. Use the same `-f` arguments for later `pull`, `up`, `logs`, and `down` operations.

The bundled PostgreSQL host port is bound to `127.0.0.1` by default rather than all interfaces. It remains available for local administration without exposing the database directly on the host network.

## Start and verify

```bash
docker compose config
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 opsknight-app
curl --fail 'http://localhost:3000/api/health?mode=readiness'
```

Open the configured origin and complete `/setup`, then create a test service/incident to verify a database write.

`opsknight-app` waits for the bundled database health check in the default topology. The `1.4.0` image and later run `prisma migrate deploy`, retry failures, and use the packaged recovery helper between attempts when available. If migrations still fail, the container exits non-zero rather than starting against an unknown schema.

## TLS and proxying

Terminate TLS at a reverse proxy and forward the original host and scheme:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Keep the public URLs identical unless you intentionally operate different external origins. Incorrect `NEXTAUTH_URL` causes authentication callback/cookie problems; incorrect `NEXT_PUBLIC_APP_URL` produces bad user-facing links.

## Configure providers

Notification-provider credentials are configured in **Settings → Notification Providers** and stored encrypted in PostgreSQL. See [Notifications](../administration/notifications).

## Back up

These commands apply to the bundled database. For an external database, use the provider/operator's consistent backup and restore procedure instead.

```bash
docker compose exec -T opsknight-db \
  pg_dump -U opsknight -d opsknight_db -Fc > opsknight-$(date +%Y%m%d-%H%M%S).dump
```

Also back up the production secret-store/`.env` values, especially `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`. Validate backups through regular isolated restores.

## Restore

```bash
docker compose stop opsknight-app
docker compose exec -T opsknight-db \
  pg_restore --clean --if-exists --no-owner -U opsknight -d opsknight_db \
  < BACKUP.dump
docker compose start opsknight-app
docker compose logs --tail=200 opsknight-app
curl --fail 'http://localhost:3000/api/health?mode=readiness'
```

Confirm authentication, users, services, integrations, and a controlled incident before declaring recovery complete.

## Upgrade

1. Read release/migration notes.
2. Take and verify a database backup.
3. Record the current `OPSKNIGHT_IMAGE` reference/digest and configuration.
4. Change `OPSKNIGHT_IMAGE` to the tested release.
5. Pull/recreate the app and watch migration logs.
6. Verify readiness, login, database writes, incident handling, and notification/integration delivery.

```bash
docker compose pull opsknight-app
docker compose up -d opsknight-app
docker compose logs -f opsknight-app
```

A previous image may be incompatible with a newly migrated schema. Image rollback is not a database rollback; use release-specific compatibility guidance and the pre-upgrade recovery point when required.

## Routine operations

```bash
docker compose ps
docker compose logs -f opsknight-app
docker compose logs -f opsknight-db
docker compose restart opsknight-app
docker compose down
```

`docker compose down` preserves the named database volume. `docker compose down -v` destroys it.

## Troubleshooting

| Symptom                                 | Check                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Database unhealthy                      | PostgreSQL logs, credentials, volume ownership/capacity, host disk.                   |
| App restarts before serving             | Migration/startup logs and database connectivity; failed migrations now stop startup. |
| Login redirects loop                    | Exact `NEXTAUTH_URL` and proxy forwarded host/scheme.                                 |
| Notification links point to localhost   | `NEXT_PUBLIC_APP_URL` and any System Settings app URL override.                       |
| Managed DB cannot connect               | `OPSKNIGHT_DATABASE_URL`, URI encoding, TLS parameters, firewall/routing.             |
| Provider credentials fail after restore | Database backup and the original `ENCRYPTION_KEY` must belong together.               |

See [Troubleshooting](../troubleshooting), [Configuration reference](../getting-started/configuration),
[Prometheus metrics](./prometheus), and [Monitoring](./monitoring).
