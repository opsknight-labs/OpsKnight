---
title: Deploy and operate OpsKnight with Kustomize
description: Build production manifests from maintained profiles and operate them through overlays or GitOps.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize, GitOps deployment, Kubernetes overlays, split PgBouncer]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/kubernetes/kustomize/base/kustomization.yaml
    - deploy/kubernetes/kustomize/profiles/integrated/
    - deploy/kubernetes/kustomize/profiles/split/
    - deploy/kubernetes/kustomize/profiles/split-pgbouncer/
    - deploy/kubernetes/kustomize/monitoring/servicemonitor.yaml
---

# Deploy and operate OpsKnight with Kustomize

Use Kustomize when your platform team owns manifests, environment overlays, and GitOps promotion. Keep the maintained profile as the base and express only environment differences in your overlay. Do not copy the rendered resources into an independent manifest set.

Read [Kubernetes](./kubernetes) for platform requirements and [Split runtime](./split-runtime) before selecting a topology.

## Maintained profiles

- `profiles/integrated`: the shared base plus one integrated Deployment and HPA.
- `profiles/split`: Web, Scheduler, General Worker, Critical Worker, Bulk Worker, Status Projector, role PDBs, Web Service/HPA, and role-specific NetworkPolicies.
- `profiles/split-pgbouncer`: split plus two PgBouncer replicas, Service, PDB, NetworkPolicy, auth/config resources, and a Web patch that uses `WEB_DATABASE_URL` while preserving `DIRECT_DATABASE_URL`.
- `monitoring/servicemonitor.yaml`: optional Prometheus Operator resource; it is not included automatically.

The shared base also contains namespace, placeholder Secret, ConfigMap, ServiceAccount, bundled PostgreSQL, ingress, NetworkPolicies, Service, and PDBs. Production overlays must replace placeholder images, origins, credentials, hostnames, storage, and capacity values.

## Render each profile before choosing

```sh
kubectl kustomize deploy/kubernetes/kustomize/profiles/integrated > /tmp/integrated.yaml
kubectl kustomize deploy/kubernetes/kustomize/profiles/split > /tmp/split.yaml
kubectl kustomize deploy/kubernetes/kustomize/profiles/split-pgbouncer > /tmp/split-pgbouncer.yaml
```

Inspect Services, images, Deployments, StatefulSets, PDBs, NetworkPolicies, ingress, and Secrets. Split profiles require a tested 2.0 split-runtime image; the checked-in placeholder cannot run production.

## Create an environment overlay

Use a repository-owned directory such as:

```text
deploy/environments/production/
├── kustomization.yaml
├── config-patch.yaml
├── ingress-patch.yaml
├── resources-patch.yaml
├── delete-placeholder-secret.yaml
├── delete-bundled-postgres.yaml
└── database-egress-patch.yaml
```

A split external-database overlay can begin with:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: opsknight

resources:
  - ../../../deploy/kubernetes/kustomize/profiles/split

images:
  - name: ghcr.io/opsknight-labs/opsknight
    newName: ghcr.io/opsknight-labs/opsknight
    digest: sha256:<tested-2.0.0-manifest-digest>

patches:
  - path: config-patch.yaml
  - path: ingress-patch.yaml
  - path: resources-patch.yaml
  - path: delete-placeholder-secret.yaml
  - path: delete-bundled-postgres.yaml
  - path: database-egress-patch.yaml
```

Kustomize matches every occurrence of the named application image, which keeps all roles on one digest. Confirm with `kubectl kustomize <overlay> | grep -n 'image:'`.

## Keep Secrets outside rendered Git content

The base includes an unsafe placeholder `opsknight-secrets`. Remove it in production:

```yaml
# delete-placeholder-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: opsknight-secrets
  namespace: opsknight
$patch: delete
```

Make your secret manager create `opsknight-secrets` with these keys before applying workloads:

```sh
kubectl -n opsknight create secret generic opsknight-secrets \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  --from-literal=ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --from-literal=DATABASE_URL="$DIRECT_DATABASE_URL" \
  --from-literal=DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
  --from-literal=WEB_DATABASE_URL="$WEB_DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

