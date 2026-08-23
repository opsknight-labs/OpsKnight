---
order: 6
title: Deployment
description: Choose and operate the Compose, Kubernetes/Kustomize, or Helm deployment supplied with OpsKnight v1.3.
---

# Deployment

OpsKnight v1.3 ships one Next.js application and PostgreSQL-backed state. Choose a deployment path based on who will own the database, ingress, secrets, upgrades, backups, and background jobs—not on an assumed “enterprise” label.

## Choose a path

| Path                                 | Use when                                                             | Important boundary                                                                |
| ------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Docker Compose](./docker)           | Evaluation, development, or a deliberately single-host installation. | One host and one PostgreSQL container are not highly available.                   |
| [Kubernetes/Kustomize](./kubernetes) | Your platform team owns raw manifests or overlays.                   | The supplied in-cluster PostgreSQL is a starting topology, not automatic HA.      |
| [Helm](./helm)                       | Your platform team wants a values-driven Kubernetes release.         | Validate chart templates and values against your cluster policies before install. |

The repository's `k8s/kustomization.yaml` is the Kustomize entry point; see [Kustomize](./kustomize) for overlay work. [Mobile/PWA](./mobile-pwa) is a client-access guide, not a server deployment method.

## Shared production requirements

- A supported PostgreSQL database with durable storage, backups, and tested recovery.
- A stable public HTTPS origin used consistently for `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`.
- Strong, backed-up `NEXTAUTH_SECRET` and 64-hex-character `ENCRYPTION_KEY` values.
- Ingress/reverse-proxy forwarding of the original host and scheme.
- Restricted database and administrative network access.
- Monitoring for application health, database health/capacity, restarts, logs, and notification/integration failures.
- A release process that tests database migrations and has an explicit data rollback decision.

Notification credentials are configured in the application UI and encrypted in PostgreSQL. Your database backup and `ENCRYPTION_KEY` are therefore both required to recover a working integration configuration.

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

The application process also runs internal scheduled work by default. Set `ENABLE_INTERNAL_CRON=false` only when another designated process owns those jobs; disabling every scheduler silently prevents time-based work. When running multiple replicas, verify job locking and behavior under your exact topology before declaring high availability.

Redis is not a required v1.3 runtime component. Do not deploy or document it as an OpsKnight dependency unless a separate extension explicitly introduces it.

## Configuration

The core runtime values are:

| Variable              | Requirement                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`        | PostgreSQL URL reachable from the application process.                    |
| `NEXTAUTH_URL`        | Exact public authentication origin.                                       |
| `NEXTAUTH_SECRET`     | Stable high-entropy session/token secret.                                 |
| `NEXT_PUBLIC_APP_URL` | Public origin used in user-facing links; normally matches `NEXTAUTH_URL`. |
| `ENCRYPTION_KEY`      | Stable 32-byte hex key; required for production encrypted credentials.    |

See the [Configuration Reference](../getting-started/configuration) for supported advanced values. Do not invent provider variables: SMTP, email API, Twilio, AWS SNS, WhatsApp, and normal Web Push provider credentials are entered under **Settings → Notification Providers**.

## Release workflow

Use the same gates for every deployment method:

1. Pin and record the intended application image tag or digest.
2. Review release notes and database migrations.
3. Back up PostgreSQL and critical secrets; complete a recent restore drill.
4. Render/validate deployment configuration before applying it.
5. Roll out while watching migration and application logs.
6. Verify readiness, login, database writes, an inbound test event, and intended notification providers.
7. Observe for a defined soak period before deleting the previous recovery point.

The container entrypoint attempts `prisma migrate deploy` before starting. It can start the server after repeated migration failure, so inspect logs and functional health instead of treating “container running” as migration success.

## Backup and recovery standard

Back up:

- the complete PostgreSQL database;
- `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, and API/integration secrets managed outside the database;
- Compose environment, Kubernetes manifests/overlays, Helm values, ingress, and network-policy configuration;
- the exact application image reference.

Restore into an isolated environment, use the original encryption key, and verify authentication, integrations, status configuration, and a controlled incident. Document recovery time and data-loss point for the service owner.

## Production acceptance checklist

- [ ] Public URL is HTTPS and matches both application URL settings.
- [ ] Database is not exposed publicly and uses encrypted transport where supported.
- [ ] Persistent storage and automated backups are in place.
- [ ] A restore drill has succeeded with the backed-up encryption key.
- [ ] Health/readiness and database capacity are monitored externally.
- [ ] Application and migration logs reach durable log storage.
- [ ] Resource requests/limits or host capacity are based on a load test.
- [ ] Notification and inbound-integration synthetic tests are monitored.
- [ ] Upgrade and data-rollback ownership is written down.
- [ ] Destructive reset commands are excluded from routine runbooks.

## Next steps

- [Docker Compose](./docker)
- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Helm](./helm)
- [Monitoring](./monitoring)
- [Maintenance](./maintenance)
- [Database migrations](./database-migrations)
- [Backup and restore](./backup-restore)
- [Upgrade and rollback](./upgrade-rollback)
- [Configuration Reference](../getting-started/configuration)
- [Security](../security/README)
