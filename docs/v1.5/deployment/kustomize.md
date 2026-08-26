---
order: 4
title: Kustomize
description: Deploy OpsKnight v1.5 with the recommended split runtime, default web autoscaling, or split plus PgBouncer.
---

# Kustomize

OpsKnight v1.5 ships first-class Kustomize profiles that mirror the primary Helm runtime topologies.

**For new production Kubernetes deployments, use the split profile.** It runs independent web, worker, and scheduler roles and includes a CPU-driven web HPA by default. The root `k8s/` entry point remains integrated for backward compatibility.

## Supported profiles

| Profile | Command | Guidance |
| --- | --- | --- |
| Integrated | `kubectl apply -k k8s` | Backward-compatible root entry point. |
| Integrated (explicit) | `kubectl apply -k k8s/profiles/integrated` | Same integrated topology explicitly. |
| **Split — recommended** | `kubectl apply -k k8s/profiles/split` | New production deployments; includes web HPA 2→12. |
| Split + PgBouncer | `kubectl apply -k k8s/profiles/split-pgbouncer` | Recommended split topology plus web connection pooling. |

Kustomize has no Helm-style values switch, so topology is selected by profile and environment-specific changes are applied with standard patches/components.

## Profile defaults

### Integrated

- 2 application replicas;
- `OPSKNIGHT_PROCESS_ROLE=integrated`;
- PostgreSQL connection limit 40 per pod;
- 30-second termination grace period;
- no HPA in the integrated profile by default.

### Split — recommended

- 2 baseline web replicas;
- web HPA enabled by default, 2→12 replicas;
- HPA CPU target 70%;
- web request/limit: 250m / 1000m CPU;
- 2 worker replicas;
- 1 scheduler replica;
- database pools 10 / 10 / 5;
- worker batch size 100;
- worker concurrency 15;
- worker idle poll 1000 ms;
- worker busy poll 100 ms;
- worker termination grace 60 seconds.

The HPA requires the Kubernetes resource Metrics API. If resource metrics are unavailable, the two baseline web replicas continue to run, but automatic scale decisions cannot be calculated.

CPU is the default web scaling signal because validation identified web CPU throttling as the first concurrency bottleneck. Memory-based scaling is intentionally not part of the shipped split HPA.

### Split + PgBouncer

```text
web -> PgBouncer -> PostgreSQL
worker ----------> PostgreSQL
scheduler --------> PostgreSQL
```

PgBouncer defaults match Helm:

- transaction pooling;
- port 6432;
- maximum 1000 client connections;
- default backend pool 40;
- reserve pool 10;
- maximum prepared statements 100;
- Prisma startup compatibility for `extra_float_digits` and `search_path`;
- numeric uid/gid 70 for non-root execution;
- 1 PgBouncer replica.

Only web traffic uses PgBouncer. Worker and scheduler database traffic remains direct to PostgreSQL.

## Repository layout

```text
k8s/
├── base/
├── profiles/
│   ├── integrated/
│   ├── split/
│   └── split-pgbouncer/
├── components/
│   ├── ingress/
│   ├── integrated-hpa/
│   ├── web-hpa/
│   ├── network-integrated/
│   ├── network-split/
│   └── network-split-pgbouncer/
├── kustomization.yaml
└── README.md
```

The split profile includes the `web-hpa` component directly. The split-PgBouncer profile builds on split, so it inherits the same default web autoscaling policy.

## Build a production customization

Do not edit shipped profiles in place for environment-specific settings. Create a separate production Kustomization that references the selected profile and applies patches.

```text
deploy/production/
├── kustomization.yaml
├── image-patch.yaml
├── database-patch.yaml
├── resources-patch.yaml
└── hpa-patch.yaml
```

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../k8s/profiles/split

patches:
  - path: database-patch.yaml
  - path: resources-patch.yaml
  - path: hpa-patch.yaml
```

Use `k8s/profiles/split-pgbouncer` instead if connection measurements justify PgBouncer.

## Customize autoscaling

Adjust HPA bounds or CPU target with a production patch:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: opsknight-app-hpa
  namespace: opsknight
spec:
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

If a specific environment must disable HPA, delete it in that environment's customization rather than changing the shared profile:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: opsknight-app-hpa
  namespace: opsknight
$patch: delete
```

Before increasing `maxReplicas`, recalculate the PostgreSQL connection budget and confirm node capacity can schedule the additional web pods.

## Configuration ownership

At minimum review and customize:

