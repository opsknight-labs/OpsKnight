---
title: Deploy and operate OpsKnight on Kubernetes
description: Plan, install, secure, validate, upgrade, and recover a production Kubernetes deployment.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes install, production deployment, ingress, NetworkPolicy, high availability]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/kubernetes/README.md
    - deploy/kubernetes/helm/opsknight/
    - deploy/kubernetes/kustomize/base/
    - deploy/kubernetes/kustomize/profiles/
---

# Deploy and operate OpsKnight on Kubernetes

OpsKnight provides two maintained Kubernetes packaging paths. [Helm](./helm) supplies schema-validated values and a migration hook. [Kustomize](./kustomize) supplies bases and profiles for platform-owned overlays. Both use the same application image, runtime roles, database contracts, health endpoints, and public-origin requirements.

## Production prerequisites

Prepare:

- a supported Kubernetes cluster with at least two schedulable worker nodes for disruption testing;
- `kubectl` access and either Helm 3 or Kustomize support in `kubectl`;
- an ingress controller, DNS name, and TLS certificate workflow;
- a default or explicit StorageClass when using bundled PostgreSQL;
- a tested immutable OpsKnight 2.0 image digest;
- a PostgreSQL 15-compatible bundled or managed database;
- a secret manager or GitOps secret-encryption workflow;
- outbound access to required identity, notification, Jira, and webhook providers;
- Prometheus Operator only if using the supplied `ServiceMonitor`.

Use a managed PostgreSQL service for production availability unless your team accepts ownership of backup, replication, failover, upgrades, and storage recovery for the bundled single-replica StatefulSet.

## Select the runtime topology

**Integrated** runs web and background responsibilities in the same application Deployment. It is operationally simpler, but replicas also duplicate integrated background ownership and cannot scale each queue independently.

**Split** runs Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector as separate Deployments. It isolates failures and scaling signals. The maintained split profile starts two replicas for each role; database leases and queue claims coordinate work, but connection capacity must include every replica.

**Split + PgBouncer** routes only Web through transaction pooling. Scheduler, workers, status projection, and migration require a direct PostgreSQL URL.

Read [Split runtime](./split-runtime) and calculate the [database connection budget](../capacity/sizing) before choosing replicas.

## Namespace and ServiceAccount

The supplied manifests use namespace `opsknight` and ServiceAccount `opsknight-app`:

```sh
kubectl create namespace opsknight --dry-run=client -o yaml | kubectl apply -f -
kubectl get namespace opsknight
```

The ServiceAccount does not automatically mount an API token. OpsKnight does not require Kubernetes API access during normal operation. Do not add broad RBAC permissions unless an independently deployed platform component needs them.

## Create production secrets

Never apply the placeholder values in `kustomize/base/secret.yaml`. Create the Secret from your secret manager or from a protected administration shell:

```sh
kubectl -n opsknight create secret generic opsknight-secrets \
  --from-literal=POSTGRES_USER='opsknight' \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  --from-literal=API_KEY_SECRET="$API_KEY_SECRET" \
  --from-literal=ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

For split + PgBouncer, also provide `WEB_DATABASE_URL`. Generate independent authentication secrets with `openssl rand -base64 32` and a 64-character encryption key with `openssl rand -hex 32`. Every pod must use identical active key material. Back these values up separately from the database.

Avoid shell history and plaintext Git storage. With External Secrets, Sealed Secrets, SOPS, or another controller, make that controller create a Secret with the same key names.

## Database URL contract

- `DATABASE_URL` is the normal runtime connection. In a PgBouncer topology, Web may use the transaction-pooled endpoint with `pgbouncer=true`.
- `DIRECT_DATABASE_URL` bypasses pooling and is required for migrations and roles that need direct PostgreSQL behavior.
- `WEB_DATABASE_URL` is the optional Web-only endpoint used by split + PgBouncer assets.

For an external database, require TLS and URI-encode credentials. A representative direct URL is:

```text
postgresql://opsknight:<encoded-password>@db.example.com:5432/opsknight_db?sslmode=verify-full&sslrootcert=/etc/opsknight-db-tls/ca.crt&connection_limit=10&pool_timeout=30
```

NetworkPolicy must allow egress to the database address and port. The checked-in base allows TCP 5432 broadly so it works with external databases; production overlays should narrow the destination to the managed database CIDR or namespace.

## Image pinning

Replace every compatibility or placeholder image with the same tested digest:

```text
ghcr.io/opsknight-labs/opsknight@sha256:<tested-release-digest>
```

Do not use `latest`. Confirm the rendered manifests before applying:

```sh
kubectl kustomize <overlay> | grep -n 'image:'
# or
helm template opsknight deploy/kubernetes/helm/opsknight -f values.production.yaml \
  --namespace opsknight | grep -n 'image:'
