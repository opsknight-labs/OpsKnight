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

| Platform | Entry Point | Integrated | Split (6 Roles) | PgBouncer Pooling | External PostgreSQL | Custom TLS CA |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Docker Compose** | [`deploy/compose/`](./compose/README.md) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Docker Swarm** | [`deploy/swarm/`](./swarm/README.md) | ✅ | ✅ (2 replicas/role HA) | ✅ | ✅ | ✅ |
| **Kubernetes (Helm)** | [`deploy/kubernetes/helm/opsknight/`](./kubernetes/README.md) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Kubernetes (Kustomize)** | [`deploy/kubernetes/kustomize/`](./kubernetes/README.md) | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Preflight & Layout Verification

Run the deployment layout guard and connection capacity calculator before deploying or opening a PR:

```bash
# Verify no deployment files exist outside deploy/
node deploy/scripts/check-layout.cjs

# Validate PostgreSQL connection budget against role replicas and pool sizes
node deploy/scripts/validate-runtime-capacity.cjs
```
