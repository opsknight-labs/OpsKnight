---
title: Deploy and operate OpsKnight with Helm
description: Configure, validate, install, upgrade, and recover the schema-validated OpsKnight Helm chart.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm install, values production, split runtime, PgBouncer, external PostgreSQL]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/kubernetes/helm/opsknight/Chart.yaml
    - deploy/kubernetes/helm/opsknight/values.yaml
    - deploy/kubernetes/helm/opsknight/values.schema.json
    - deploy/kubernetes/helm/opsknight/templates/
    - deploy/kubernetes/helm/opsknight/examples/
---

# Deploy and operate OpsKnight with Helm

Helm is the simplest maintained production path when a chart and schema-validated values file can be your deployment contract. The chart supports integrated or split runtime, bundled or external PostgreSQL, split-mode PgBouncer, ingress, migration hooks, disruption budgets, NetworkPolicy, autoscaling, and Prometheus Operator discovery.

Read the [Kubernetes production guide](./kubernetes) first for cluster, database, networking, proxy, disruption, and recovery requirements.

## Prerequisites

You need Helm 3, cluster-admin-approved namespace access, an ingress/TLS implementation, a StorageClass for bundled PostgreSQL, and an immutable OpsKnight 2.0 image digest. A production cluster should have enough nodes and zones for the selected replica and topology-spread policy.

```sh
helm version
kubectl version --client
kubectl auth can-i create deployment -n opsknight
kubectl auth can-i create job -n opsknight
```

## Understand the important value groups

- `runtime.mode`: `integrated` or `split`. PgBouncer requires `split`.
- `image`: repository, tag/digest, pull policy, and pull Secrets. Digest takes precedence over tag.
- `config`: public origins and common runtime settings.
- `secrets`: preferably an existing Kubernetes Secret and its key mapping.
- `migrations.job.enabled`: creates the pre-install/pre-upgrade hook Job and makes workloads skip in-process migration.
- `postgresql`: bundled PostgreSQL, storage, resources, credentials, or external TLS CA mounting.
- `database`: direct application PostgreSQL URL, port, and aggregate connection ceiling.
- `pgbouncer`: Web-only transaction pool in split mode.
- `web`, `scheduler`, and worker groups: replicas, database pools, resources, concurrency, PDB, and termination grace.
- `ingress` and `service`: public routing to Web or integrated application.
- `startupProbe`, `livenessProbe`, and `readinessProbe`: health behavior.
- `networkPolicy`: ingress namespace and database/provider egress.
- `metrics.serviceMonitor`: Prometheus Operator discovery and scrape-token Secret.

Start from checked-in defaults and examples, but keep your production values outside the chart directory so upstream chart changes remain reviewable.

## Create the runtime Secret

Use a secret manager in production. The existing Secret must contain the keys named under `secrets.keys`. A minimal integrated or split Secret is:

```sh
kubectl create namespace opsknight --dry-run=client -o yaml | kubectl apply -f -

kubectl -n opsknight create secret generic opsknight-runtime \
  --from-literal=DATABASE_URL="$DIRECT_DATABASE_URL" \
  --from-literal=WEB_DATABASE_URL="$WEB_DATABASE_URL" \
  --from-literal=NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  --from-literal=ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
```

For integrated mode, `WEB_DATABASE_URL` may equal `DATABASE_URL`. Generate `NEXTAUTH_SECRET` with `openssl rand -base64 32` and `ENCRYPTION_KEY` with `openssl rand -hex 32`. Preserve both across upgrades and restores. The chart-generated Secret stores values in the Helm release and ships placeholder defaults, so do not use it for production.

## Minimal production values: integrated mode

Create `values.production.yaml`:

```yaml
runtime:
  mode: integrated

image:
  repository: ghcr.io/opsknight-labs/opsknight
  digest: sha256:<tested-2.0.0-manifest-digest>
  pullPolicy: IfNotPresent

replicaCount: 2

secrets:
  existingSecret: opsknight-runtime

migrations:
  job:
    enabled: true

config:
  nextauthUrl: https://opsknight.example.com
  nextPublicAppUrl: https://opsknight.example.com

postgresql:
  enabled: true
  database: opsknight_db
  storage: 50Gi
  storageClass: fast-encrypted
  resources:
    requests: { cpu: 500m, memory: 1Gi }
    limits: { cpu: "2", memory: 4Gi }

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
  hosts:
    - host: opsknight.example.com
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: opsknight-tls
      hosts: [opsknight.example.com]

networkPolicy:
  enabled: true
  ingressNamespaceLabels:
    kubernetes.io/metadata.name: ingress-nginx

podDisruptionBudget:
  enabled: true
  minAvailable: 1

topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: DoNotSchedule

resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits: { cpu: "1", memory: 2Gi }
```

