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
