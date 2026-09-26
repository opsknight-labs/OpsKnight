# OpsKnight Docker Swarm Deployment Guide

Production-grade, declarative Docker Swarm deployment architecture for OpsKnight incident management platform, utilizing native overlay networking, horizontal web scaling, worker lane isolation, distributed lease scheduling, and encrypted Raft secrets.

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

### Supported Runtime Topologies

OpsKnight on Swarm supports two deployment topologies selectable via `SWARM_RUNTIME_MODE`:
1. **Split Runtime (`SWARM_RUNTIME_MODE=split`, Default)**: Enterprise architecture with separate process containers for HTTP web serving, maintenance scheduling, and dedicated worker lanes (`general`, `critical`, `bulk`).
2. **Integrated Runtime (`SWARM_RUNTIME_MODE=integrated`)**: Single-container deployment (`opsknight-app`) running web, workers, and schedulers for small-to-medium teams.

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
> Database (`5432`), PgBouncer (`6432`), and worker ports are attached strictly to the private external Swarm overlay network (`opsknight`) and **never exposed externally**.

---

## 3. Production Secrets Management

OpsKnight natively supports Docker Swarm Raft-encrypted secrets via the `*_FILE` convention in `docker-entrypoint.sh`. Production secrets are mounted into `/run/secrets/` as in-memory files rather than passed as cleartext environment variables:

| Secret Name | Container Secret Path | Environment File Variable |
| :--- | :--- | :--- |
| `opsknight_database_url` | `/run/secrets/opsknight_database_url` | `DATABASE_URL_FILE` |
| `opsknight_direct_database_url` | `/run/secrets/opsknight_direct_database_url` | `DIRECT_DATABASE_URL_FILE` |
| `opsknight_nextauth_secret` | `/run/secrets/opsknight_nextauth_secret` | `NEXTAUTH_SECRET_FILE` |
| `opsknight_encryption_key` | `/run/secrets/opsknight_encryption_key` | `ENCRYPTION_KEY_FILE` |
| `opsknight_web_database_url` | `/run/secrets/opsknight_web_database_url` | `WEB_DATABASE_URL_FILE` |
| `opsknight_pgbouncer_userlist` | `/run/secrets/pgbouncer_userlist` | `PGBOUNCER_AUTH_FILE` |

All stack manifests reference these as pre-created external secrets (`external: true`), ensuring deterministic secret identity between `deploy.sh` and the Swarm tasks.

Example templates are available in [deploy/swarm/secrets.example/](./secrets.example/).

---

## 4. Bootstrap, Migration & Deployment Lifecycle

Docker Swarm lacks Compose's `depends_on: { condition: service_completed_successfully }`. Therefore, [`deploy.sh`](./scripts/deploy.sh) orchestrates an explicit, fail-closed rollout sequence:

```
[1. Capacity Pre-flight] ──> [2. Overlay Network & Secrets] ──> [3. Database Readiness]
                                                                        │
[6. Health Verification] <── [5. Stack Convergence] <── [4. Ephemeral Migration Task]
```

1. **Overlay Network & Secrets**: Creates attachable overlay network `opsknight` and verifies Raft secrets.
2. **Database Readiness**: If bundled PostgreSQL is used, deploys `docker-stack.db.yml` and waits for `pg_isready` before proceeding.
3. **Standalone Migration**: Runs [`migrate.sh`](./scripts/migrate.sh) to execute schema migrations and online index creation in an ephemeral task (`OPSKNIGHT_MIGRATION_ONLY=true`). Fails closed if migrations do not exit 0.
4. **Stack Rollout**: Deploys application services (split or integrated) with `OPSKNIGHT_SKIP_MIGRATIONS=true`.
5. **Convergence & Health**: Awaits replica convergence (fails closed on timeout) and verifies cluster nodes, task states, and HTTP JSON readiness.

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
export PGBOUNCER_ENABLED="true"

./deploy/swarm/scripts/deploy.sh
```

> [!NOTE]
> `deploy.sh` automatically URL-encodes credentials, constructs `DIRECT_DATABASE_URL` and `WEB_DATABASE_URL`, writes the Raft secrets, and configures PgBouncer's userlist authentication. Alternatively, you can pre-set `OPSKNIGHT_DATABASE_URL` and `DIRECT_DATABASE_URL` directly.

---

## 6. Node Placement & Storage Pinning

OpsKnight uses Swarm spread preferences for high-availability application tiers and placement constraints for stateful storage:

```bash
# Pin bundled PostgreSQL to a dedicated storage node
docker node update --label-add opsknight.database=true db-node-01

# Optional: Label worker compute nodes
docker node update --label-add opsknight.workers=true worker-node-01
docker node update --label-add opsknight.workers=true worker-node-02
```

---

## 7. Connection Capacity Planning

Database connection budgets are validated before deployment via `scripts/validate-runtime-capacity.cjs`:

* **Core Split Stack**:
  * Web (2 × 10) = 20
  * Scheduler (2 × 3) = 6
  * General Worker (1 × 5) = 5
  * Critical Worker (1 × 5) = 5
  * Bulk Worker (1 × 3) = 3
  * Status Projector (1 × 3) = 3
  * **Total Demand: 42 connections** (Safety Headroom: 38 / 80)
* **Split Stack with PgBouncer**:
  * PgBouncer (2 replicas × [10 default + 5 reserve]) = 30 backend connections
  * Direct Workers (2×3 + 1×5 + 1×5 + 1×3 + 1×3) = 22 connections
  * **Total Demand: 52 connections** (Safety Headroom: 28 / 80)

---

## 8. Scaling Operations

Scale application tiers dynamically without taking down the cluster:

```bash
# Scale web tier to 4 replicas
docker service scale opsknight_opsknight-web=4

# Scale general workers
docker service scale opsknight_opsknight-general-worker=3
```

---

## 9. Health Verification & Rollback

### Check Status & Convergence:
```bash
./deploy/swarm/scripts/health-check.sh
```

### Rollback Application Tier:
```bash
./deploy/swarm/scripts/rollback.sh
```

> [!WARNING]
> Rolling back container images does **not** revert PostgreSQL schema changes. Schema compatibility must be verified prior to image rollbacks.
