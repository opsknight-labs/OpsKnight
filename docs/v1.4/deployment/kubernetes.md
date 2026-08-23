---
order: 2
title: Kubernetes deployment
description: Choose Helm or Kustomize, replace unsafe base values, deploy the app and PostgreSQL topology, and verify migrations and incident delivery.
---

# Kubernetes deployment

OpsKnight ships both a Helm chart at `helm/opsknight` and a Kustomize base at `k8s/`. Both deploy the same Next.js application and PostgreSQL-backed runtime. Use the method your platform team can render, review, secure, upgrade, and recover consistently.

## Choose a packaging path

| Path                        | Use it when                                                       | Detailed guide           |
| --------------------------- | ----------------------------------------------------------------- | ------------------------ |
| Helm chart                  | Your release process manages versioned values and Helm releases.  | [Helm](./helm)           |
| Kustomize base and overlays | Your release process owns rendered YAML and environment overlays. | [Kustomize](./kustomize) |

Do not install both into the same namespace. Their resource names and lifecycle ownership differ.

## Production prerequisites

- A Kubernetes cluster and `kubectl` access that can perform a server-side dry run.
- Helm 3 for the Helm path, or the Kustomize support included in `kubectl` for the raw-manifest path.
- A tested immutable OpsKnight image tag or digest.
- An ingress controller, DNS, and TLS-certificate process.
- A PostgreSQL topology with durable storage, capacity monitoring, backups, and a tested restore.
- A secrets-delivery process for the database password, `NEXTAUTH_SECRET`, and 64-hex-character `ENCRYPTION_KEY`.
- External collection for application/container logs and platform/database metrics.

Validate rendered API versions and admission/security policies against the actual target cluster. v1.4 does not declare one universal Kubernetes-version support matrix.

## Understand the shipped Kustomize base

`k8s/kustomization.yaml` includes:

- Namespace, ServiceAccount, application Deployment, Service, Ingress, HPA, PodDisruptionBudget, and NetworkPolicy;
- Secret and ConfigMap examples; and
- a single PostgreSQL StatefulSet, governing ClusterIP Service, and StatefulSet volume claim template.

The checked-in base is an example, not a production release:

- `secret.yaml` contains known placeholder values;
- both public application URLs are localhost;
- the application image is pinned to the current `1.4.0` release, which may not be the release you have qualified;
- `DATABASE_URL` contains a fixed per-process pool setting;
- ingress host/class, timeouts, rate controls, and TLS assumptions are nginx-specific examples;
- NetworkPolicy ingress selectors and broad external database/HTTPS egress require cluster-specific review; and
- the included PostgreSQL is a single instance, not an HA, backup, or managed-database service.

Never apply the base unchanged to production and never commit real Secret values. Build an overlay or use the Helm production-values process.

The `1.4.0` stable image includes the fail-closed migration entrypoint and is published for amd64 and arm64. The continuously updated test image from `main` remains amd64-only.

The application ServiceAccount token is not mounted by default because OpsKnight does not require Kubernetes API access. Keep it disabled unless a deliberate extension needs that credential.

## Configure the shared runtime

Every application replica must receive consistent values:

| Value                 | Requirement                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | One reachable, migrated PostgreSQL database; size the total connection budget across replicas. |
| `NEXTAUTH_URL`        | Exact external HTTPS origin used by authentication.                                            |
| `NEXT_PUBLIC_APP_URL` | External origin used in user-facing links; normally matches `NEXTAUTH_URL`.                    |
| `NEXTAUTH_SECRET`     | Stable, high-entropy value identical on every replica.                                         |
| `ENCRYPTION_KEY`      | Stable 64-hex-character value identical on every replica and preserved with recovery material. |

For an external database, remove/disable the bundled PostgreSQL resources and replace the application's `DATABASE_URL`; changing only `POSTGRES_HOST` can leave other bundled assumptions in place. Configure database TLS/trust according to the provider.

Notification providers are configured in the OpsKnight UI and encrypted in PostgreSQL. Backing up Kubernetes Secrets without the database does not recover those provider records; backing up PostgreSQL without `ENCRYPTION_KEY` does not recover usable encrypted credentials.

## Render before applying

For Kustomize:

```bash
kubectl kustomize deploy/overlays/production > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
```

For Helm:

```bash
helm lint helm/opsknight --values values.production.yaml
helm template opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml > /tmp/opsknight-rendered.yaml
kubectl apply --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Review the rendered image reference, public origins, Secret sources, database URL, ingress/TLS, service exposure, probes, resources, HPA/PDB, storage, and NetworkPolicy. Scan for placeholder strings and the `latest` tag.

## Apply and verify

Apply through the matching owner:

```bash
# Kustomize overlay
kubectl apply -k deploy/overlays/production

# Or Helm release
helm upgrade --install opsknight helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.production.yaml \
  --wait --timeout 10m
