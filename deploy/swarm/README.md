# OpsKnight Docker Swarm Deployment Guide

Production-grade, declarative Docker Swarm deployment architecture for the OpsKnight incident management platform, utilizing native overlay networking, horizontal web scaling, worker lane isolation, distributed lease scheduling, and encrypted Raft secrets.

---

## 1. Architecture Overview

OpsKnight on Docker Swarm maps identical runtime contracts from Kubernetes and Docker Compose without sacrificing process isolation or connection pooling integrity:

```
                            External Load Balancer / DNS
                                         │
                         Swarm Ingress Routing Mesh (:3000)
                                         │
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
            opsknight-web (Replica 1)               opsknight-web (Replica 2+)
                     │                                       │
                     └───────────────────┬───────────────────┘
                                         ▼
                            [Optional] PgBouncer (:6432)
                                (2 Replicas, Round-Robin)
                                         │
                                         ▼
                             PostgreSQL Database (:5432)
                       (Managed Cloud RDS or Pinned Swarm Node)
                                         ▲
             ┌───────────────────────────┼───────────────────────────┐
             │                           │                           │
    opsknight-scheduler        opsknight-workers            opsknight-projector
    (2 Replicas, Lease-Fenced) (general, critical, bulk)    (Dedicated Read Projector)
```

### Connection Routing Model
- **`opsknight-web`**: Routes requests through PgBouncer (`:6432`) when enabled, or directly to PostgreSQL (`:5432`).
- **`opsknight-scheduler` & Background Workers**: Always connect **directly to PostgreSQL** (`:5432`). They bypass PgBouncer to preserve transactional semantics and maintain strict connection budget isolation.
- **Prisma Migrations (`migrate.sh`)**: Runs ephemeral migration tasks that connect **directly to PostgreSQL** (`:5432`).

### Supported Runtime Topologies

OpsKnight on Swarm supports two deployment topologies selectable via `SWARM_RUNTIME_MODE`:
1. **Split Runtime (`SWARM_RUNTIME_MODE=split`, Default)**: Enterprise architecture with separate process containers for HTTP web serving, maintenance scheduling, and dedicated worker lanes (`general`, `critical`, `bulk`).
2. **Integrated Runtime (`SWARM_RUNTIME_MODE=integrated`)**: Single-container deployment (`opsknight-app`) running web, workers, and schedulers for small-to-medium teams.

Swarm deployment uses `docker stack deploy --prune` to ensure seamless, conflict-free switching between `split` and `integrated` topologies without leaving obsolete ghost services running.

### Logical Role Breakdown (Split Topology)

| Role | Default Replicas | Placement Strategy | Update Strategy | Purpose & Isolation |
| :--- | :--- | :--- | :--- | :--- |
| **`opsknight-web`** | 2 (Scalable) | Spread across nodes (`node.id`) | `start-first` | Serves UI & API traffic, health checks, authentication. |
| **`opsknight-scheduler`** | 2 | Spread across nodes (`node.id`) | `stop-first` | Maintenance cron jobs, SLA recalculation. Fenced by DB lease. |
| **`opsknight-general-worker`** | 1 | Spread across nodes (`node.id`) | `stop-first` | Standard background queues, webhooks, non-urgent syncs. |
| **`opsknight-critical-worker`** | 1 | Spread across nodes (`node.id`) | `stop-first` | High-priority alerting, SMS, Twilio, push notifications. |
| **`opsknight-bulk-worker`** | 1 | Spread across nodes (`node.id`) | `stop-first` | Heavy digest emails, compliance rollups, audit purging. |
| **`opsknight-status-projector`** | 1 | Spread across nodes (`node.id`) | `stop-first` | Real-time incident timeline projection and public status sync. |
| **`opsknight-pgbouncer`** *(Optional)* | 2 | Spread across nodes (`node.id`) | `start-first` | Transaction connection pooler offloading PostgreSQL backend. |
| **`opsknight-db`** *(Bundled)* | 1 | Pinned: `opsknight.database == true` | `stop-first` | Single-node PostgreSQL persistence (dev/simple deploys). |

