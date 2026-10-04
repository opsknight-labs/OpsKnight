---
title: Configure external PostgreSQL with Kustomize
description: Remove bundled PostgreSQL and patch secrets, TLS mounts, policy, and migration for an external database.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize external PostgreSQL, database TLS]
reader:
  status: READER_COMPLETE
  task: Configure and validate external PostgreSQL in a Kustomize overlay.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/base/postgres-statefulset.yaml, deploy/kubernetes/kustomize/profiles/split/external-database-cidr-patch.yaml]
---

# Configure external PostgreSQL with Kustomize

## Prerequisites

Provision supported TLS PostgreSQL with backup/restore, capacity, allowlists, and migration privileges. Read [Kubernetes database](../kubernetes/database).

## Prepare the overlay

Delete both bundled PostgreSQL StatefulSet and Service with targeted delete patches. Make the external secret controller supply direct URLs. Mount any private CA into migration and every runtime role and use `verify-full`/`sslrootcert`.

Patch all applicable NetworkPolicies to the actual database destination: Web, migration, workers, scheduler, projector, and PgBouncer as selected. The checked-in example is not automatically complete for every environment.

## Deploy the external path

Render and verify no bundled database resource, correct Secret/CA references, and restricted egress. Run the direct one-shot migration Job, require completion, then apply workloads.

## Verify the database

At the provider, verify TLS identity, source, connections, and migration completion. Run readiness plus a create/restart/read/update incident workflow and an isolated restore test with matching stable secrets.

## Operate it in production

Monitor availability/failover, replication, storage, connections, slow queries, certificates, backup, and maintenance. Assign explicit alert ownership.

## Troubleshooting

**Bundled database still renders:** fix delete patch resource names/namespace.

**Only some roles connect:** patch CA, Secret, and NetworkPolicy for every role, not only Web.

**Migration blocked:** correct direct DNS/TLS/auth/privileges before applying workloads.

## Change or undo external database use

Use a controlled data cutover and retained rollback source; never let bundled and external databases receive divergent writes.

## Next steps

- [Install with Kustomize](./install)
- [GitOps lifecycle](./gitops)

