---
title: Accept a Kubernetes deployment for production
description: Verify an OpsKnight Kubernetes installation across security, migration, runtime roles, disruption, recovery, and incident delivery.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes production checklist, acceptance, go-live]
reader:
  status: READER_COMPLETE
  task: Complete production acceptance for Kubernetes OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/, tests/docs/journeys/]
---

# Accept a Kubernetes deployment for production

## Prerequisites

Complete the selected Helm/Kustomize and integrated/split path. Configure production secrets, database, ingress/TLS, NetworkPolicy, monitoring, backup, and restore ownership.

## Prepare the acceptance record

Record cluster/namespace, package revision, values/overlay revision, image digest, topology, database class, secret version identifiers, ingress origin, test operator, and rollback owner. Never record secret values.

## Run production acceptance

1. Render manifests and confirm all images are immutable and expected.
2. Confirm no placeholder Secret and no unnecessary runtime RBAC/API token.
3. Require the migration Job to complete once over a direct database path.
4. Confirm exactly one integrated or split ownership model.
5. Confirm all selected Deployments, probes, PDBs, and spread rules match the availability plan.
6. Verify public TLS/readiness, forwarded headers, realtime streams, and signed webhooks.
7. Verify allowed NetworkPolicy paths and an intended denied path.
8. Confirm database TLS, connection headroom, backup, and an isolated restore.
9. Verify role heartbeats, queue age/throughput, provider metrics, and status projection.
10. Run a synthetic alert through notification, acknowledgement, escalation/assignment where configured, resolution, and status projection.
11. Evict or restart one application Pod and confirm continued or timely restored service.
12. Review dashboards and alerts with the operational on-call.
13. Record evidence and make an explicit go/no-go decision.

## Verify acceptance

Every applicable step requires objective evidence. Running Pods alone do not prove migration, queue progress, notifications, recovery, or public routing. Block go-live on unresolved security, data-recovery, migration, notification, or incident-processing failures.

## Operate it in production

Repeat affected checks after cluster, ingress, database, topology, identity, provider, NetworkPolicy, or release changes. Schedule restore and disruption drills, secret/certificate rotation, capacity reviews, and upgrade rehearsal.

## Troubleshooting failed acceptance

Use [Kubernetes troubleshooting](./troubleshooting). Preserve events/logs before restarting. Correct the actual layer and rerun the failed check plus every dependent check. Never remove policy, disable TLS/signatures, bypass migration, or delete PVCs just to obtain a green result.

## Change or undo the release decision

If acceptance fails after traffic begins, stop new traffic where safe, preserve data/evidence, and invoke [Rollback](../../upgrades/rollback) or [Backup and restore](../../data/backup-and-restore). Application rollback never implies schema rollback.

## Next steps

- [Health and metrics](../../reliability/health-and-metrics)
- [Upgrade](../../upgrades/upgrade)

