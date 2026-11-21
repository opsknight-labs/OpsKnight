---
title: Troubleshoot OpsKnight Kustomize deployments
description: Diagnose render, patch, secret, migration, GitOps ordering, apply, prune, and rollout failures.
type: troubleshooting
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize troubleshooting, patch, GitOps]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed Kustomize or GitOps deployment.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/]
---

# Troubleshoot OpsKnight Kustomize deployments

## Before you begin

Save the Git revision, rendered manifest, controller status, resource inventory/diff, migration Job logs, Pods/events, and prior logs. Redact secrets.

```sh
kubectl kustomize deploy/kubernetes/kustomize/overlays/<environment> > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
kubectl -n opsknight get deploy,pods,jobs,pdb,hpa,networkpolicy
kubectl -n opsknight get events --sort-by=.lastTimestamp
```

Healthy output renders exactly one topology, passes server validation, completes migration, and reports ready workloads with stable GitOps sync.

## Render or patch fails

**Check:** paths, API versions, YAML types, resource name/namespace, patch target, and duplicate identity.

**Recovery:** fix the overlay rather than the rendered output.

**Verify:** render and server-side dry-run pass.

## Unsafe resources render

**Check:** placeholder Secret, mutable images, both topologies, bundled database with external configuration, broad egress, missing resources/PDBs.

**Recovery:** add targeted delete/replacement patches and CI policy gates.

**Verify:** inspect the complete rendered inventory and fields.

## Migration ordering fails

**Check:** controller wave/hook behavior, Job revision/image, direct database path, and whether Deployments reconciled early.

```sh
kubectl -n opsknight describe job opsknight-migration
kubectl -n opsknight logs job/opsknight-migration --all-containers=true
kubectl -n opsknight get deploy -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[*].image,READY:.status.readyReplicas
```

**Recovery:** pause sync, keep/return workloads to compatible revision, fix and complete migration, then resume.

**Verify:** migration completes before workload rollout.

## Secret or CA is missing

**Check:** controller ownership/health, key names, mounts, and sync dependency.

**Recovery:** reconcile the protected Secret source and restart only affected workloads after it is healthy.

**Verify:** every role uses the same intended secret version and database TLS works.

## GitOps prunes or fights resources

**Check:** multiple owners, prune inventory, HPA versus replica ownership, live edits, and resource renames.

```sh
kubectl -n opsknight diff -f /tmp/opsknight-rendered.yaml
kubectl -n opsknight get deploy -o yaml --show-managed-fields > /tmp/opsknight-live-deployments.yaml
kubectl -n opsknight get hpa,deploy -o wide
```

Repeated drift in replicas usually means HPA/GitOps field contention; recurring recreation points to duplicate inventory owners or a rename/prune mismatch.

**Recovery:** establish one owner per field/resource and restore required resources from reviewed Git.

**Verify:** controller reaches healthy sync without recurring drift.

## Next steps

- [Kubernetes troubleshooting](../kubernetes/troubleshooting)
- [GitOps lifecycle](./gitops)