> [!IMPORTANT]
> **Bundled PostgreSQL is Single-Node Persistence**: While Docker Swarm can restart the container upon failure, local volume mounts (`opsknight-db-data`) are pinned to a specific physical node via `node.labels.opsknight.database == true`. For multi-node high availability, connect to an external managed database (AWS RDS, GCP Cloud SQL, or a Patroni HA cluster) using `docker-stack.external-db.yml`.

---

## 2. Firewall & Network Port Requirements

Ensure the following ports are open between nodes in your Docker Swarm cluster:

| Port / Protocol | Direction | Purpose | Notes |
| :--- | :--- | :--- | :--- |
| **`2377/tcp`** | Inbound / Intra-cluster | Swarm Cluster Management | Required for manager-to-manager and worker-to-manager communication. |
| **`7946/tcp + udp`** | Intra-cluster | Node Discovery & Gossip | Used by Swarm control plane for member discovery and health monitoring. |
| **`4789/udp`** | Intra-cluster | Overlay Network Data Plane | VXLAN encapsulation for cross-host overlay communication. |
| **`3000/tcp`** | Inbound from Clients / LB | OpsKnight Web Ingress | Published on the Swarm routing mesh to reach web replicas. |

> [!NOTE]
> Database (`5432`), PgBouncer (`6432`), and worker ports are attached strictly to the private external Swarm overlay network (`opsknight_network`) and **never exposed externally**.

---

## 3. Production Secrets Management & Safe Rotation

OpsKnight natively supports Docker Swarm Raft-encrypted secrets via the `*_FILE` convention in `docker-entrypoint.sh`. Production secrets are mounted into `/run/secrets/` as in-memory files rather than passed as cleartext environment variables:

| Secret Name | Container Secret Path | Environment File Variable |
| :--- | :--- | :--- |
| `<stack>_database_url_<hash>` | `/run/secrets/opsknight_database_url` | `DATABASE_URL_FILE` |
| `<stack>_direct_database_url_<hash>` | `/run/secrets/opsknight_direct_database_url` | `DIRECT_DATABASE_URL_FILE` |
| `<stack>_nextauth_secret_<hash>` | `/run/secrets/opsknight_nextauth_secret` | `NEXTAUTH_SECRET_FILE` |
| `<stack>_encryption_key_<hash>` | `/run/secrets/opsknight_encryption_key` | `ENCRYPTION_KEY_FILE` |
| `<stack>_web_database_url_<hash>` | `/run/secrets/opsknight_web_database_url` | `WEB_DATABASE_URL_FILE` |
| `<stack>_pgbouncer_userlist_<hash>` | `/run/secrets/pgbouncer_userlist` | `PGBOUNCER_AUTH_FILE` |

### Automatic Secret Rotation
`deploy.sh` automatically creates content-hashed secrets (`<stack>_<secret>_<sha256>`). When you rotate a database password, certificate, or encryption key, `deploy.sh` provisions the new versioned Raft secret and triggers a zero-downtime rolling update across your Swarm services.

### Fail-Closed Security Posture
In production (`ENVIRONMENT=production`, default), `deploy.sh` enforces `STRICT_SECRETS=true` and immediately aborts if placeholder passwords or default encryption keys are detected. For local development or quick testing, explicitly pass `ALLOW_INSECURE_SECRETS=true`.

---

## 4. Bootstrap, Migration & Deployment Lifecycle

Docker Swarm lacks Compose's `depends_on: { condition: service_completed_successfully }`. Therefore, [`deploy.sh`](./scripts/deploy.sh) orchestrates an explicit, fail-closed rollout sequence:

