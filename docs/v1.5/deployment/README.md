---
order: 6
title: Deployment
description: Choose and operate the Compose, Kubernetes/Kustomize, or Helm deployment supplied with OpsKnight v1.4.
---

# Deployment

OpsKnight v1.4 ships one Next.js application and PostgreSQL-backed state. Choose a deployment path based on who owns the database, ingress, secrets, upgrades, backups, and background jobs.

## Choose a path

| Path                                 | Use when                                                           | Important boundary                                                          |
| ------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Docker Compose](./docker)           | Evaluation, development, or a deliberate single-host installation. | One host and one PostgreSQL container are not highly available.             |
| [Kubernetes/Kustomize](./kubernetes) | Your platform team owns raw manifests/overlays.                    | The supplied PostgreSQL StatefulSet is a single-instance starting topology. |
| [Helm](./helm)                       | Your platform team wants a values-driven Kubernetes release.       | Render and validate chart values against cluster policy before install.     |

`k8s/kustomization.yaml` is the raw-manifest entry point. [Mobile/PWA](./mobile-pwa) is a client-access guide, not a server deployment method.

## Shared production requirements

- Supported PostgreSQL with durable storage, backups, and tested recovery.
- Stable public HTTPS origin used consistently for `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`.
- Strong, backed-up `NEXTAUTH_SECRET` and 64-hex-character `ENCRYPTION_KEY`.
- Ingress/reverse-proxy forwarding of the original host and scheme.
- Restricted database/admin network access.
- Monitoring for readiness, restarts, migration failures, database capacity, and integration/notification failures.
- An immutable image release process with an explicit schema/data rollback decision.

Notification credentials are configured in the application UI and encrypted in PostgreSQL. A working recovery therefore requires both the database backup and the matching `ENCRYPTION_KEY`.

## Runtime model

```text
users and integrations
        │ HTTPS
        ▼
ingress / reverse proxy
        │
        ▼
OpsKnight Next.js application
        │
        ▼
PostgreSQL
```

The application also performs internal scheduled work by default. Set `ENABLE_INTERNAL_CRON=false` only when another designated process owns those jobs. When running several replicas, validate job locking and database connection capacity under the exact topology.

Redis is not a required v1.4 runtime dependency.

## Core configuration

| Variable              | Requirement                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`        | Complete PostgreSQL URI reachable from the application process.           |
| `NEXTAUTH_URL`        | Exact public authentication origin.                                       |
| `NEXT_PUBLIC_APP_URL` | Public origin used in user-facing links; normally matches `NEXTAUTH_URL`. |
| `NEXTAUTH_SECRET`     | Stable high-entropy session/token secret.                                 |
| `ENCRYPTION_KEY`      | Stable 32-byte hex key for encrypted stored credentials.                  |

For managed PostgreSQL, TLS/PgBouncer options, or credentials containing reserved URI characters, use the deployment method's complete database-URL override instead of reconstructing the URI from unencoded components.

See the [Configuration reference](../getting-started/configuration) for advanced settings. Notification-provider credentials are normally entered under **Settings → Notification Providers** rather than invented environment variables.

## Published image compatibility

Stable images are published only at `ghcr.io/opsknight-labs/opsknight`; main-branch validation images use `ghcr.io/opsknight-labs/opsknight-test`. Do not substitute the test channel in production.

Source changes do not modify an image that was already published. The `1.4.0` stable image includes the fail-closed migration entrypoint and is built for amd64 and arm64, while the continuously updated test image from `main` is amd64-only to keep feedback fast. Inspect the selected image manifest and release notes rather than inferring capabilities from the checked-in deployment YAML.

## Release workflow

Use the same gates for every deployment method:

1. Pin the intended application image tag/digest.
2. Review release notes and Prisma migrations.
3. Back up PostgreSQL and critical secrets; keep a recent restore drill.
4. Render/validate deployment configuration.
5. Roll out while watching migration/startup logs.
6. Verify readiness, login, a database write, an inbound test event, and intended notification providers.
7. Observe for a defined soak period before deleting the prior recovery point.

Images built from this repository revision run `prisma migrate deploy` before starting the server. The entrypoint retries/recovery-attempts migration failures, but if the schema still cannot be migrated the container exits non-zero. Verify the release notes before assuming an older image has this behavior.

Kubernetes deployments include a startup probe budget so legitimate migration/cold-start time is not mistaken for a liveness failure.

## Backup and recovery standard

Back up:

- complete PostgreSQL data;
- `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, and secrets managed outside the database;
- Compose environment, Kubernetes overlays, Helm values, ingress/network policy configuration;
- the exact application image reference.

Restore into an isolated environment with the original encryption key, then verify authentication, integrations, status configuration, and a controlled incident.

## Production acceptance checklist

- [ ] Public URL is HTTPS and matches both application URL settings.
- [ ] Database is not exposed publicly and uses encrypted transport where supported.
- [ ] Persistent storage and automated backups are in place.
- [ ] A restore drill succeeded with the backed-up encryption key.
- [ ] Health/readiness and database capacity are monitored externally.
- [ ] Migration/application logs reach durable log storage.
- [ ] Resource requests/limits or host capacity are based on a load test.
- [ ] Notification/inbound-integration synthetic tests are monitored.
- [ ] Upgrade and data-rollback ownership is documented.
- [ ] Destructive reset commands are excluded from routine runbooks.

## Next steps

- [Docker Compose](./docker)
- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Helm](./helm)
- [Monitoring](./monitoring)
- [Enterprise validation drills](./enterprise-validation)
- [Maintenance](./maintenance)
- [Database migrations](./database-migrations)
- [Backup and restore](./backup-restore)
- [Upgrade and rollback](./upgrade-rollback)
- [Configuration Reference](../getting-started/configuration)
- [Security](../security/README)
