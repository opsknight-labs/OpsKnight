---
title: Deploy with Docker Swarm
description: Deploy, verify, operate, upgrade, and recover a multi-node OpsKnight installation on Docker Swarm.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Docker Swarm, Swarm HA, multi-node Docker, high availability]
reader:
  status: READER_COMPLETE
  task: Deploy, verify, operate, upgrade, and recover OpsKnight on Docker Swarm.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/docker-stack.yml, deploy/swarm/docker-stack.integrated.yml, deploy/swarm/docker-stack.pgbouncer.yml, deploy/swarm/docker-stack.external-db.yml, deploy/swarm/docker-stack.db.yml, deploy/swarm/scripts/deploy.sh, deploy/swarm/scripts/migrate.sh, deploy/swarm/scripts/health-check.sh, deploy/swarm/scripts/rollback.sh]
---

# Deploy with Docker Swarm

Use this deployment when Docker Swarm is already your production scheduler and
you want OpsKnight spread across multiple Docker hosts. The supplied deployment
orchestrator validates capacity, creates encrypted Swarm secrets, runs database
migrations, waits for every service to converge, and checks HTTP readiness.

Swarm makes application roles replaceable; it does not make every dependency
highly available. For production, use an external highly available PostgreSQL
service, an external TLS load balancer, durable backups, and at least three
Swarm manager nodes. The bundled PostgreSQL service is one replica on one
labeled node. Its volume survives task replacement on that node, but it has no
database failover and is not a production HA database.

## Choose a topology

The default `SWARM_RUNTIME_MODE=split` runs separate web, scheduler, worker, and
status-projector services. Choose it when you need independent scaling and
failure isolation. It requires an explicit image tag or digest built with
split-runtime support; the deployment script rejects `latest` in this mode.

`SWARM_RUNTIME_MODE=integrated` runs the web process and background work in one
service. It is simpler for small installations but cannot scale or isolate
notification lanes independently.

In split mode, the default service layout is:

| Service | Replicas | Update order | Responsibility |
| --- | ---: | --- | --- |
| `opsknight-web` | 2 | start first | UI, API, authentication, readiness |
| `opsknight-scheduler` | 2 | stop first | lease-fenced scheduled work and SLA evaluation |
| `opsknight-general-worker` | 2 | stop first | general queues and integrations |
| `opsknight-critical-worker` | 2 | stop first | urgent paging and notification work |
| `opsknight-bulk-worker` | 2 | stop first | bulk and maintenance work |
| `opsknight-status-projector` | 2 | stop first | incident and public-status projection |
| `opsknight-pgbouncer` | 2, optional | start first | transaction pooling for web traffic only |
| `opsknight-db` | 1, optional | stop first | bundled, node-pinned PostgreSQL |

Schedulers and workers coordinate through database leases and queue claims, so
multiple replicas do not mean every task runs twice. Do not start ad hoc
scheduler or worker processes outside the stack.

## Prerequisites

Prepare the following before the maintenance window:

- Docker Engine with Swarm mode on every node and registry access for the
  selected OpsKnight image.
- Three managers for manager-quorum tolerance and enough workers to satisfy the
  selected replicas after one worker is drained.
- A digest-pinned OpsKnight image, for example
  `ghcr.io/opsknight-labs/opsknight@sha256:<tested-digest>`.
- External PostgreSQL for production, with TLS, backups, tested restore, and a
  connection limit that covers all direct and pooled clients.
- DNS and a TLS-terminating reverse proxy or load balancer. Only port 3000 is
  published by the application stack; TLS is an infrastructure responsibility.