- immutable application image tag or digest;
- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`;
- database host/URI and credentials;
- `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`;
- web HPA bounds and resource requests/limits;
- worker/scheduler replica counts;
- role-specific database connection limits;
- worker concurrency/batch/poll settings where justified;
- storage class/capacity and backup policy;
- ingress class, host, TLS settings, and proxy timeouts;
- PDB behavior;
- NetworkPolicy ingress selectors and database/provider destinations.

Use a secret controller or other approved delivery system for production values. Do not commit rendered Secrets.

## PostgreSQL connection budgeting

Profile connection limits are per pod:

```text
(web replicas × web pool)
+ (worker replicas × worker pool)
+ (scheduler replicas × scheduler pool)
+ operational reserve
< PostgreSQL max_connections
```

At the split baseline:

```text
2×10 + 2×10 + 1×5 = 45 application connections
```

Without PgBouncer, also calculate the worst case at the HPA maximum. With the shipped `maxReplicas: 12`, the web tier can theoretically consume up to 120 direct PostgreSQL connections if every pool is full.

With split-PgBouncer, web client connections are multiplexed while worker and scheduler pools remain direct.

Pooling should follow measurement. It does not replace query profiling, lock analysis, or database capacity planning.

## PgBouncer credentials

The split-PgBouncer profile includes PgBouncer configuration and authentication material suitable as a deployment template. Before production use, replace placeholder credentials and keep PgBouncer authentication synchronized with the PostgreSQL backend credentials.

Never commit real PgBouncer or PostgreSQL credentials to the repository.

## Optional components

The shipped components provide:

- integrated HPA: `k8s/components/integrated-hpa`;
- web HPA: `k8s/components/web-hpa` — already included by the split profile;
- ingress: `k8s/components/ingress`;
- integrated NetworkPolicy: `k8s/components/network-integrated`;
- split NetworkPolicy: `k8s/components/network-split`;
- split + PgBouncer NetworkPolicy: `k8s/components/network-split-pgbouncer`.

Reference only the NetworkPolicy component appropriate for the selected runtime topology.

## Render and validate

Integrated:

```bash
kubectl kustomize k8s > /tmp/opsknight-integrated.yaml
```

Recommended split:

```bash
kubectl kustomize k8s/profiles/split > /tmp/opsknight-split.yaml
```

The split render should include:

- web, worker, and scheduler Deployments;
- an `autoscaling/v2` HPA;
- `minReplicas: 2`;
- `maxReplicas: 12`;
- a 70% CPU target.

Split + PgBouncer:

```bash
kubectl kustomize k8s/profiles/split-pgbouncer > /tmp/opsknight-split-pgbouncer.yaml
```

Production customization:

```bash
kubectl kustomize deploy/production > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Review the rendered output for:

- intended role Deployments;
- web HPA bounds and CPU target;
- public Service selecting only the web role;
- database URLs and connection limits;
- PgBouncer port/backend configuration if enabled;
- startup/liveness/readiness probes;
- security contexts and ServiceAccount token behavior;
- resources and PDBs;
- ingress/TLS and NetworkPolicy;
- placeholder secrets or development URLs.

## Apply and observe

```bash
kubectl apply -k deploy/production
kubectl -n opsknight get deploy,pods,svc,pdb,hpa
kubectl -n opsknight get pods -L opsknight-role
kubectl -n opsknight top pods
```

For split mode, verify the web HPA reports CPU metrics and confirm workers continue processing durable jobs while the scheduler remains healthy during a web rollout.

If PgBouncer is enabled, verify web pods connect through port 6432 and workers/scheduler still connect directly to PostgreSQL.

## Upgrade and rollback

1. Back up PostgreSQL and critical secrets.
2. Record the current rendered manifests and image digest.
3. Render/diff the new profile/customization.
4. Recalculate PostgreSQL connection budget at baseline and HPA maximum.
5. Verify the resource Metrics API.
6. Apply and observe migrations, readiness, HPA, workers, scheduler, and database connections.
7. Verify a controlled incident and background-job flow.

Kubernetes rollout rollback does not reverse Prisma migrations or data changes. Confirm schema compatibility before reverting application resources.

## CI parity

Repository CI renders integrated, split, and split-PgBouncer Kustomize profiles alongside equivalent Helm configurations. The split profile contract includes default web HPA bounds and CPU scaling behavior so Helm and Kustomize cannot silently drift.

## Related topics

- [Deployment overview](./README)
- [Kubernetes](./kubernetes)
- [Helm](./helm)
- [Scalability and capacity planning](../core-concepts/scalability)
- [Monitoring](./monitoring)
- [Configuration reference](../getting-started/configuration)
