---
order: 1.5
title: Docker Swarm
description: Deploy, scale, secure, rotate secrets, and operate OpsKnight on Docker Swarm with native rolling updates and Raft secrets.
---

# Docker Swarm

OpsKnight v1.5 includes first-class deployment manifests and orchestration scripts for **Docker Swarm** under `deploy/swarm/`. Docker Swarm provides native declarative services, multi-node ingress routing mesh, rolling updates, health convergence monitoring, and encrypted Raft secrets without requiring Kubernetes complexity.

---

## Architecture Overview

Docker Swarm maps identical runtime contracts from Kubernetes and Docker Compose while preserving process isolation, connection pool safety, and database security:

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

### Connection Routing Architecture
- **Web Tier (`opsknight-web`)**: Directs HTTP user requests through PgBouncer (`:6432`) when enabled, or directly to PostgreSQL (`:5432`).
- **Background Workers & Scheduler**: Connect **directly to PostgreSQL** (`:5432`), bypassing PgBouncer to preserve strict transactional semantics and connection budget boundaries.
- **Database Migrations (`migrate.sh`)**: Runs ephemeral migration tasks that connect **directly to PostgreSQL** (`:5432`).

---

## Supported Runtime Topologies

OpsKnight on Swarm supports two runtime topologies selectable via `SWARM_RUNTIME_MODE`:

1. **Split Runtime (`SWARM_RUNTIME_MODE=split`, Default)**: Enterprise architecture with separate process containers for HTTP web serving, maintenance scheduling, and dedicated worker lanes (`general`, `critical`, `bulk`).
2. **Integrated Runtime (`SWARM_RUNTIME_MODE=integrated`)**: Single-container deployment (`opsknight-app`) running web, workers, and schedulers for small-to-medium teams.

Swarm deployment uses `docker stack deploy --prune` to ensure clean transitions between topologies without leaving obsolete ghost services running.

### Split Topology Role Breakdown

| Role | Default Replicas | Placement Strategy | Update Strategy | Purpose & Isolation |
| :--- | :--- | :--- | :--- | :--- |
| **`opsknight-web`** | 2 (Scalable) | Spread across nodes (`node.id`) | `start-first` | Serves UI & API traffic, health checks, authentication. |
| **`opsknight-scheduler`** | 2 | Spread across nodes (`node.id`) | `stop-first` | Maintenance cron jobs, SLA recalculation. Fenced by DB lease. |
| **`opsknight-general-worker`** | 2 | Spread across nodes (`node.id`) | `stop-first` | Standard background queues, webhooks, non-urgent syncs. |
| **`opsknight-critical-worker`** | 2 | Spread across nodes (`node.id`) | `stop-first` | High-priority alerting, SMS, Twilio, push notifications. |
| **`opsknight-bulk-worker`** | 2 | Spread across nodes (`node.id`) | `stop-first` | Heavy digest emails, compliance rollups, audit purging. |
| **`opsknight-status-projector`** | 2 | Spread across nodes (`node.id`) | `stop-first` | Real-time incident timeline projection and public status sync. |
| **`opsknight-pgbouncer`** *(Optional)* | 2 | Spread across nodes (`node.id`) | `start-first` | Transaction connection pooler offloading PostgreSQL backend. |
| **`opsknight-db`** *(Bundled)* | 1 | Pinned: `opsknight.database == true` | `stop-first` | Single-node PostgreSQL persistence (dev/simple deploys). |

> [!IMPORTANT]
> **Database HA Architecture Distinction**:
> - **Bundled PostgreSQL**: Provides single-node persistence locality, pinned to a labeled node (`node.labels.opsknight.database == true`). Intended for development and staging.
> - **Managed / External PostgreSQL**: For true enterprise multi-node High Availability (failover, multi-AZ replication), connect OpsKnight to an external HA database cluster (AWS Aurora/RDS, GCP Cloud SQL, or Patroni HA) using `docker-stack.external-db.yml`.

---

## Prerequisites

1. **Active Swarm Manager**: Initialize or join a Swarm cluster:
   ```bash
   docker swarm init
   ```
2. **Storage Node Labeling**: For bundled PostgreSQL deployments, pin stateful database storage to a designated node:
   ```bash
   docker node update --label-add opsknight.database=true <NODE-ID>
   ```
   *(Single-node evaluation environments automatically label the manager node).*