```

For the checked-in Kustomize names:

```bash
kubectl -n opsknight rollout status deployment/opsknight-app --timeout=10m
kubectl -n opsknight get pods,svc,ingress,pvc,hpa,pdb
kubectl -n opsknight logs deployment/opsknight-app --tail=200
```

Helm's generated Deployment is normally `opsknight`; confirm with `helm status` when name overrides are used.

The `1.4.0` image and later attempt `prisma migrate deploy` up to three times and can run the packaged recovery helper between attempts. If migration still fails, the container exits non-zero rather than serving against an unknown schema. A startup probe gives migration and cold start up to five minutes before liveness restarts can begin. Confirm the selected release behavior, inspect startup logs, call readiness, then exercise a database write:

```bash
kubectl -n opsknight port-forward service/opsknight-service 3000:80
curl --fail 'http://127.0.0.1:3000/api/health?mode=readiness'
```

After ingress is live, verify login, create a synthetic service/incident, trigger and resolve through the intended inbound route, and confirm the intended external notification.

## Ingress and streaming

Forward the original host, scheme, and client IP only through trusted proxies. Allow long-lived server-sent event responses, disable buffering for them, and choose proxy idle/read timeouts that do not cut the dashboard stream unexpectedly. Do not copy the base nginx annotations to another ingress controller.

Preserve `/api/health` for liveness and `/api/health?mode=readiness` for traffic gating. The readiness check includes PostgreSQL; liveness alone does not prove the application can serve product workflows.

## Replicas, HPA, and scheduled work

The Kustomize base HPA example targets two to ten application replicas using CPU and memory utilization. The Helm chart has its own values. These are configuration defaults, not measured capacity recommendations; set requests, limits, replica floors, and scaling thresholds from a production-like load test. HPA resource metrics require a working cluster metrics pipeline.

Every application process can start the internal scheduler, while a PostgreSQL lock coordinates active ownership. Leave `ENABLE_INTERNAL_CRON` enabled on at least one healthy replica. Each replica still has its own immediate notification queue, real-time cache, and circuit-breaker state; drain pods before termination and test delivery during rollouts.

The shipped PDB limits voluntary disruption but cannot protect against node, zone, database, storage, or provider failure. Test the complete topology before calling it highly available.

## PostgreSQL and recovery

The bundled PostgreSQL StatefulSet has one replica. Storage is created by its `volumeClaimTemplates`; the base no longer creates an unused standalone PVC. Its governing Service remains a normal ClusterIP because changing an existing allocated Service to headless is immutable and would break in-place upgrades.

The bundled `postgres:15-alpine` container runs as that image's `postgres` uid/gid (`70`) and receives writable mounts for its data, runtime socket, and temporary files. Revalidate the security context before substituting a different PostgreSQL image.

The bundled PostgreSQL NetworkPolicy allows application ingress and denies new outbound connections from the database pod. Add narrowly scoped egress only if a deliberate extension requires it.

A PVC and PDB do not create database failover or backups. For production, either operate that database with an explicit single-instance risk acceptance and recovery plan, or replace it with a managed/operator-owned topology.

Back up PostgreSQL outside the cluster failure domain and rehearse restore with the matching `ENCRYPTION_KEY`. Monitor connections, locks, query latency, storage, WAL/replication where applicable, and backup success.

## Upgrade and rollback

1. Record the current rendered resources, image digest, Secret/config sources, and database schema state.
2. Take and verify a database backup.
3. Render and server-dry-run the new release.
4. Apply a pinned image and observe migration/startup logs.
5. Run readiness, authentication, write, synthetic incident, and notification checks.

A Deployment or Helm rollback changes application resources; it does not reverse PostgreSQL migrations or data changes. Confirm schema compatibility before rolling back code, and use the pre-upgrade recovery point when data rollback is required.

## Troubleshooting

| Symptom                               | Check                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pod starts but readiness fails        | PostgreSQL DNS/network/TLS/credentials, migration logs, and schema state.                             |
| Login redirects repeatedly            | Exact external `NEXTAUTH_URL`, ingress forwarded host/scheme, and identical secrets across replicas.  |
| Only some requests fail after scaling | Replica configuration drift, different secrets, pool exhaustion, or process-local state assumptions.  |
| SSE/dashboard refresh disconnects     | Ingress buffering and idle/read timeouts, connection draining, and client reconnects.                 |
| HPA shows unknown metrics             | Metrics pipeline, resource requests, HPA API support, and HPA events.                                 |
| Scheduled actions stop                | Scheduler logs/state, PostgreSQL lock/heartbeat, and at least one replica with internal cron enabled. |
| Provider settings cannot decrypt      | The running `ENCRYPTION_KEY` does not match the database contents.                                    |
| NetworkPolicy blocks traffic          | Ingress-controller namespace labels, DNS, PostgreSQL, and required provider egress destinations.      |

## Related topics

- [Kustomize](./kustomize)
- [Helm](./helm)
- [Monitoring](./monitoring)
- [Database migrations](./database-migrations)
- [Backup and restore](./backup-restore)
- [Upgrade and rollback](./upgrade-rollback)
- [Scalability and capacity planning](../core-concepts/scalability)
- [Troubleshooting](../troubleshooting)
