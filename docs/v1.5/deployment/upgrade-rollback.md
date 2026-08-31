---
order: 10
title: Upgrade and Rollback
description: Upgrade application and schema together, validate service behavior, and choose a safe rollback path
---

# Upgrade and Rollback

An OpsKnight release can change the application image, database schema, deployment configuration, service worker, and client assets. Rollback safety depends primarily on whether the new database migrations remain compatible with the previous application.

## Prepare

1. Pin the new image by tested immutable tag or digest; record the currently running digest.
2. Compare release notes, `prisma/migrations`, environment/configuration changes, Helm values/manifests, and browser/PWA changes.
3. Run migration validation and rehearse the release against a recent restored database.
4. Back up PostgreSQL and the matching `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, and deployment configuration.
5. Define the maintenance window, rollback decision owner, acceptance checks, and soak period.
6. Pause unrelated administrative changes and confirm notification providers have a fallback communication path.

Never depend on a floating `latest` tag as your rollback record.

### Enterprise-hardening migration notes

This release adds audit actor snapshots and indexes, API-key expiry/indexing, and uniqueness constraints for escalation steps and exact schedule overrides. The data migration deterministically renumbers colliding escalation steps and removes exact duplicate overrides before creating the constraints. Rehearse it against a recent production-size restore, review affected-row counts, and preserve the pre-upgrade recovery point.

The release also writes new protected secrets using v3 authenticated encryption. Keep the current encryption key available during upgrade. If rotating at the same time, deploy `ENCRYPTION_KEYS=new-id:NEW_KEY,old-id:OLD_KEY` consistently to every replica, rotate/re-save credentials, validate them, and only then retire the old key. Existing plaintext webhook/signature secrets must be rotated or re-saved to gain encryption at rest.

Notification control-plane upgrades use a compatibility gate. Deploy the version whose legacy
worker ignores encrypted control-plane rows to every replica before enabling
`NOTIFICATION_CONTROL_PLANE_PERSONAL=true`. Keep a stable `NOTIFICATION_IDENTITY_KEY` across
replicas and encryption-key rotations. During rollback, disable new personal control-plane
producers first, allow in-flight work to drain, and only then roll back application replicas.

## Deploy

### Docker Compose

Update the application image reference to the tested version, then:

```bash
docker compose pull opsknight-app
docker compose up -d opsknight-app
docker compose logs --tail=300 opsknight-app
```

### Helm

Render and review before applying:

```bash
helm lint helm/opsknight --values values.production.yaml
helm template opsknight helm/opsknight --namespace opsknight \
  --values values.production.yaml > opsknight-rendered.yaml

helm upgrade opsknight helm/opsknight --namespace opsknight \
  --values values.production.yaml --wait --timeout 10m
```

### Kustomize

Pin the new image in the reviewed overlay, render it, use server-side dry run, then apply:

```bash
kubectl kustomize k8s > opsknight-rendered.yaml
kubectl apply --dry-run=server -f opsknight-rendered.yaml
kubectl apply -f opsknight-rendered.yaml
kubectl rollout status deployment/opsknight -n opsknight --timeout=10m
```

## Acceptance gate

Do not call the upgrade complete until all checks pass:

- startup logs show migrations completed and migration health is clean;
- liveness and readiness succeed without restart loops;
- local and OIDC authentication work according to policy;
- an ordinary user can read and write permitted data;
- a synthetic provider event triggers, deduplicates, acknowledges, and resolves;
- schedules/escalation select the intended responder;
- email/SMS/push/Slack or the deployment's required channels deliver;
- public status, RSS/subscriber behavior, webhooks, and mobile PWA work where enabled;
- logs, scheduler ticks, database capacity, and error rates remain within baseline through the soak period.
- API keys have the expected owner/scopes/expiry and legacy keys authenticate during the migration window;
- `/api/metrics` rejects anonymous access and accepts the configured scrape Bearer token;
- outbound service/status webhooks reject redirects/private destinations and the receiver validates timestamped signatures and delivery IDs;

## Choose rollback type

**Application-only rollback** is appropriate only when the previous image is compatible with the current migrated schema and configuration. Pin the previous image digest, deploy it, and repeat the acceptance gate.

**Application and database rollback** is required when a migration is destructive or the previous image cannot use the new schema. Freeze writes, preserve the failed state for investigation, restore the pre-upgrade database and matching secrets, deploy the previous image/configuration, and verify before reopening traffic.

`helm rollback`, a Kubernetes image rollback, or changing a Compose tag affects application resources; it does not reverse PostgreSQL migrations or data transformations. Never use those commands as a substitute for a database recovery decision.

## Partial rollout and PWA considerations

Avoid serving incompatible application versions simultaneously during schema transitions. With multiple replicas, watch per-pod image versions and migration logs until every pod is ready.

The service worker activates immediately in production and can retain cached shell assets. After an upgrade, test an installed PWA as well as a clean browser session. If a mobile client behaves inconsistently, confirm the deployed `/sw.js`, close/reopen the PWA, and use the documented browser cache recovery steps before concluding the server rollback failed.

## Related topics

- [Database migrations](./database-migrations)
- [Backup and restore](./backup-restore)
- [Helm](./helm)
- [Kustomize](./kustomize)
- [Mobile PWA](./mobile-pwa)
- [Maintenance](./maintenance)