- Production values for the database URL, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`,
  `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL`.

Open these ports between Swarm nodes:

| Port | Scope | Purpose |
| --- | --- | --- |
| `2377/tcp` | nodes to managers | cluster management |
| `7946/tcp` and `7946/udp` | all nodes | discovery and gossip |
| `4789/udp` | all nodes | overlay-network VXLAN traffic |
| `3000/tcp` | load balancer to Swarm | OpsKnight routing-mesh ingress |

Keep PostgreSQL 5432 and PgBouncer 6432 on private networks. If you use a cloud
firewall, allow the overlay ports by node security group rather than broad
internet CIDRs.

## 1. Build the Swarm and verify quorum

On the first manager:

```bash
docker swarm init --advertise-addr <manager-private-ip>
docker swarm join-token manager
docker swarm join-token worker
```

Run the printed join command on the remaining managers and workers. Then, from
a manager, verify that every intended node is `Ready` and `Active`:

```bash
docker node ls
```

Use node names and labels that remain meaningful during an incident. If you
intend to use bundled PostgreSQL in a multi-node Swarm, select the host with the
durable volume and pin the database there:

```bash
docker node update --label-add opsknight.database=true <database-node>
```

The deploy script labels the current manager automatically only for a
single-node Swarm. In a multi-node cluster it fails until you explicitly label a
database node, unless you deliberately set `AUTO_LABEL_DATABASE_NODE=true`.

## Configuration: public URLs and secrets

Run deployments from a manager in a protected administrative session. Export
values through your CI secret store or shell without committing them:

```bash
export OPSKNIGHT_IMAGE='ghcr.io/opsknight-labs/opsknight@sha256:<tested-digest>'
export NEXTAUTH_URL='https://opsknight.example.com'
export NEXT_PUBLIC_APP_URL='https://opsknight.example.com'
export NEXTAUTH_SECRET='<high-entropy-random-value>'
export ENCRYPTION_KEY='<production-encryption-key>'
```

The deploy script turns sensitive values into content-hashed Docker secrets and
mounts them under `/run/secrets`. Application variables use the corresponding
`*_FILE` form, so the secret is not stored in the service environment. When a
secret value changes, a new versioned Raft secret is created and affected
services roll to it. Retain an old encryption key until data encrypted with it
has been migrated; rotating that key is not equivalent to rotating a password.

Production deployment is fail closed: placeholder database credentials or
default secrets stop the script. `ALLOW_INSECURE_SECRETS=true` is only for an
isolated disposable environment.

Set both public URLs to the exact browser origin, including `https` and any
non-default port. Configure the external proxy to preserve `Host`, forwarded
scheme, client IP, WebSocket upgrades, and long-lived server-sent event
responses. Disable response buffering for streaming endpoints and make the
proxy idle timeout longer than the application heartbeat interval.

## 3. Connect PostgreSQL

### Recommended: external PostgreSQL

Provide the database endpoint and enable TLS verification:

```bash
export EXTERNAL_DB=true
export EXTERNAL_DB_HOST='postgres.production.internal'
export EXTERNAL_DB_PORT='5432'
export EXTERNAL_DB_USER='opsknight'
export EXTERNAL_DB_PASSWORD='<database-password>'
export EXTERNAL_DB_NAME='opsknight'
export EXTERNAL_DB_SSLMODE='verify-full'
```

The application roles and migration task connect directly to PostgreSQL unless
PgBouncer is enabled. Use a database role that can run the shipped migrations,
then follow your platform policy if separate migration and runtime roles are
required.

For a private certificate authority, supply its PEM file:

```bash
export PGBOUNCER_TLS_CA_CERT='/secure/path/database-root-ca.crt'
```

The orchestrator creates a Swarm secret for the CA and configures direct and
pooled connections to use `/etc/ssl/certs/custom-ca.crt`. A missing file or a
certificate whose hostname does not match the database endpoint must be fixed;
do not downgrade production to `sslmode=disable`.

### Limited use: bundled PostgreSQL

Leave `EXTERNAL_DB` unset and provide strong `POSTGRES_USER`,
`POSTGRES_PASSWORD`, and `POSTGRES_DB` values. The database runs on the node
labeled `opsknight.database=true` and stores data in a local volume. A failed
task can restart on that same healthy node. Loss of that node or its disk needs
a restore; Swarm does not replicate the database volume.

## 4. Decide whether to use PgBouncer

Enable PgBouncer when web replica connection demand would otherwise consume too
many PostgreSQL backends:

```bash
export PGBOUNCER_ENABLED=true
```

The supplied pool uses transaction mode and defaults to two replicas, pool size
10, reserve pool 5, and 1,000 client connections. Only split-runtime web traffic
uses it. Schedulers, workers, the status projector, and migrations connect
directly because their transaction and lease behavior must not be hidden behind
the web pool.

Before changing replicas or pool sizes, calculate the direct connections from
every non-web role plus PgBouncer's possible backend connections and retain
headroom for migrations, administration, autovacuum, and failover. The deploy
script runs the repository capacity validator and stops when its configured
budget is unsafe. See [choose a deployment](../capacity/choose-deployment/) and
[benchmark results](../capacity/benchmark-results/) before increasing replicas.

## Deploy in a controlled sequence

From the repository root on a manager, deploy the default split topology:

```bash
./deploy/swarm/scripts/deploy.sh
```

For an integrated installation:

```bash
SWARM_RUNTIME_MODE=integrated ./deploy/swarm/scripts/deploy.sh
```

You can set `SWARM_STACK_NAME` when this cluster hosts more than one isolated
installation. The script serializes deployments for the same stack with a
host-local lock, creates an attachable overlay network, and then performs these
steps in order:

1. Confirm Docker is in active Swarm mode and the command is running on a
   manager.
2. Validate connection capacity for the selected runtime, replicas, and pool.
3. Create the overlay network and versioned Raft secrets.
4. Start and await bundled PostgreSQL when selected.
5. Create a one-shot migration service and require exit code 0.
6. Run `docker stack deploy --prune` so topology changes remove obsolete roles.
7. Wait for every desired replica to converge.
8. Probe `/api/health?mode=readiness` and fail if it is not healthy.

Do not bypass the script with a manual `docker stack deploy` during routine
operation. That skips preflight, migration ordering, secret construction, and
the final health gate.

### Database migration boundary

The one-shot container applies the shipped schema migrations and standard
online indexes before application rollout. It connects directly to PostgreSQL
and is removed when it exits. If it fails, inspect its emitted logs and fix the
database or image problem before retrying; the application rollout does not
continue.

The optional SLA scheduler index has a separate compatibility boundary. It is
optional in `LEGACY` and `SHADOW` scheduler modes and required before switching
to `INDEXED`. The normal Swarm migration task does not install that optional
index. Before setting `SLA_SCHEDULER_MODE=INDEXED`, run this command once against
the direct database from a compatible image in a controlled job:

```bash
DATABASE_URL="$DIRECT_DATABASE_URL" npm run prisma:indexes:sla-scheduler
```

Verify index creation before enabling `INDEXED` on scheduler replicas. See
[database migrations](../upgrades/database-migrations/) for the rollout and
rollback boundary.

## Verify the installation

The deploy script calls the health checker automatically. Re-run it after load
balancer or network changes:

```bash
./deploy/swarm/scripts/health-check.sh
```

It verifies node state, desired versus running replicas, rejected or failed
tasks, and the readiness endpoint. Inspect the same state manually:

```bash
docker node ls
docker stack services opsknight
docker stack ps opsknight --no-trunc
docker service logs --since 15m opsknight_opsknight-web
docker service logs --since 15m opsknight_opsknight-critical-worker
docker service logs --since 15m opsknight_opsknight-scheduler
curl --fail --silent 'https://opsknight.example.com/api/health?mode=readiness'
```

Expected result: every service shows its desired replica count, no current task
is rejected or repeatedly restarting, readiness reports healthy, sign-in works
at the public URL, and a test incident produces the expected notification.

Also verify external behavior: create an incident, acknowledge it, confirm the
timeline updates without a refresh, exercise one configured provider, and
resolve the incident. A green container alone does not prove paging delivery.

## 7. Prove node-failure behavior

Before production approval, drain one application worker at a time:

```bash
docker node update --availability drain <worker-node>
docker stack ps opsknight --no-trunc
./deploy/swarm/scripts/health-check.sh
```

Expected result: tasks move to other eligible nodes, web remains reachable,
critical notification work continues, scheduler leases transfer without
duplicate visible actions, and status projection catches up. Return the node to
service afterward:

```bash
docker node update --availability active <worker-node>
```

If replicas cannot reschedule, add capacity or correct placement constraints
before launch. Draining the sole bundled-database node is expected to make that
database unavailable; it demonstrates the bundled database's single-node
boundary and is not a valid HA configuration.

## 8. Scale and observe

Change the repository-supported replica variables and redeploy instead of
making an undocumented service change that the next stack deploy will replace.
Review database capacity every time web, scheduler, worker, projector, or
PgBouncer replicas change.

Use these commands during an incident:

```bash
docker service ps opsknight_opsknight-web --no-trunc
docker service inspect opsknight_opsknight-web --pretty
docker service logs --follow --since 10m opsknight_opsknight-web
docker events --since 30m --filter type=service
```

Look for image-pull errors, unsatisfied placement constraints, health-check
failures, database connection exhaustion, and repeated task restarts. Use the
[health center](../reliability/health-center/), [system logs](../reliability/system-logs/),
and [Prometheus metrics](../reliability/prometheus/) for application diagnosis.

## 9. Upgrade and roll back

Before an upgrade:

1. Read the target release notes and migration requirements.
2. Take and verify a PostgreSQL backup.
3. Record `docker stack services opsknight` and the current image digest.
4. Pull or mirror the new image on eligible nodes.
5. Set `OPSKNIGHT_IMAGE` to the new immutable digest and run `deploy.sh`.
6. Repeat the functional checks above and watch queue depth and provider errors.

The web service updates start-first; stateful background roles update stop-first
to reduce overlapping ownership. If the application release fails and the
database schema remains forward compatible, roll service specifications back:

```bash
./deploy/swarm/scripts/rollback.sh
```

The rollback script detects integrated or split mode, requests a Swarm rollback
for each application service, waits, and runs the health checker. It does not
reverse database migrations. Never assume an old image is safe with a newer
schema; follow [database migrations](../upgrades/database-migrations/) and the
release-specific recovery instructions.

## 10. Back up, restore, and remove

Back up PostgreSQL independently of Swarm and test restoring it into an isolated
database. For bundled PostgreSQL, include the node-local volume in host recovery
planning, but use a logical or database-native backup as the portable recovery
artifact. Follow [backup and restore](../data/backup-and-restore/) before the first
upgrade and on a recurring schedule.

Remove application services with:

```bash
docker stack rm opsknight
```

Stack removal does not automatically prove that database volumes, old
content-versioned secrets, backups, or the external overlay network are safe to
delete. Inventory each resource, confirm retention requirements, and remove it
separately only when its data is no longer needed.

## Troubleshooting

### The deployment says Swarm is inactive or this is not a manager

Run `docker info` and `docker node ls`. Initialize or join the Swarm if inactive,
and run stack operations on a manager. Do not promote an arbitrary node without
considering manager quorum.

### Split mode rejects the image

Set `OPSKNIGHT_IMAGE` to a tested split-compatible tag or immutable digest. The
script intentionally rejects missing images and `latest` because historical
monolithic images do not recognize split-runtime roles.

### A service remains at `0/N`

Run `docker service ps <service> --no-trunc`. Common causes are registry
authentication, a digest unavailable for the node architecture, insufficient
CPU or memory, a missing placement label, an unavailable secret, or failed
health checks. Correct the cause and rerun the orchestrator.

### Migration fails

Read the migration task logs printed by the script. Confirm direct database DNS,
TLS trust, credentials, privileges, free disk space, and compatible PostgreSQL
version. Do not deploy the web tier around a failed migration.

### Readiness works locally but not through DNS

Check the load balancer target, published port 3000, health-check path, TLS
certificate, public URL variables, forwarded headers, and firewall. A redirect
loop usually means the external scheme or host is not being preserved.

### Notifications pause after scaling

Check critical-worker replica state, database saturation, queue metrics,
provider credentials, and provider rate limits. Scaling web replicas does not
increase critical-worker throughput. Avoid repeatedly redeploying until the
failed lane is identified.

## Production acceptance checklist

- Every node is ready, manager quorum is healthy, and one worker can be drained
  without losing application availability.
- The deployed image is an immutable, tested digest; `latest` is not used.
- Production secrets are non-default, stored as Swarm secrets, and recoverable
  from the approved secret manager.
- External PostgreSQL uses verified TLS, has tested backups, and has adequate
  connection headroom.
- The public HTTPS origin, forwarded headers, streaming behavior, and readiness
  probe work through the real load balancer.
- All services converge, a test incident pages successfully, and duplicate work
  is not observed during a node drain.
- Upgrade and application rollback have been rehearsed, with the database
  migration compatibility boundary understood.

The historical Swarm measurements associated with PR #777 are **not certified**.
Use [benchmark results](../capacity/benchmark-results/) only within the stated
test conditions; measure your own database, network, provider, and workload
before setting production capacity.
