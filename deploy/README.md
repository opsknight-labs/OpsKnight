# OpsKnight Deployment Artifacts

This directory is the canonical source of truth for all OpsKnight runtime deployment configurations, shared runtime sidecar images, and operational validation/drill scripts.

Application build inputs (`Dockerfile`, `Dockerfile.dev`, `docker-entrypoint.sh`) remain at the repository root, and test-only fixtures (`tests/certification/docker-compose.yml`, `.devcontainer/docker-compose.yml`) remain in their dedicated test/development scopes.

---

## Directory Layout

```text
deploy/
├── README.md                              # Canonical deployment contract & topology matrix
├── compose/                               # Docker Compose manifests and overlays
│   ├── README.md
│   ├── docker-compose.yml                 # Base integrated stack
│   ├── docker-compose.dev.yml             # Local hot-reload development stack
│   ├── docker-compose.split.yml           # Split-runtime 6-role + migration overlay
│   ├── docker-compose.pgbouncer.yml       # PgBouncer transaction-pooling overlay
│   ├── docker-compose.external-db.yml     # External/managed PostgreSQL overlay
│   └── docker-compose.pgbouncer-ca.yml    # Private/enterprise CA bundle overlay
├── swarm/                                 # Docker Swarm multi-node HA stacks & automation
│   ├── README.md
│   ├── docker-stack*.yml
│   ├── secrets.example/
│   └── scripts/
├── kubernetes/                            # Kubernetes manifests (Kustomize & Helm)
│   ├── README.md
│   ├── kustomize/
│   │   ├── base/
│   │   ├── profiles/{integrated,split,split-pgbouncer}/
│   │   └── monitoring/
│   └── helm/opsknight/
├── images/
│   └── pgbouncer/                         # Shared PgBouncer 1.26.0 dynamic image
└── scripts/
    ├── check-layout.cjs                   # CI guard enforcing canonical deploy/ tree
    ├── validate-runtime-capacity.cjs      # Connection pool capacity calculator
    └── drills/
        ├── verify-k8s-failover.sh         # Guarded Kubernetes pod-failover chaos drill
        └── verify-backup-restore.sh       # Isolated PostgreSQL backup/restore verifier
```

---

## Supported Deployment Topologies

| Platform                   | Entry Point                                                   | Integrated |     Split (6 Roles)     | PgBouncer Pooling | External PostgreSQL | Custom TLS CA |
| :------------------------- | :------------------------------------------------------------ | :--------: | :---------------------: | :---------------: | :-----------------: | :-----------: |
| **Docker Compose**         | [`deploy/compose/`](./compose/README.md)                      |     ✅     |           ✅            |        ✅         |         ✅          |      ✅       |
| **Docker Swarm**           | [`deploy/swarm/`](./swarm/README.md)                          |     ✅     | ✅ (2 replicas/role HA) |        ✅         |         ✅          |      ✅       |
| **Kubernetes (Helm)**      | [`deploy/kubernetes/helm/opsknight/`](./kubernetes/README.md) |     ✅     |           ✅            |        ✅         |         ✅          |      ✅       |
| **Kubernetes (Kustomize)** | [`deploy/kubernetes/kustomize/`](./kubernetes/README.md)      |     ✅     |           ✅            |        ✅         |         ✅          |      ✅       |

---

## Quickstart Runbook by Platform

If you are deploying directly from this repository checkout, follow the instructions for your target platform below:

### 1. Docker Compose (Local, Single-Node VM, or Staging)

- **Manifests location**: [`deploy/compose/`](./compose/README.md)
- **Integrated mode**:
  ```bash
  docker compose -f deploy/compose/docker-compose.yml up -d
  ```
- **Split Runtime + PgBouncer + External PostgreSQL**:
  ```bash
  export OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight:2.0.0
  export OPSKNIGHT_DATABASE_URL="postgresql://user:pass@db.example.com:5432/opsknight?sslmode=verify-full"
  export EXTERNAL_DB_HOST="db.example.com"
  export EXTERNAL_DB_PASSWORD="pass"
  export PGBOUNCER_ENABLED=true
  docker compose \
    -f deploy/compose/docker-compose.yml \
    -f deploy/compose/docker-compose.split.yml \
    -f deploy/compose/docker-compose.pgbouncer.yml \
    -f deploy/compose/docker-compose.external-db.yml \
    up -d
  ```

### 2. Kubernetes Helm (Production Cluster with HA)

- **Chart location**: [`deploy/kubernetes/helm/opsknight/`](./kubernetes/README.md)
- **Integrated mode with External DB & HA**:

  ```bash
  kubectl create namespace opsknight
  # Create required production secrets:
  kubectl -n opsknight create secret generic opsknight-secrets \
    --from-literal=DATABASE_URL='postgresql://opsknight:<password>@postgres.example.com:5432/opsknight?sslmode=require&connection_limit=20' \
    --from-literal=DIRECT_DATABASE_URL='postgresql://opsknight:<password>@postgres.example.com:5432/opsknight?sslmode=require&connection_limit=5' \
    --from-literal=NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
    --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
    --from-literal=PROMETHEUS_SCRAPE_TOKEN="$(openssl rand -base64 32)"

  helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
    --namespace opsknight \
    -f deploy/kubernetes/helm/opsknight/examples/values-enterprise-ha.yaml
  ```

- **Split Runtime + PgBouncer**:
  ```bash
  helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
    --namespace opsknight \
    -f deploy/kubernetes/helm/opsknight/examples/values-enterprise-ha.yaml \
    -f deploy/kubernetes/helm/opsknight/examples/values-split-runtime.yaml \
    --set pgbouncer.enabled=true
  ```

### 3. Kubernetes Kustomize

- **Manifests location**: [`deploy/kubernetes/kustomize/`](./kubernetes/README.md)
- Apply shared base and migration Job, then deploy chosen profile:
  ```bash
  kubectl apply -k deploy/kubernetes/kustomize/base
  kubectl apply -f deploy/kubernetes/kustomize/migration-job.yaml
  kubectl -n opsknight wait --for=condition=complete job/opsknight-migration --timeout=15m
  # Deploy split runtime with PgBouncer:
  kubectl apply -k deploy/kubernetes/kustomize/profiles/split-pgbouncer
  ```

### 4. Docker Swarm (Multi-Node HA Cluster)

- **Automation location**: [`deploy/swarm/`](./swarm/README.md)
- Pre-seed your environment in `deploy/swarm/.env` and execute the deployment runner:
  ```bash
  cd deploy/swarm
  ./scripts/deploy.sh
  ```

---

## Preflight & Capacity Verification

Always run the layout guard and connection capacity calculator before applying upgrades or changing worker replica counts:

```bash
# Verify no deployment files drift outside deploy/
node deploy/scripts/check-layout.cjs

# Validate PostgreSQL connection budget against role replicas and pool sizes
node deploy/scripts/validate-runtime-capacity.cjs
```
