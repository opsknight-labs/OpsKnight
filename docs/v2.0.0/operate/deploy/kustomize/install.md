---
title: Complete an OpsKnight Kustomize installation
description: Create an overlay, provision secrets, run one-shot migration, apply workloads, and validate OpsKnight.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize install, migration job, overlay]
reader:
  status: READER_COMPLETE
  task: Install and validate OpsKnight from zero with Kustomize.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/]
---

# Complete an OpsKnight Kustomize installation

## Prerequisites

Complete [Kubernetes prerequisites](../kubernetes/prerequisites), secrets, database, ingress, and NetworkPolicy planning. Choose a maintained profile and immutable image digest.

## Prepare the overlay

Create this directory outside the maintained profile:

```text
deploy/environments/production/
├── kustomization.yaml
├── delete-placeholder-secret.yaml
├── config-patch.yaml
├── ingress-patch.yaml
└── deployment-patch.yaml
```

`kustomization.yaml` selects exactly one profile, pins the image digest, and applies the environment patches:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: opsknight
resources:
  - ../../kubernetes/kustomize/profiles/integrated
patches:
  - path: delete-placeholder-secret.yaml
  - path: config-patch.yaml
  - path: ingress-patch.yaml
  - path: deployment-patch.yaml
images:
  - name: ghcr.io/opsknight-labs/opsknight
    newName: ghcr.io/opsknight-labs/opsknight
    digest: sha256:<tested-opsknight-image-digest>
```

Delete the example Secret rendered by the base. Your External Secrets or CSI controller must create `opsknight-secrets` separately:

```yaml
# delete-placeholder-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: opsknight-secrets
  namespace: opsknight
$patch: delete
```

Set both public origins:

```yaml
# config-patch.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: opsknight-config
  namespace: opsknight
data:
  NEXTAUTH_URL: https://opsknight.example.com
  NEXT_PUBLIC_APP_URL: https://opsknight.example.com
```

Patch ingress to match your cluster:

```yaml
# ingress-patch.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: opsknight-ingress
  namespace: opsknight
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  rules:
    - host: opsknight.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: opsknight-service
                port: { number: 80 }
  tls:
    - hosts: [opsknight.example.com]
      secretName: opsknight-tls
```

Set explicit replica and resource values instead of inheriting evaluation defaults:

```yaml
# deployment-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opsknight-app
  namespace: opsknight
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: opsknight-app
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits: { cpu: "1", memory: 1Gi }
```

Create `opsknight-secrets` with `DATABASE_URL`, `DIRECT_DATABASE_URL`, `NEXTAUTH_SECRET`, and `ENCRYPTION_KEY` before applying the overlay. If you retain bundled PostgreSQL, also provide `POSTGRES_USER` and `POSTGRES_PASSWORD`. For external PostgreSQL, patch out the bundled Service and StatefulSet and narrow database egress as described in [External PostgreSQL](./external-postgres).

Patch storage, NetworkPolicy, probes, PDBs, and topology spread for the target cluster rather than accepting unknown defaults. Then render and validate the complete result:

```sh
kubectl kustomize deploy/environments/production > rendered.yaml
kubectl apply --server-side --dry-run=server -f rendered.yaml
```

Reject placeholder values, mutable images, integrated-plus-split ownership, public PostgreSQL, broad unintended egress, or missing operational resources.

## Run migration and deploy

Create a one-shot Job from the target image using `DIRECT_DATABASE_URL`. Run Prisma deploy plus the maintained release index installers documented in [Database migrations](../../upgrades/database-migrations). Do not include an ordinary Job in continuously reconciled resources without controller-specific one-shot ordering.

```sh
kubectl apply -f migration-job.yaml
kubectl -n opsknight wait --for=condition=complete job/opsknight-migration --timeout=15m
kubectl -n opsknight logs job/opsknight-migration
kubectl apply -k deploy/environments/production
```

Stop if migration fails.

## Verify the installation

Confirm only the chosen topology, all selected Pods Ready, public readiness, current role heartbeats/queues, and expected ingress/policy. Open `/setup`, create the administrator and service, then run a synthetic incident through notification, acknowledgement, resolution, and status projection.

## Operate it in production

Promote reviewed overlay revisions, keep migration ordering explicit, monitor drift and role/database/provider signals, and complete the Kubernetes production checklist. Never edit live objects as the durable fix; commit the overlay correction.

## Troubleshooting

**Render fails:** inspect resource identity, patch target, YAML type, and referenced path.

**Migration fails:** keep workload revision unapplied; inspect direct database/TLS/privileges and exact migration command.

**Apply prunes required resources:** compare rendered inventories and GitOps ownership before another sync.

**Ready Pods but workflow fails:** inspect role ownership, queues/providers, database routes, and public proxy rather than only readiness.

## Change or remove the installation

Use reviewed overlay revisions and explicit migration/rollback procedures. Before deletion, take a verified backup and understand PVC/finalizer/prune behavior; removing manifests is not a database backup.

## Next steps

- [GitOps lifecycle](./gitops)
- [Kustomize troubleshooting](./troubleshooting)