The bundled database is a single StatefulSet and is not database HA. Use an external managed PostgreSQL service when database host failure must be tolerated.

## Split-runtime values

Layer the checked-in example after your common production values, or declare the role settings explicitly:

```yaml
runtime:
  mode: split

image:
  digest: sha256:<tested-split-runtime-manifest-digest>

migrations:
  job:
    enabled: true

database:
  maxApplicationConnections: 120

web:
  replicaCount: 2
  database: { poolSize: 10 }
  autoscaling:
    enabled: false
    minReplicas: 2
    maxReplicas: 6

scheduler:
  replicaCount: 2
  profile: maintenance
  database: { poolSize: 3 }

generalWorker:
  replicaCount: 2
  database: { poolSize: 5 }
criticalWorker:
  replicaCount: 2
  database: { poolSize: 5 }
bulkWorker:
  replicaCount: 2
  database: { poolSize: 3 }
statusProjector:
  replicaCount: 2
  database: { poolSize: 3 }
```

Only Web has an optional HPA. Worker count changes database and provider concurrency and must be capacity-planned. The schema requires Scheduler profile `maintenance` in split mode.

## Split + PgBouncer

Add:

```yaml
runtime:
  mode: split

pgbouncer:
  enabled: true
  replicas: 2
  poolMode: transaction
  maxClientConnections: 1000
  defaultPoolSize: 10
  reservePoolSize: 5
  maxPreparedStatements: 100
  podDisruptionBudget: { enabled: true, minAvailable: 1 }

networkPolicy:
  enabled: true
```

Web uses `WEB_DATABASE_URL` through port 6432. Migration, Scheduler, workers, and Status Projector use the direct URL on the PostgreSQL port. Never put the migration hook behind transaction pooling. Budget PgBouncer server pools plus every direct role and operational headroom below the database connection limit.

If using `pgbouncer.existingAuthSecret`, supply the `userlist.txt` key selected by `authFileKey`; otherwise the chart derives authentication from the PostgreSQL values/Secret contract.

## External PostgreSQL

Disable the bundled StatefulSet and put the full direct TLS URL in the runtime Secret:

```yaml
postgresql:
  enabled: false
  host: db.example.com
  port: "5432"

database:
  url: ""
  port: 5432
  maxApplicationConnections: 120

secrets:
  existingSecret: opsknight-runtime

networkPolicy:
  enabled: true
  externalDatabaseCIDRs:
    - 10.40.0.0/24
```

When `secrets.existingSecret` is set, the Secret's `DATABASE_URL` is authoritative. Keep `database.port` and `postgresql.port` aligned with NetworkPolicy rendering. Ensure the database role can connect, create/alter required schema objects during migration, and read/write application tables.

## External PostgreSQL with private CA

Create a CA Secret:

```sh
kubectl -n opsknight create secret generic opsknight-db-ca \
  --from-file=ca.crt=/secure/path/provider-ca.crt \
  --dry-run=client -o yaml | kubectl apply -f -
```

Add:

```yaml
postgresql:
  enabled: false
  host: db.example.com
  port: "5432"
  tls:
    enabled: true
    existingSecret: opsknight-db-ca
    caKey: ca.crt
```

Use this path in `DATABASE_URL`:

```text
sslmode=verify-full&sslrootcert=/etc/opsknight-db-tls/ca.crt
```

The chart mounts the CA into migration and runtime pods. Certificate hostname verification must match the database DNS name.

## Metrics and ServiceMonitor

Create a separate token Secret:

```sh
kubectl -n opsknight create secret generic opsknight-metrics \
  --from-literal=PROMETHEUS_SCRAPE_TOKEN="$PROMETHEUS_SCRAPE_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
```

```yaml
metrics:
  enabled: true
  path: /api/metrics
  scrapeTokenSecret:
    existingSecret: opsknight-metrics
    key: PROMETHEUS_SCRAPE_TOKEN
  serviceMonitor:
    enabled: true
    interval: 30s
    scrapeTimeout: 5s
    labels:
      release: kube-prometheus-stack
```

The template fails deliberately if ServiceMonitor is enabled without an existing scrape-token Secret. Confirm the CRD exists before installation.

## Validate before installation

Run all validation against the exact production values and chart revision:

```sh
helm lint deploy/kubernetes/helm/opsknight \
  -f values.production.yaml

helm template opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  -f values.production.yaml \
  > /tmp/opsknight-rendered.yaml

kubectl apply --server-side --dry-run=server \
  -f /tmp/opsknight-rendered.yaml
```

Inspect rendered image references, public URLs, Secret references, migration Job, database resources, NetworkPolicies, Services, ingress, PDBs, and role replica counts. Rendering to a shared path may expose configuration metadata; protect and remove the file according to your operational policy.

