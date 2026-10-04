---
title: Configure Kubernetes secrets for OpsKnight
description: Create, protect, rotate, and verify stable OpsKnight runtime secrets without storing plaintext in Git or Helm state.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes secrets, encryption key, authentication secret]
reader:
  status: READER_COMPLETE
  task: Create and validate production runtime secrets for Kubernetes.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/values.yaml, deploy/kubernetes/kustomize/base/secret.yaml]
---

# Configure Kubernetes secrets for OpsKnight

## Prerequisites

Choose a Kubernetes secret-management workflow such as an external secret controller, SOPS, or Sealed Secrets. Prepare independent `NEXTAUTH_SECRET`, `API_KEY_SECRET`, and 64-hex-character `ENCRYPTION_KEY` values plus database credentials/URLs.

## Prepare stable secrets

Generate values in a protected administration environment. Preserve them across replicas, rollouts, upgrades, and restores. Losing `ENCRYPTION_KEY` makes stored provider credentials unreadable; rotating authentication/API secrets has session or credential impact.

## Install the Secret

For a direct administrative bootstrap:

```sh
kubectl -n opsknight create secret generic opsknight-secrets \
  --from-literal=POSTGRES_USER="$POSTGRES_USER" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=NEXTAUTH_SECRET="$NEXTAUTH_SECRET" \
  --from-literal=API_KEY_SECRET="$API_KEY_SECRET" \
  --from-literal=ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
  --dry-run=client -o yaml | kubectl apply -f -
```

For split PgBouncer, include `WEB_DATABASE_URL`. Make Helm's `secrets.existingSecret` and key mappings or the Kustomize references match the created Secret. Never apply the placeholder Secret in the base.

## Verify secret references

Check key names without printing values:

```sh
kubectl -n opsknight get secret opsknight-secrets -o jsonpath='{range $k,$v := .data}{"key: "}{$k}{"\n"}{end}'
```

Render manifests and confirm every migration/runtime role references the intended Secret and key names. After rollout, verify Pods start without missing-key errors and provider credentials remain decryptable.

## Production and security considerations

Restrict Secret read access, disable automatic ServiceAccount token mounting where unnecessary, audit access, and back up stable secret material separately from PostgreSQL. Do not paste decoded values into tickets, logs, terminal recordings, or certification output.

## Troubleshooting

**Pod reports missing key:** compare the chart/overlay key mapping with the Secret's key names; do not duplicate a second Secret with divergent values.

**Provider credentials cannot decrypt after restore:** restore the original `ENCRYPTION_KEY` before retrying; changing it does not re-encrypt existing values.

**Different replicas behave differently:** confirm every workload references the same Secret revision and restart stale Pods in a controlled rollout.

## Change or rotate secrets

Classify the impact, create the new secret version, update every role atomically, roll workloads, and test authentication/API/provider behavior. Retain the prior value securely for the approved rollback window when the secret supports rollback.

## Next steps

- [Configure the database](./database)
- [Configure ingress](./ingress)
- [Production checklist](./production-checklist)

