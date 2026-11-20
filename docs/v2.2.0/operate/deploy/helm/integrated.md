---
title: Configure integrated runtime with Helm
description: Define safe integrated Helm values for image, migration, database, ingress, resources, disruption, and validation.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm integrated, values production]
reader:
  status: READER_COMPLETE
  task: Configure and validate integrated runtime Helm values.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/values.yaml, deploy/kubernetes/helm/opsknight/templates/deployment.yaml]
---

# Configure integrated runtime with Helm

## Prerequisites

Read [Integrated versus split](../architecture/integrated-vs-split) and complete Kubernetes secret/database planning. Integrated replicas share Web and background ownership.

## Prepare the configuration

In `values.production.yaml`, set `runtime.mode: integrated`, the immutable image digest, existing Secret, migration Job, exact public URLs, database settings, resources, probes, PDB, topology spread, ingress, and NetworkPolicy. Use a replica count justified by background ownership and database budget.

The bundled database is a single StatefulSet and is not HA. Prefer external PostgreSQL when database host failure must be tolerated.

## Deploy integrated runtime

Run `helm lint`, `helm template`, and server-side dry-run from [Install](./install). Inspect that only the integrated application Deployment owns runtime work, then install with `helm upgrade --install` and wait for migration and rollout.

## Verify the topology

Confirm the migration hook succeeded, integrated Pods are Ready, no split Deployments exist, public readiness succeeds, and a synthetic incident completes notification through resolution. Observe database connections while restarting one application Pod.

## Operate it in production

Monitor request/queue/scheduler/provider/database signals together. Do not increase integrated replicas as though they were stateless Web-only Pods. Move deliberately to split mode for independent role scaling.

## Troubleshooting

**Unexpected background load after scaling:** reduce to the planned replicas or migrate to split; recalculate connections.

**Split roles also exist:** stop the conflicting rollout and restore exactly one ownership model.

**Readiness fails after migration:** inspect hook result, direct database state, secrets, and Pod logs/probes.

## Change or undo the configuration

Change values through a reviewed Helm upgrade. For split migration, back up, prevent overlapping ownership, complete the new migration boundary, and run full acceptance.

## Next steps

- [Install with Helm](./install)
- [Upgrade Helm](./upgrade)

