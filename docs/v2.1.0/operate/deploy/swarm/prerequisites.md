---
title: Prepare Docker Swarm for OpsKnight
description: Validate manager quorum, node capacity, ports, images, load balancing, secrets, and database ownership before installation.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Swarm prerequisites, manager quorum, overlay network]
reader:
  status: READER_COMPLETE
  task: Prepare and validate a Docker Swarm cluster for OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/README.md, deploy/swarm/scripts/deploy.sh]
---

# Prepare Docker Swarm for OpsKnight

## Prerequisites

Provide Docker Engine on every node, registry access to a tested immutable image, three managers for quorum tolerance, enough workers for one-node loss, external DNS/TLS load balancing, and a production database/backup plan.

Allow `2377/tcp` nodes-to-managers, `7946/tcp+udp` between nodes, `4789/udp` overlay traffic, and `3000/tcp` from the load balancer. Keep PostgreSQL/PgBouncer private.

## Prepare the cluster

Initialize/join the Swarm according to Docker operations, then verify:

```sh
docker node ls
docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}'
```

Every intended node must be Ready/Active and manager quorum healthy. If using bundled PostgreSQL, label the durable database node explicitly:

```sh
docker node update --label-add opsknight.database=true <database-node>
```

## Configure prerequisites

Prepare protected deployment values for the image digest, exact public HTTPS URLs, stable authentication/encryption secrets, and database. Confirm overlay-network MTU/connectivity, registry pull on each node, node capacity/labels, and load-balancer health checks.

## Run prerequisite validation

Drain one planned worker in a staging cluster and confirm capacity remains for desired replicas. Test registry pulls, external database DNS/TLS from the Swarm network, and public DNS/TLS. Run the repository capacity validator with planned replicas/pools.

## Verify readiness to install

The cluster is ready only when quorum, node state, overlay networking, registry pulls, database/TLS, external routing, capacity, and recovery ownership all pass.

## Production and security considerations

Protect manager/Raft access, administrative sessions, and secret sources. Do not use `ALLOW_INSECURE_SECRETS=true` outside disposable environments. The bundled single-replica database has no storage failover.

## Troubleshooting

**No manager quorum:** restore quorum before deployment; do not force a new cluster without the established disaster-recovery procedure.

**Overlay traffic fails:** verify node firewalls, private addresses, MTU, and required TCP/UDP ports.

**Registry pull differs by node:** fix per-node credentials/architecture before scheduling workloads.

## Next steps

- [Choose topology and database](./topology-and-database)
- [Install with Swarm](./install)
