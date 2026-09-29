---
title: Configure integrated Kustomize runtime
description: Patch and validate the maintained integrated profile while preserving migration and background-ownership boundaries.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize integrated, overlay]
reader:
  status: READER_COMPLETE
  task: Configure and validate the integrated Kustomize profile.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/profiles/integrated/]
---

# Configure integrated Kustomize runtime

## Prerequisites

Read [Integrated versus split](../architecture/integrated-vs-split), complete secrets/database planning, and choose resources/replicas within the background/database budget.

## Prepare the configuration

Reference `profiles/integrated`, patch the immutable image, remove placeholder secrets, and configure public URLs, database, ingress/policy, resources, probes, HPA/PDB, and topology spread. Decide whether the HPA or GitOps owns replicas.

## Deploy integrated runtime

Render and verify no split roles. Run the external one-shot migration Job successfully, then apply the overlay and wait for Deployment rollout.

## Verify the topology

Confirm exclusive integrated ownership, readiness, queue/scheduler behavior, database connections, and an end-to-end synthetic incident. Restart one Pod and confirm recovery.

## Operate it in production

Monitor Web and background signals together. Do not scale as stateless Web; migrate to split when independent role isolation/scaling is required.

## Troubleshooting

**HPA fights Git:** remove one replica owner.

**Split roles render:** correct the base/profile reference before applying.

**Connections grow after scale:** restore planned replicas or move to split after budgeting.

## Change or undo the configuration

Promote a reviewed overlay revision. For split migration, prevent topology overlap and rerun acceptance.

## Next steps

- [Install with Kustomize](./install)
- [GitOps lifecycle](./gitops)