3. **Firewall & Ports**:
   - `2377/tcp`: Swarm cluster management.
   - `7946/tcp+udp`: Node discovery and gossip.
   - `4789/udp`: Overlay network data plane (VXLAN).
   - `3000/tcp`: External HTTP ingress routing mesh.

---

## Production Secrets & Zero-Downtime Rotation

OpsKnight consumes Raft-encrypted Swarm secrets mounted into `/run/secrets/` as in-memory files rather than cleartext environment variables:

| Secret Name Pattern | Container Secret Path | Environment File Variable |
| :--- | :--- | :--- |
| `<stack>_database_url_<hash>` | `/run/secrets/opsknight_database_url` | `DATABASE_URL_FILE` |
| `<stack>_direct_database_url_<hash>` | `/run/secrets/opsknight_direct_database_url` | `DIRECT_DATABASE_URL_FILE` |
| `<stack>_nextauth_secret_<hash>` | `/run/secrets/opsknight_nextauth_secret` | `NEXTAUTH_SECRET_FILE` |
| `<stack>_encryption_key_<hash>` | `/run/secrets/opsknight_encryption_key` | `ENCRYPTION_KEY_FILE` |
| `<stack>_web_database_url_<hash>` | `/run/secrets/opsknight_web_database_url` | `WEB_DATABASE_URL_FILE` |
| `<stack>_pgbouncer_userlist_<hash>` | `/run/secrets/pgbouncer_userlist` | `PGBOUNCER_AUTH_FILE` |

### Automatic Secret Rotation
`deploy.sh` automatically computes content hashes (`<stack>_<secret>_<sha256>`). When you update a database password, certificate, or encryption key, `deploy.sh` creates the new versioned Raft secret and triggers a zero-downtime rolling update across all services.

### Fail-Closed Production Security
In production (`ENVIRONMENT=production`, default), `deploy.sh` enforces `STRICT_SECRETS=true` and immediately aborts if placeholder passwords or default encryption keys are detected. For evaluation or local development, explicitly pass `ALLOW_INSECURE_SECRETS=true`.

---

## Deployment Flavors & Overlays

### 1. Core Split Stack (Bundled PostgreSQL)
```bash
export OPSKNIGHT_IMAGE="ghcr.io/opsknight-labs/opsknight@sha256:<tested-manifest-digest>"
export NEXTAUTH_SECRET="$(openssl rand -base64 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 32)"
export POSTGRES_PASSWORD="your_secure_db_password"

./deploy/swarm/scripts/deploy.sh
```

### 2. Core Split Stack + High-Availability PgBouncer
```bash
export OPSKNIGHT_IMAGE="ghcr.io/opsknight-labs/opsknight@sha256:<tested-manifest-digest>"
PGBOUNCER_ENABLED=true ./deploy/swarm/scripts/deploy.sh
```

### 3. External Managed PostgreSQL (AWS RDS / Cloud SQL) + PgBouncer
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

### 4. External PostgreSQL with Enterprise Private CA
Mount corporate CA certificates for strict `verify-full` TLS validation:
```bash
export EXTERNAL_DB="true"
export EXTERNAL_DB_HOST="postgres.production.internal"
export PGBOUNCER_ENABLED="true"
export PGBOUNCER_TLS_CA_CERT="/etc/ssl/certs/corporate-root-ca.crt"

./deploy/swarm/scripts/deploy.sh
```

### 5. Integrated Single-Container Topology
```bash
SWARM_RUNTIME_MODE=integrated ./deploy/swarm/scripts/deploy.sh
```

---

## Operations & Maintenance

### Service Inspection
```bash
# View services and replica status
docker stack services opsknight

# View task events and node placement
docker stack ps opsknight --no-trunc
```

### Zero-Downtime Rolling Update
```bash
# Rolling update of web service with automatic rollback on failure
docker service update \
  --image ghcr.io/opsknight-labs/opsknight:1.5.0 \
  --update-parallelism 1 \
  --update-delay 10s \
  --update-failure-action rollback \
  opsknight_opsknight-web
```

### Topology-Aware Service Rollback
Automatically detects active topology (split or integrated) and dispatches rolling rollbacks to the previous image:
```bash
./deploy/swarm/scripts/rollback.sh
```

### Health Verification
Performs fail-closed verification across cluster nodes, degraded replica counts, rejected tasks, and HTTP JSON readiness:
```bash
./deploy/swarm/scripts/health-check.sh
```

### Tear Down Stack
```bash
docker stack rm opsknight
```
