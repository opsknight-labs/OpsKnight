# Ephemeral Kubernetes boundary

These manifests create the isolated `opsknight-docs` namespace boundary used by
documentation certification. They deliberately contain no production secrets or
cluster-wide permissions.

```sh
kubectl apply -k tests/docs/environment/kubernetes
kubectl wait --for=condition=Established namespace/opsknight-docs --timeout=60s
```

Deploy the runtime resources into this namespace, run the documentation
journeys, and remove the namespace with `scripts/docs/cleanup-kubernetes.sh`.
The cleanup script refuses any namespace except `opsknight-docs`.