For a GitOps controller, use External Secrets, SOPS, Sealed Secrets, or an equivalent mechanism rather than committing plaintext/base64 credentials. Preserve authentication and encryption keys across every replica, upgrade, and restore.

## Patch public configuration

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
  TRUSTED_PROXY_HOPS: "1"
```

Both origins must be the exact public HTTPS origin. Adjust trusted proxy hops only to match known ingress/load-balancer hops.

Patch ingress for your controller and certificate:

```yaml
# ingress-patch.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: opsknight-ingress
  namespace: opsknight
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  rules:
    - host: opsknight.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: opsknight-service, port: { number: 80 } }
  tls:
    - hosts: [opsknight.example.com]
      secretName: opsknight-tls
```

Preserve webhook signature headers and disable response buffering for server-sent events.

## External PostgreSQL

Delete both bundled resources:

```yaml
# delete-bundled-postgres.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: opsknight-postgres, namespace: opsknight }
$patch: delete
---
apiVersion: v1
kind: Service
metadata: { name: opsknight-postgres-service, namespace: opsknight }
$patch: delete
```

Put TLS-enabled direct URLs in the external Secret. Patch every relevant NetworkPolicy to the database CIDR rather than leaving `to: []`. The maintained `external-database-cidr-patch.yaml` is an example for split workers; production must also cover Web, migration, and PgBouncer as applicable.

For a private CA, create a Secret, mount `ca.crt` read-only into every role and the migration Job, and include `sslmode=verify-full&sslrootcert=<mounted-path>` in direct URLs. Node's `NODE_EXTRA_CA_CERTS` does not by itself configure Prisma database TLS.

## Split + PgBouncer production changes

Base your overlay on `profiles/split-pgbouncer`, replace the placeholder `opsknight-pgbouncer-auth` Secret, and patch `pgbouncer.ini` when using an external database. The checked-in config points to `opsknight-postgres-service`.

PgBouncer uses transaction pooling, port 6432, `default_pool_size=10`, `reserve_pool_size=5`, and `max_client_conn=1000`. Web reads `WEB_DATABASE_URL`; all other roles and migration use the direct database. Never route migrations through PgBouncer.

Calculate PgBouncer server pools plus every direct role and operational headroom before changing replicas. See [capacity sizing](../capacity/sizing).

## Patch replicas and resources

Use targeted patches so a worker change cannot accidentally affect every Deployment:

```yaml
# resources-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: opsknight-web, namespace: opsknight }
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: opsknight-app
          resources:
            requests: { cpu: 500m, memory: 512Mi }
            limits: { cpu: "2", memory: 2Gi }
```

The integrated profile includes an HPA from 2–10 replicas; split includes a Web HPA from 2–12. Remove or patch the HPA when GitOps owns a fixed replica count. Scale workers from lane backlog and database/provider capacity, not Web CPU.

Review topology-spread constraints and PDBs against actual node count. `DoNotSchedule` keeps replicas spread but leaves pods Pending when the cluster lacks eligible nodes.

## Migration ownership

The maintained Kustomize profiles do **not** include a migration Job. Run exactly one one-shot Job from the target image against `DIRECT_DATABASE_URL` before applying new workload Deployments. A production Job command must run Prisma deploy plus the maintained status-platform and voice-attempt index installers, matching [Database migrations](../upgrades/database-migrations).

```sh
kubectl apply -f migration-job.yaml
kubectl -n opsknight wait --for=condition=complete job/opsknight-migration --timeout=15m
kubectl -n opsknight logs job/opsknight-migration
```

Do not add that Job to the same continuously reconciled overlay as Deployments unless your GitOps controller guarantees ordering and one-shot semantics. Delete/recreate it deliberately per release or use the controller's supported sync-wave/hook mechanism.

The normal Job does not install the optional SLA scheduler index. Before switching SLA Scheduler to `INDEXED`, run `DATABASE_URL="$DIRECT_DATABASE_URL" npm run prisma:indexes:sla-scheduler` from the matching image/trusted environment and verify completion.

## Add Prometheus Operator discovery

Only include the supplied `monitoring/servicemonitor.yaml` when its CRD exists. Configure the matching scrape token and NetworkPolicy first:

```sh
kubectl api-resources | grep -i servicemonitor
kubectl -n opsknight create secret generic opsknight-metrics \
  --from-literal=PROMETHEUS_SCRAPE_TOKEN="$PROMETHEUS_SCRAPE_TOKEN"
