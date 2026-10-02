---
title: Choose Swarm topology and database
description: Select integrated or split Swarm runtime, external or bundled PostgreSQL, and optional Web-only PgBouncer.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Swarm split, PostgreSQL, PgBouncer]
reader:
  status: READER_COMPLETE
  task: Configure a safe OpsKnight Swarm topology and database path.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/docker-stack.yml, deploy/swarm/docker-stack.integrated.yml, deploy/swarm/docker-stack.external-db.yml, deploy/swarm/docker-stack.pgbouncer.yml]
---

# Choose Swarm topology and database

## Prerequisites

Read [Integrated versus split](../architecture/integrated-vs-split) and [Database connections](../architecture/database-connections). Calculate role resources, desired replicas, direct pools, and PgBouncer backend capacity.

## Prepare the topology

Use default `SWARM_RUNTIME_MODE=split` for role isolation; use `integrated` only for smaller installations that accept shared ownership. The deploy script rejects unsafe mutable image use in split mode.

For production, set `EXTERNAL_DB=true` plus TLS-verified database parameters. Use bundled PostgreSQL only when its node-pinned single-replica failure model is acceptable.

Enable PgBouncer only for split Web traffic. Scheduler, workers, projector, and migration remain direct.

## Configure the deployment

Export values from a protected secret source. Pin the image digest, exact public URLs, and independent stable secrets. For external PostgreSQL set host/port/database/user/password and `verify-full`; provide a private CA PEM when needed.

## Run configuration validation

Run the capacity validator/preflight through the maintained deploy script's validation. Confirm selected stack files resolve to exactly one runtime model, direct migration, correct database source, and intended PgBouncer routing.

## Verify the configuration

Do not proceed until capacity validation passes and the rendered topology has exactly one runtime model, one direct migration path, and the intended database/pooling boundary.

## Production and security considerations

Use external HA PostgreSQL for production HA, reserve connections for operations/failover, keep database/pool ports private, and back up stable secrets separately. Swarm task rescheduling does not replicate a local database volume.

## Troubleshooting

**Split mode rejects image:** provide an explicit tested split-capable tag/digest, never `latest`.

**Bundled database cannot schedule:** apply the database node label to the durable intended node.

**External TLS fails:** correct hostname, CA file, and verify-full configuration; do not downgrade TLS.

**PgBouncer exhausts database:** reduce backend pools/replicas or increase reviewed database capacity; raising clients alone is ineffective.

## Change or undo the configuration

Topology/database changes require backup, controlled stop/cutover, migration, and acceptance. Never overlap integrated/split ownership or let bundled/external databases diverge.

## Next steps

- [Install with Swarm](./install)
- [Production checklist](./production-checklist)
