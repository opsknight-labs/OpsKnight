---
title: Prepare Kubernetes for OpsKnight
description: Validate cluster access, capacity, storage, ingress, DNS, images, and external dependencies before installation.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes prerequisites, cluster, storage, ingress]
reader:
  status: READER_COMPLETE
  task: Validate a Kubernetes platform before installing OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/README.md, deploy/kubernetes/helm/opsknight/, deploy/kubernetes/kustomize/base/]
---

# Prepare Kubernetes for OpsKnight

## Prerequisites

You need a supported Kubernetes cluster, `kubectl`, namespace creation rights, a tested immutable OpsKnight image, DNS/TLS, ingress, and a database/storage plan. Use at least two schedulable worker nodes when testing application disruption. Helm installations also require Helm 3.

## Prepare the cluster

Verify access and required permissions:

```sh
kubectl version --client
helm version
kubectl auth can-i create namespace
kubectl auth can-i create deployment -n opsknight
kubectl auth can-i create statefulset -n opsknight
kubectl auth can-i create job -n opsknight
kubectl auth can-i create secret -n opsknight
```

Create the namespace idempotently:

```sh
kubectl create namespace opsknight --dry-run=client -o yaml | kubectl apply -f -
```

Confirm an ingress controller, DNS/certificate workflow, and StorageClass when using bundled PostgreSQL. Confirm outbound access to every selected identity, notification, ChatOps, Jira, and webhook provider.

## Install prerequisite configuration

Authenticate worker nodes to the image registry if required. Verify the exact digest supports the node architectures. Establish a secret-management workflow and a production PostgreSQL decision before rendering manifests.

Do not apply placeholder Secrets or a mutable `latest` image.

## Verify readiness to install

```sh
kubectl get nodes -o wide
kubectl get storageclass
kubectl get ingressclass
kubectl get namespace opsknight
```

Every intended node must be Ready, the selected storage/ingress classes must exist, and the namespace must be Active. Validate quotas and policies can admit the planned replicas, Jobs, Services, PVCs, PDBs, and NetworkPolicies.

## Production and security considerations

Use namespace/resource boundaries approved by the platform team. OpsKnight's normal runtime ServiceAccount does not need Kubernetes API access; do not grant broad RBAC. Plan disruption, zone spread, secret rotation, registry availability, monitoring, backup, and restore before installation.

## Troubleshooting

**Permission denied:** have the platform owner grant the specific missing resource verb; do not give cluster-admin to the runtime ServiceAccount.

**No suitable StorageClass:** provide an approved encrypted class or use external PostgreSQL before installation.

**Image architecture mismatch or pull denied:** validate digest manifest platforms and node registry credentials.

**Quota rejects resources:** size the deployment, request quota, and rerender before applying.

## Next steps

- [Create secrets](./secrets)
- [Choose the database](./database)
- [Choose Helm or Kustomize](./)

