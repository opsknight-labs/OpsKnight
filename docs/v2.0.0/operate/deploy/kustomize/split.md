---
title: Configure split Kustomize runtime
description: Patch and validate separate OpsKnight runtime roles and optional Web-only PgBouncer with Kustomize.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize split, PgBouncer, workers]
reader:
  status: READER_COMPLETE
  task: Configure and validate the split Kustomize profile.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/profiles/split/, deploy/kubernetes/kustomize/profiles/split-pgbouncer/]
---

# Configure split Kustomize runtime

## Prerequisites

Read [Runtime roles](../architecture/runtime-roles), calculate all role resources/connections, and use a split-capable immutable image.

## Prepare the configuration

Reference `profiles/split` or `profiles/split-pgbouncer`. Patch role replicas/resources, pools, probes, graceful termination, PDBs, NetworkPolicies, and Web HPA. Direct ingress only to Web. Remove integrated ownership and placeholder secrets.

For PgBouncer, replace placeholder auth/config for the selected database. Web uses `WEB_DATABASE_URL`; migration and other roles use direct URLs. Never migrate through port `6432`.

## Deploy split runtime

Render and confirm six roles plus optional PgBouncer, with no integrated Deployment. Run the one-shot direct migration Job successfully, then apply and wait for each Deployment.

## Verify every role

Verify Web readiness, scheduler heartbeat, worker lane progress, status projection, database/PgBouncer budget, and a complete synthetic incident. Ready Pods without queue progress do not pass.

## Operate and scale in production

Alert by role/lane. Scale from oldest age, throughput, utilization, provider constraints, and connection headroom. Keep critical capacity isolated.

## Troubleshooting

**Role missing:** inspect profile reference, resource inventory, patch deletion, and GitOps prune.

**PgBouncer fails:** inspect endpoint/auth/TLS/config Secret and policy.

**Queue stalls:** inspect exact role environment, heartbeat, database/provider saturation, and lane routing.

## Change or undo the configuration

Promote one reviewed overlay revision. To return to integrated, stop split owners before starting integrated and rerun acceptance.

## Next steps

- [External PostgreSQL](./external-postgres)
- [GitOps lifecycle](./gitops)

