---
title: Configure OpsKnight Helm values
description: Understand and validate the Helm value groups that control images, runtime roles, secrets, database, ingress, policy, probes, and monitoring.
type: reference
product_area: deployment
audience: [operator, administrator]
keywords: [Helm values, values schema, configuration]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/values.yaml, deploy/kubernetes/helm/opsknight/values.schema.json]
---

# Configure OpsKnight Helm values

The chart validates values against `values.schema.json`. Render and schema validation reduce configuration mistakes but do not prove the deployment is secure or operationally sized.

## Core value groups

- `runtime.mode`: `integrated` or `split`; PgBouncer requires split.
- `image`: repository, tag/digest, pull policy, and pull Secrets. Digest takes precedence.
- `config`: public origins and common runtime settings.
- `secrets`: use an existing production Secret and explicit key mapping.
- `migrations.job.enabled`: creates the one-shot install Job and blocking pre-upgrade hook. Disable it only when an external release process supplies that owner; runtime Pods still skip in-process migration.
- `postgresql`: bundled database, storage, resources, credentials, and CA mounting.
- `database`: application endpoint and aggregate connection ceiling.
- `pgbouncer`: Web-only transaction pooling in split mode.
- `web`, `scheduler`, and worker/status groups: replicas, pools, resources, concurrency, disruption, and termination.
- `service` and `ingress`: public routing.
- probe groups: startup, liveness, and readiness behavior.
- `networkPolicy`: ingress selectors and database/provider egress.
- `metrics.serviceMonitor`: Prometheus Operator discovery and scrape-token Secret.

## Production rules

Keep production values outside the chart directory, pin the chart source revision and image digest, use a managed Secret, and review the complete rendered output. Never store cleartext production secrets in Helm values because release state can retain them.

## Validate values

```sh
helm lint deploy/kubernetes/helm/opsknight -f values.production.yaml
helm template opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight -f values.production.yaml > rendered.yaml
kubectl apply --dry-run=server -f rendered.yaml
```

Inspect images, Secret references, migration ownership, database paths, Services, ingress, NetworkPolicy, resources, probes, PDBs, and replica counts before installation.

## Related guides

- [Install with Helm](./install)
- [Integrated values](./integrated)
- [Split values](./split)

## External secret stores

`externalSecrets.csi.enabled` defaults to `false`. When enabled, set `secretProviderClass` to a pre-created class in the release namespace and optionally set `mountPath` (default `/mnt/opsknight-secrets`, must remain below `/mnt/`). Runtime roles and migration Jobs receive read-only mounts. Use `secrets.existingSecret` for synchronized environment credentials. `podLabels` supplies workload identity labels, including on CSI migration Jobs. Driver installation, synchronization and rotation remain cluster/operator responsibilities. See [external secrets and OpenShift](./external-secrets).

`podLabels` accepts additional identity/organizational labels, but reserves `app.kubernetes.io/name`, `app.kubernetes.io/instance`, `app.kubernetes.io/component`, `app.kubernetes.io/version`, `app.kubernetes.io/managed-by`, and `helm.sh/chart`. Helm rejects those keys to prevent duplicate Pod labels and selector mismatches, including on migration Jobs.