```

Patch the ServiceMonitor selector/labels and token reference for your Prometheus installation. Render and inspect it with the rest of the overlay.

## Validate in CI

```sh
kubectl kustomize deploy/environments/production > /tmp/opsknight.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight.yaml
kubectl diff -k deploy/environments/production
```

Add policy-as-code checks for immutable images, placeholder Secrets, privileged containers, missing resources, broad egress, public database Services, and required PDBs. Review the rendered resource list:

```sh
kubectl kustomize deploy/environments/production \
  | kubectl apply --dry-run=client -f - -o name
```

Expected output contains only the chosen topology: integrated **or** all split roles, never both.

## Apply and verify

After the migration Job succeeds:

```sh
kubectl apply -k deploy/environments/production
kubectl -n opsknight rollout status deployment --timeout=15m
kubectl -n opsknight get deploy,pod,svc,ingress,pdb,networkpolicy
kubectl -n opsknight get events --sort-by=.lastTimestamp
```

Verify public readiness, every role, queues, providers, database connections, and status projection. Then run a synthetic alert through notification, acknowledgement, and resolution.

## GitOps promotion

Promote the immutable digest and overlay commit through environments. Store the rendered diff, migration outcome, and synthetic-test result with the change record. Configure health checks so GitOps does not call a Deployment healthy merely because it exists; Available replicas and application readiness must pass.

Avoid automatic pruning of PVCs, Secrets, migration evidence, or database resources without an explicit retention decision.

## Upgrade and rollback

Before upgrade, back up PostgreSQL and stable Secrets, record the current overlay commit and digest, render/diff the new overlay, and run the one-shot migration. Apply workloads only after migration success, then observe a soak period.

Rollback by reverting the overlay commit/digest and reconciling:

```sh
git revert <promotion-commit>
kubectl diff -k deploy/environments/production
kubectl apply -k deploy/environments/production
kubectl -n opsknight rollout status deployment --timeout=15m
```

Manifest rollback does not reverse database migrations. Confirm the previous image supports the current schema before reconciliation. Use [Rollback](../upgrades/rollback) for the decision process.

## Troubleshooting

**The placeholder image remains:** the `images.name` does not exactly match the profile image. Inspect rendered images before apply.

**The placeholder Secret reappears:** the deletion patch is absent or did not match namespace/name. Never let GitOps overwrite the externally managed runtime Secret.

**Integrated and split Deployments both render:** the overlay referenced the base and a profile, or combined profiles. Reference exactly one maintained profile.

**PgBouncer cannot reach the external database:** its checked-in ConfigMap still targets the bundled Service or NetworkPolicy lacks the external CIDR/port.

**Pods are Pending:** inspect resources, PVC binding, taints, and `DoNotSchedule` topology constraints.

**Migration and workloads race:** the Job was included in an unordered apply. Separate migration from workload reconciliation or configure explicit GitOps hook ordering.

**SSE or login fails through ingress:** correct public origins/proxy trust, forwarded headers, buffering, and idle timeouts.

**`kubectl diff` exposes sensitive values:** keep Secret material external to the rendered overlay and restrict CI logs/artifacts.

## Production acceptance checklist

- Exactly one maintained profile is the overlay base.
- All application and PgBouncer images are immutable and architecture-compatible.
- Placeholder Secrets and hosts are absent from rendered output.
- Exactly one migration Job completes before workload reconciliation.
- External database/PgBouncer/direct URL and TLS paths are verified.
- Resources, replicas, HPAs, PDBs, spread constraints, storage, and connection budgets are reviewed.
- Ingress/TLS/public origins/SSE and NetworkPolicy are tested.
- GitOps diff, upgrade, schema-compatible rollback, backup/restore, node drain, and synthetic incident procedures pass.
