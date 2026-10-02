---
title: Upgrade OpsKnight with Helm
description: Diff, back up, migrate, roll out, verify, and decide rollback for an OpsKnight Helm release.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm upgrade, migration hook, rollback]
reader:
  status: READER_COMPLETE
  task: Upgrade and validate an OpsKnight Helm release.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/Chart.yaml, deploy/kubernetes/helm/opsknight/templates/migration-job.yaml]
---

# Upgrade OpsKnight with Helm

## Prerequisites

Read release notes, [Database migrations](../../upgrades/database-migrations), and [Rollback](../../upgrades/rollback). Obtain the new chart revision/image digest, a verified backup, and an explicit rollback owner/window.

## Prepare the upgrade

Record current `helm get values --all`, manifest, image digest, role state, and health. Back up PostgreSQL and stable secrets. Update an explicit values file; do not rely on `--reuse-values`.

```sh
helm lint deploy/kubernetes/helm/opsknight -f values.production.yaml
helm template opsknight deploy/kubernetes/helm/opsknight \
  -n opsknight -f values.production.yaml > rendered-new.yaml
kubectl apply --dry-run=server -f rendered-new.yaml
```

Diff images, runtime mode, Secrets, database URLs, migration hook, resources, Services, ingress, and policy.

## Run the upgrade

```sh
helm upgrade opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml \
  --wait --timeout 15m
```

Watch the migration hook and workloads. A failed pre-upgrade hook blocks acceptance; do not delete/bypass it to force rollout.

## Verify the upgrade

Confirm release revision/status, new image on every role, migration success, exclusive topology ownership, readiness, role/queue health, and database connections. Run synthetic incident, notification, ChatOps where configured, acknowledgement, resolution, and status projection through a soak window.

## Operate after acceptance

Retain the prior values/manifest/image and verified backup for the rollback window. Confirm dashboards, alerts, backup schedules, and certificates still apply to the new workloads.

## Troubleshooting

**Hook failed:** preserve logs/events and fix direct database/TLS/privilege/migration failure before retrying.

**Upgrade timed out:** inspect scheduling, image pull, storage, probes, and hook state; do not simply extend timeout without diagnosis.

**Mixed images:** inspect rendered values and rollouts; do not accept until all intended roles run the approved digest.

## Change or undo the upgrade

Follow [Rollback](../../upgrades/rollback). `helm rollback` changes Kubernetes manifests but cannot reverse a PostgreSQL migration. Confirm schema compatibility or perform the controlled restore path before application rollback.

## Next steps

- [Helm troubleshooting](./troubleshooting)
- [Kubernetes production checklist](../kubernetes/production-checklist)

