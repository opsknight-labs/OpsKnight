---
order: 4
title: Kustomize
description: Render, customize, validate, and apply the Kubernetes manifests shipped with OpsKnight v1.3.
---

# Kustomize

The repository's `k8s/kustomization.yaml` composes the namespace, application, PostgreSQL, services, ingress, HPA, network policy, service account, PVC, and PodDisruptionBudget manifests.

## Do not apply the base unchanged in production

The base contains placeholder secrets, a localhost application URL, a floating `latest` image, and an in-cluster single PostgreSQL StatefulSet. Create an overlay that replaces these values and review every rendered object.

```text
deploy/overlays/production/
├── kustomization.yaml
├── ingress-patch.yaml
├── app-patch.yaml
└── generated secret input outside Git
```

At minimum, customize:

- image tag or digest;
- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` public HTTPS origin;
- database credentials and `DATABASE_URL`/database topology;
- `NEXTAUTH_SECRET` and 64-hex-character `ENCRYPTION_KEY`;
- ingress class, host, TLS secret, and annotations;
- StorageClass, capacity, retention policy, and backup tooling;
- resource requests/limits, replica count, HPA, PDB, and network policy.

Use a secret controller or platform secret store. Do not commit a generated Secret containing production values.

## Render and validate

```bash
kubectl kustomize deploy/overlays/production > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Review the rendered output for placeholder values and unintended public services before applying. A server-side dry run validates against the target cluster's API and admission policies without persisting objects.

## Apply and observe

```bash
kubectl apply -k deploy/overlays/production
kubectl -n opsknight rollout status deployment/opsknight-app
kubectl -n opsknight get pods,svc,ingress,pvc
kubectl -n opsknight logs deployment/opsknight-app --tail=200
```

The container runs database migrations on startup. Verify migration logs and `/api/health?mode=readiness`, then test login, a database write, and an incident workflow.

## Update and rollback

Commit overlay changes, take a database backup, change only the pinned image reference, render/diff, and apply. Keep the previous manifest and image digest.

Kubernetes rollout rollback changes pods; it does not undo PostgreSQL migrations. If a release requires data rollback, use the release-specific procedure and pre-upgrade database recovery point.

## Related topics

- [Kubernetes](./kubernetes)
- [Deployment](./README)
- [Monitoring](./monitoring)
- [Configuration Reference](../getting-started/configuration)