```
[1. Capacity Pre-flight] ──> [2. Overlay Network & Secrets] ──> [3. Database Readiness]
                                                                        │
[6. Health Verification] <── [5. Stack Convergence] <── [4. Ephemeral Migration Task]
```

1. **Capacity Pre-flight**: Evaluates replica connection limits against backend capacity (fails closed if demand exceeds pool budget).
2. **Overlay Network & Secrets**: Creates attachable overlay network and generates content-versioned Raft secrets.
3. **Database Readiness**: If bundled PostgreSQL is used, deploys `docker-stack.db.yml` and waits for `pg_isready` before proceeding.
4. **Standalone Migration**: Runs [`migrate.sh`](./scripts/migrate.sh) with `--with-registry-auth` to execute schema migrations and online index creation in an ephemeral task (`OPSKNIGHT_MIGRATION_ONLY=true`). Fails closed if migrations do not exit 0.
5. **Stack Rollout with Prune**: Deploys application services (split or integrated) using `docker stack deploy --prune` to eliminate obsolete services.
6. **Convergence & Health**: Awaits replica convergence (fails closed on timeout) and verifies cluster nodes, task states, and HTTP readiness.

### Quick Start Deployment:
```bash
# Automated deployment of split runtime stack
./deploy/swarm/scripts/deploy.sh

# Or deploy integrated runtime stack
SWARM_RUNTIME_MODE=integrated ./deploy/swarm/scripts/deploy.sh
```

---

## 5. Deployment Flavors & Overlays

### A. Core Split Stack (Bundled PostgreSQL)
```bash
./deploy/swarm/scripts/deploy.sh
```

### B. Core Split Stack + High-Availability PgBouncer
```bash
PGBOUNCER_ENABLED=true ./deploy/swarm/scripts/deploy.sh
```

### C. External Managed PostgreSQL (RDS / Cloud SQL) + PgBouncer
```bash
export EXTERNAL_DB="true"
export EXTERNAL_DB_HOST="postgres.production.internal"
export EXTERNAL_DB_PORT="5432"
export EXTERNAL_DB_USER="opsknight_admin"
export EXTERNAL_DB_PASSWORD="your_secure_db_password"
export EXTERNAL_DB_NAME="opsknight_db"
export EXTERNAL_DB_SSLMODE="verify-full"
export PGBOUNCER_ENABLED="true"

./deploy/swarm/scripts/deploy.sh
```

### D. External PostgreSQL with Enterprise Private CA
```bash
export EXTERNAL_DB="true"
export EXTERNAL_DB_HOST="postgres.production.internal"
export PGBOUNCER_ENABLED="true"
export PGBOUNCER_TLS_CA_CERT="/path/to/corporate-root-ca.crt"

./deploy/swarm/scripts/deploy.sh
```

---

## 6. Node Placement & Storage Pinning

OpsKnight uses Swarm spread preferences for high-availability application tiers and placement constraints for stateful storage:

```bash
# Pin bundled PostgreSQL to a dedicated storage node
docker node update --label-add opsknight.database=true db-node-01
```

In single-node dev environments, `deploy.sh` automatically labels the active manager node. In multi-node production clusters, `deploy.sh` fails closed with explicit labeling instructions to prevent stateful data corruption.

---

## 7. Operational Runbook

### Service Inspection
```bash
# Inspect all stack services and replica states
docker stack services opsknight

# View rolling update and task placement events
docker stack ps opsknight --no-trunc
```

### Zero-Downtime Rolling Update
```bash
# Update web tier image with automated rollback on failure
docker service update \
  --image ghcr.io/opsknight-labs/opsknight:v1.5.0 \
  --update-parallelism 1 \
  --update-delay 10s \
  --update-failure-action rollback \
  opsknight_opsknight-web
```

### Topology-Aware Service Rollback
```bash
# Automatically rolls back split or integrated services
./deploy/swarm/scripts/rollback.sh
```

### Tear Down Stack
```bash
# Remove application and database services cleanly
docker stack rm opsknight
```