```

Private registries require an image pull Secret referenced through the selected packaging method.

## Migrations and rollout ownership

Exactly one migration owner must finish before application pods receive traffic.

The Helm chart creates a `pre-install,pre-upgrade` migration Job when `migrations.job.enabled` is true. It uses the direct database endpoint and runs Prisma migrations plus maintained online-index installers. A failed hook blocks the release.

The Kustomize profiles do not currently include a migration Job. Before applying a new application revision, the operator must run a one-shot Job using the same image and `DIRECT_DATABASE_URL`, wait for success, and only then update Deployments. Do not assume the checked-in split profile creates a migration owner. Follow [Database migrations](../upgrades/database-migrations) for the exact image-specific command and required online indexes.

Verify a Job with:

```sh
kubectl -n opsknight wait --for=condition=complete job/<migration-job> --timeout=15m
kubectl -n opsknight logs job/<migration-job>
```

Expected result: the Job completes once with exit code zero. Keep application rollout stopped on any migration error.

## Bundled PostgreSQL

The Kustomize base includes a single PostgreSQL 15 StatefulSet, ClusterIP Service, 10 GiB `ReadWriteOnce` claim, health probes, and a PDB with `minAvailable: 1`. It is not a multi-node database cluster. A PDB reduces voluntary disruption; it does not provide failover.

Before applying, choose a StorageClass, size storage and resources, define expansion behavior, and establish logical backups. Check the claim:

```sh
kubectl -n opsknight get statefulset,pod,pvc -l app=opsknight-postgres
kubectl -n opsknight exec statefulset/opsknight-postgres -- pg_isready -U opsknight
```

Do not delete the PVC during routine uninstall or rollback. See [Backup and restore](../data/backup-and-restore).

## External PostgreSQL and private CAs

Disable or remove bundled PostgreSQL in the Helm values or Kustomize overlay. Supply complete direct URLs through the existing Secret. Mount a private CA read-only into every migration and runtime pod and include its container path in `sslrootcert`; setting only `NODE_EXTRA_CA_CERTS` is insufficient for Prisma's native PostgreSQL TLS stack.

Test from a disposable pod subject to equivalent NetworkPolicy before rollout. Confirm DNS, certificate hostname, CA chain, database role, schema privileges, and connection budget.

## Services, ingress, and public URLs

Only Web should receive user traffic in split mode. The supplied `opsknight-service` is a ClusterIP on port 80 targeting application port 3000. Point ingress or a load balancer at that Service.

Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin. Configure `TRUSTED_PROXY_HOPS` for the known proxy chain. Preserve `Host`, `X-Forwarded-Proto`, client-address headers, webhook signature headers, and request bodies.

For NGINX Ingress, replace the example host and TLS Secret. The checked-in ingress forces SSL, permits a 10 MiB proxy body, and uses 60-second proxy timeouts. Validate those values against the documented webhook limits and server-sent event behavior. Disable response buffering for realtime streams and choose an idle timeout that does not terminate healthy SSE connections.

```sh
kubectl -n opsknight get ingress,service,endpoints
curl --fail --show-error https://opsknight.example.com/api/health?mode=readiness
```

Test sign-in callbacks, inbound webhooks, live incident updates, and status-page reads through the public hostname.

## Probes and graceful termination

The manifests use:

- startup: `/api/health?mode=readiness`, allowing up to 30 ten-second attempts;
- liveness: `/api/health`;
- readiness: `/api/health?mode=readiness`;
- a `Host: localhost` probe header;
- 30 seconds termination grace for Web/Scheduler and 60 seconds for workers in split mode.

Do not replace readiness with a process-only check. Readiness intentionally detects dependencies and role health. A failing readiness probe removes a pod from service; a failing liveness probe restarts it. Diagnose the underlying check before relaxing thresholds.

```sh
kubectl -n opsknight describe pod <pod>
kubectl -n opsknight logs <pod> --previous
kubectl -n opsknight port-forward pod/<pod> 3000:3000
curl --fail 'http://127.0.0.1:3000/api/health?mode=readiness'
```

## Resources, scheduling, and disruption

Treat checked-in requests and limits as starting values, not certified production sizing. Measure CPU, memory, event-loop delay, queue latency, and database connections under representative traffic.

Split Deployments use topology-spread constraints across `kubernetes.io/hostname` with `DoNotSchedule`. On a one-node cluster, multiple replicas may remain Pending. Production should provide enough failure domains or adapt the overlay consciously.

PDBs protect voluntary disruptions only when enough ready replicas exist. Validate them before maintenance:

```sh
kubectl -n opsknight get pdb
kubectl get pods -n opsknight -o wide
kubectl drain <worker-node> --ignore-daemonsets --delete-emptydir-data
kubectl -n opsknight get pods -w
kubectl uncordon <worker-node>
```

Expected result: traffic remains available, replacement pods become Ready on another node, queues drain, and no migration runs. Do this in a staging cluster before production.

## NetworkPolicy

The base admits Web traffic from the namespace labeled `ingress-nginx`, application self-traffic, database traffic on 5432, DNS, HTTPS, and SMTP ports. Split worker policies deny ingress and permit required egress. These are functional defaults, not a complete organization-specific allow-list.

Patch the ingress-controller namespace label, database destinations, DNS selectors, SMTP ports, and provider egress for your cluster. If a CNI does not enforce NetworkPolicy, the resources provide no isolation. After tightening rules, test OIDC discovery, provider APIs, email, webhooks, database access, DNS, metrics scraping, and migration Jobs.

## Scaling

Scale Web for HTTP/SSE demand and each worker only for its own queue pressure. Include every replica's pool in PostgreSQL `max_connections` budgeting. The supplied HPAs are examples and require a metrics pipeline.

```sh
kubectl -n opsknight scale deployment/opsknight-web --replicas=3
kubectl -n opsknight rollout status deployment/opsknight-web --timeout=10m
```

Do not scale all roles in response to one backlog. Scheduler replicas coordinate by leases, but extra replicas are availability capacity rather than a reason to duplicate scheduling logic. See [Scaling signals](../capacity/scaling-signals).

## Prometheus and ServiceMonitor

Configure `PROMETHEUS_SCRAPE_TOKEN`, expose the metrics port/path only to the monitoring namespace, and apply the optional ServiceMonitor only when its CRD exists:

```sh
kubectl api-resources | grep -i servicemonitor
kubectl apply -f deploy/kubernetes/kustomize/monitoring/servicemonitor.yaml
kubectl -n opsknight get servicemonitor
```

Check that Prometheus sends the configured token and can reach the selected Service through NetworkPolicy. Use [Prometheus](../reliability/prometheus) and the [metrics reference](../../reference/metrics).

## Installation verification

After migration succeeds and manifests are applied:

```sh
kubectl -n opsknight get deployment,statefulset,pod,service,ingress,pdb
kubectl -n opsknight get events --sort-by=.lastTimestamp
kubectl -n opsknight rollout status deployment/<web-or-integrated-deployment> --timeout=10m
kubectl -n opsknight logs deployment/<deployment> --tail=200
```

All expected replicas should be Available, the public readiness request should return HTTP 200, and no pod should be in `CrashLoopBackOff`, `ImagePullBackOff`, or Pending. Then create a synthetic incident and verify ingestion, escalation, notification, acknowledgement, resolution, and status projection.

## Upgrade and rollback

Before upgrade, record rendered manifests and image digests, take a verified database backup, review migrations, and calculate connection headroom during surge. Run the single migration owner first, then roll out Web and role Deployments while watching readiness, queues, provider failures, and database load.

```sh
kubectl diff -k <overlay>
kubectl apply --server-side --dry-run=server -k <overlay>
kubectl apply -k <overlay>
kubectl -n opsknight rollout status deployment --timeout=15m
```

Run a synthetic incident and notification, then observe a soak period. If rollback is required, restore the previous image/manifests only after checking schema compatibility. `kubectl rollout undo` or Helm rollback does not undo PostgreSQL migrations. Follow [Upgrade](../upgrades/upgrade) and [Rollback](../upgrades/rollback).

## Backup and restore

Back up PostgreSQL, exact manifests/values, image digest, public-origin settings, and all stable secrets. For bundled PostgreSQL, do not treat a PVC snapshot as the only recovery method; keep a tested logical backup unless your storage-level procedure guarantees application-consistent recovery.

Restore into an isolated namespace/database, run the matching migration procedure, verify authentication and decryption, and complete a synthetic incident before declaring recovery successful. See [Backup and restore](../data/backup-and-restore).

## Troubleshooting

**Pods are Pending:** inspect events for insufficient resources, unbound PVCs, topology-spread constraints, taints, or image-pull credentials.

**Migration Job fails:** stop rollout, inspect Job logs, verify `DIRECT_DATABASE_URL`, TLS CA mount, network policy, database privileges, and migration compatibility.

**Readiness fails but liveness passes:** query readiness from inside the pod and inspect its component results. Common causes are database reachability, incomplete migrations, missing role heartbeats, or invalid configuration.

**Ingress returns redirects to HTTP or an internal hostname:** correct both public URL settings and trusted proxy hops; verify forwarded host/protocol headers.

**Realtime updates disconnect:** disable ingress response buffering and increase proxy/read idle timeouts for SSE.

**NetworkPolicy blocks a provider:** compare pod egress, DNS resolution, provider port, and namespace/CIDR selectors. Temporarily broadening policy may prove the diagnosis but is not the final fix.

**Node drain is blocked:** inspect PDB availability and Pending replacement pods. Do not delete the PDB to force production maintenance without accepting the availability loss.

**Database connections are exhausted:** sum replica pool limits, include surge pods and migration, reduce pools/replicas, or use supported Web-only PgBouncer transaction pooling.

For a diagnostic sequence, use [Kubernetes pods are not ready](../../troubleshooting/kubernetes/pods-not-ready).

## Production acceptance checklist

- Namespace, ServiceAccount, immutable images, and secret ownership are reviewed.
- Exactly one migration owner runs before traffic reaches the new revision.
- Integrated or split ownership is intentional; PgBouncer is Web-only.
- External database TLS or bundled PostgreSQL storage and backup are tested.
- Ingress, TLS, public origins, proxy trust, SSE, and webhook signatures work publicly.
- Probes, resources, topology spread, PDBs, NetworkPolicy, and connection budgets are validated.
- Metrics and role/queue/provider/database alerts are active.
- Node drain, backup restore, upgrade, rollback decision, and synthetic incident tests have passed.