For split mode, also run the capacity validator from the OpsKnight repository and compare role pools with `database.maxApplicationConnections`.

## Install

```sh
helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  -f values.production.yaml \
  --wait \
  --timeout 20m \
  --atomic
```

The pre-install migration hook must complete before workload resources become ready. With `--atomic`, a failed install is removed, but external database changes already committed by a migration are not reversed.

Verify:

```sh
helm status opsknight -n opsknight
helm get values opsknight -n opsknight
helm get manifest opsknight -n opsknight | grep -n 'image:'
kubectl get all,ingress,pdb -n opsknight
kubectl get events -n opsknight --sort-by=.lastTimestamp
```

The public readiness endpoint must return HTTP 200. In split mode, every selected role must be Available and queue/status processing must advance.

## Inspect migration failures

Helm hook Jobs may be deleted before the next hook run but remain available after the current failure:

```sh
kubectl get jobs,pods -n opsknight \
  -l app.kubernetes.io/component=migration
kubectl logs -n opsknight job/<migration-job-name>
kubectl describe -n opsknight job/<migration-job-name>
helm status opsknight -n opsknight
```

Check the direct URL, TLS CA, database DNS/network access, schema privileges, image compatibility, and required online indexes. Do not disable the migration Job merely to make the release proceed.

## Upgrade

1. Review release and migration notes.
2. Record current values, manifest, image digest, and Helm revision.
3. Take and verify a PostgreSQL backup.
4. Change to the new immutable digest and validate/lint/render again.
5. Review `helm diff` if that plugin is part of your controlled toolchain; otherwise compare rendered manifests.
6. Upgrade atomically and watch the migration hook and rollout.

```sh
helm history opsknight -n opsknight

helm upgrade opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  -f values.production.yaml \
  --wait \
  --timeout 20m \
  --atomic

kubectl rollout status deployment -n opsknight --timeout=15m
```

Run a synthetic incident, notification delivery, acknowledgement, resolution, and status projection, then observe a soak period.

## Rollback

Inspect revisions and render the target configuration before rollback:

```sh
helm history opsknight -n opsknight
helm rollback opsknight <revision> -n opsknight --wait --timeout 20m
```

Helm rollback restores Kubernetes resources and values; it does not reverse PostgreSQL migrations. Roll back only when the previous image is compatible with the current schema. If it is not, follow the release-specific database recovery decision rather than repeatedly restarting old pods.

## Uninstall and retained data

```sh
helm uninstall opsknight -n opsknight
```

Inventory PVCs and external database resources before uninstall. Do not delete PostgreSQL PVCs or the external database as routine cleanup. Preserve runtime and CA Secrets until recovery and retention requirements are satisfied.

## Troubleshooting

**Schema rejects values:** read the exact JSON-schema path in Helm's error. Common causes are PgBouncer outside split mode, invalid replica/pool bounds, or a non-maintenance split Scheduler profile.

**Secret key not found:** compare `secrets.keys` with `kubectl get secret opsknight-runtime -o json`. Existing Secrets must use the configured names exactly.

**ImagePullBackOff:** verify the digest exists for the node architecture and configure `imagePullSecrets` for private registries.

**Migration hook times out:** inspect the hook Job and direct database path. Increasing Helm timeout does not fix TLS, NetworkPolicy, privilege, or schema errors.

**Ingress works but login redirects incorrectly:** correct both public URL values and proxy headers/trust. Do not use the ClusterIP hostname as the public origin.

**SSE disconnects:** disable ingress response buffering and increase read/send idle timeouts.

**External database is blocked:** align database ports and CIDRs in values, then verify the CNI enforces the intended NetworkPolicy.

**Pods cannot schedule:** compare replicas/PDB/topology spread with available nodes, zones, taints, and resources.

**ServiceMonitor does not appear:** confirm the CRD exists, enable both metrics and ServiceMonitor, and supply the scrape-token Secret.

**Database connections are exhausted:** recalculate maximum Web scale, role pool sizes, surge replicas, migration, PgBouncer server pools, and operational headroom before changing values.

## Production acceptance checklist

- An immutable 2.0 digest and external production values are committed through the approved GitOps path.
- Runtime, CA, metrics, and registry Secrets are externally managed and backed up.
- Migration hook is enabled, uses direct PostgreSQL, and blocks failed releases.
- Bundled storage or external database TLS, backup, restore, and connection budgets are tested.
- Ingress, public origins, TLS, proxy trust, SSE, and webhooks work through the public hostname.
- Resources, replicas, HPA, PDB, topology spread, and NetworkPolicy match cluster capacity.
- Metrics, queue, provider, database, and role health alerts are active.
- Upgrade, schema-compatible rollback decision, node disruption, and synthetic incident tests pass.
