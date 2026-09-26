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

### Logical Role Breakdown

| Role | Default Replicas | Update Strategy | Rollback Strategy | Purpose & Isolation |
| :--- | :--- | :--- | :--- | :--- |
| **`opsknight-web`** | 2 (Scalable) | `start-first` | `stop-first` | Serves UI & API traffic, health checks, authentication. |
| **`opsknight-scheduler`** | 2 | `stop-first` | `stop-first` | Maintenance cron jobs, SLA recalculation. Fenced by DB lease. |
| **`opsknight-general-worker`** | 1 | `stop-first` | `stop-first` | Standard background queues, webhooks, non-urgent syncs. |
| **`opsknight-critical-worker`** | 1 | `stop-first` | `stop-first` | High-priority alerting, SMS, Twilio, push notifications. |
| **`opsknight-bulk-worker`** | 1 | `stop-first` | `stop-first` | Heavy digest emails, compliance rollups, audit purging. |
| **`opsknight-status-projector`** | 1 | `stop-first` | `stop-first` | Real-time incident timeline projection and public status sync. |
| **`opsknight-pgbouncer`** *(Optional)* | 2 | `start-first` | `stop-first` | Transaction connection pooler offloading PostgreSQL backend. |
| **`opsknight-db`** *(Bundled)* | 1 | `stop-first` | `stop-first` | Pinned single-node PostgreSQL persistence (dev/simple deploys). |

> [!IMPORTANT]
> **Bundled PostgreSQL is NOT High Availability**: While Docker Swarm can restart the container upon failure, local volume mounts (`opsknight-db-data`) are pinned to a single physical node. For multi-node high availability, connect to an external managed database (AWS RDS, GCP Cloud SQL, or a Patroni HA cluster) using `docker-stack.external-db.yml`.

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
> Database (`5432`), PgBouncer (`6432`), and worker ports are attached strictly to the private Swarm overlay network (`opsknight`) and **never exposed externally**.

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

### Initializing Swarm Secrets:
```bash
# Generate secrets from files or strings
echo "postgresql://user:pass@host:5432/opsknight_db" | docker secret create opsknight_database_url -
echo "postgresql://user:pass@host:5432/opsknight_db" | docker secret create opsknight_direct_database_url -
openssl rand -base64 32 | docker secret create opsknight_nextauth_secret -
openssl rand -hex 32 | docker secret create opsknight_encryption_key -
```

Example templates are available in [deploy/swarm/secrets.example/](./secrets.example/).

---

## 4. Migration & Deployment Lifecycle

Docker Swarm does not support Compose's `depends_on: { condition: service_completed_successfully }`. Therefore, OpsKnight uses an explicit, sequential orchestration pipeline:

```
[1. Capacity Pre-flight] ──> [2. Ephemeral Migration Task] ──> [3. Stack Convergence] ──> [4. Health Verification]
 (validate connection pool)    (OPSKNIGHT_MIGRATION_ONLY=true)    (docker stack deploy)     (readiness probe)
```

### Full Deployment via Script:
```bash
# Run automated pre-flight, migration, rollout, and convergence
./deploy/swarm/scripts/deploy.sh
```

### Running Standalone Migration:
```bash
./deploy/swarm/scripts/migrate.sh
```

---

## 5. Deployment Flavors & Overlays

### A. Core Stack (Bundled PostgreSQL)
```bash
docker stack deploy --with-registry-auth -c deploy/swarm/docker-stack.yml opsknight
```

### B. Core Stack + High-Availability PgBouncer
```bash
docker stack deploy --with-registry-auth \
  -c deploy/swarm/docker-stack.yml \
  -c deploy/swarm/docker-stack.pgbouncer.yml \
  opsknight
```

### C. External Managed PostgreSQL (RDS / Cloud SQL) + PgBouncer
```bash
export EXTERNAL_DB_HOST="postgres.production.internal"
export EXTERNAL_DB_PORT="5432"

docker stack deploy --with-registry-auth \
  -c deploy/swarm/docker-stack.yml \
  -c deploy/swarm/docker-stack.pgbouncer.yml \
  -c deploy/swarm/docker-stack.external-db.yml \
  opsknight
```

---

## 6. Worker Placement & Node Labeling

To dedicate specific nodes for background worker execution and database pinning:

```bash
# Label worker nodes
docker node update --label-add opsknight.workers=true worker-node-01
docker node update --label-add opsknight.workers=true worker-node-02

# Label database persistence node (for bundled postgres)
docker node update --label-add opsknight.database=true db-node-01
```

---

## 7. Scaling Operations

Scale application tiers dynamically without restarting the cluster:

```bash
# Scale web tier to 4 replicas
docker service scale opsknight_opsknight-web=4

# Scale general workers
docker service scale opsknight_opsknight-general-worker=3
```

> [!CAUTION]
> **Plan Critical Worker Scaling**: Critical workers consume direct PostgreSQL connections for notification escalation. Verify available connection headroom using `node scripts/validate-runtime-capacity.cjs` before scaling critical workers.

---

## 8. Health Verification & Rollback

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
