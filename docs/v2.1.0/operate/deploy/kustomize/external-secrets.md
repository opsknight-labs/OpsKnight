---
title: External secrets with Kustomize
description: Compose Secrets Store CSI mounts, external Secret ownership, and OpenShift application security into Kustomize deployments.
type: how-to
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize, Kubernetes, CSI, AWS, Azure, OpenShift, secrets]
verification:
  level: source
  verified_at: 2026-10-28
  evidence: [deploy/kubernetes/kustomize/, tests/lib/deployment-csi-kustomize.test.ts]
---

# External secrets with Kustomize

**Implementation candidate — not certified external-secrets support.** PR #931 must remain draft until the functional release gates are satisfied. See the repository record `plans/certification/external-secrets-csi.json` for scoped evidence and explicit blockers. Live legacy Kubernetes startup, CSI bootstrap/recovery, cloud identity, rotation/decryption, and OpenShift SCC checks remain pending.

Kustomize has opt-in CSI profiles for integrated and split runtime. They mount the same read-only secret directory as Helm, preserve the existing `opsknight-secrets` environment contract, and keep migration as a separate one-shot operation. Existing profiles continue rendering without CSI.

Cluster driver/provider installation, workload identity, synchronization permissions, rotation, failure diagnostics, and live cloud/OpenShift validation requirements are described in the [external secrets guide](../helm/external-secrets). Those prerequisites apply equally to Kustomize; Helm values do not configure Kustomize.

## Select a profile or component

- `profiles/integrated-csi`: integrated runtime with CSI; excludes the placeholder Secret and bundled PostgreSQL StatefulSet, Service, NetworkPolicy, and PDB.
- `profiles/split-csi`: the same external-database configuration with all seven runtime roles. Pin an image supporting split runtime before deployment.
- `components/secrets-store-csi`: mounts `SecretProviderClass` **`opsknight-runtime`** at **`/mnt/opsknight-secrets`** in application Deployments and an included `opsknight-migration` Job. The migration Job uses service account `opsknight-app`. This component only adds mounts; it leaves existing volumes and Secret ownership intact, allowing direct files alongside existing credentials.
- `components/external-secrets`: excludes the placeholder **`opsknight-secrets`** resource. Pair this with CSI synchronization, ESO, or another independent owner. It does not rename the Secret references or create an external controller.
- `components/openshift`: removes fixed application and migration UID/GID/fsGroup settings while retaining non-root execution, dropped capabilities, disabled privilege escalation, and `RuntimeDefault` seccomp. Validate arbitrary-UID image behavior on the target SCC. Optional agents, PgBouncer, and bundled PostgreSQL need their own platform assessment.

The CSI and OpenShift patches target application workload names and the maintained migration Job, excluding agents and PgBouncer. Keep those names when composing the components, or adjust the target expressions in an environment-owned component. Rename or prefix resources only after confirming the final render. Custom mounts/classes can be supplied through strategic merge patches on the `external-secrets` volume and mount; keep the whole directory read-only and avoid `subPath` for rotation.

## Configure AWS or Azure

Customize the existing `deploy/kubernetes/helm/opsknight/examples/secretproviderclass-aws.yaml` or `secretproviderclass-azure.yaml`; these are ordinary Kubernetes manifests usable with either packaging format.

Keep `metadata.name: opsknight-runtime`, but **change `spec.secretObjects[0].secretName` from `opsknight-runtime` to `opsknight-secrets`** for Kustomize. This distinction is required: Kustomize continues referencing `opsknight-secrets` through both `envFrom` and explicit database `secretKeyRef` entries. Set the class namespace to the workload namespace. Supply real external object identifiers and production values in the secret manager, never in the overlay.

Both runtime modes require `DATABASE_URL` and `DIRECT_DATABASE_URL` to be present. Authentication and encryption keys arrive through `envFrom`; supply `NEXTAUTH_SECRET`, `API_KEY_SECRET`, and a valid `ENCRYPTION_KEYS` keyring or legacy `ENCRYPTION_KEY`. Include `WEB_DATABASE_URL` when using PgBouncer, and `SETUP_SECRET` only when needed. The supplied CSI profiles use an external database, so the provider examples need no bundled `POSTGRES_USER`/`POSTGRES_PASSWORD` keys.

Configure AWS federation for service account **`opsknight-app`**, rather than the Helm example's `opsknight` account. Patch its `eks.amazonaws.com/role-arn` annotation when using IRSA. For Azure Workload Identity patch `azure.workload.identity/client-id` on that service account and `azure.workload.identity/use: "true"` on each runtime and migration Pod template. Pre-provision the namespace, account, and provider class before starting migration, and preserve the same identity metadata in subsequent runtime renders. Do not grant the separate agent account application secret-manager permissions.

## Create an environment-owned runtime overlay

For example, place this `kustomization.yaml` in `deploy/kubernetes/kustomize/overlays/production/`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../profiles/integrated-csi
components:
  - ../../components/openshift # Include only for the OpenShift application profile.
images:
  - name: ghcr.io/opsknight-labs/opsknight
    digest: sha256:<tested-image-digest>
```

Use `../../profiles/split-csi` for split mode. Add your production ConfigMap, ingress/TLS, resources, identity metadata, and database CIDR/port patches to this overlay. Database URLs come from the synchronized Secret; include certificate verification and direct migration routes. Existing broad network-policy examples still require production narrowing. A mounted CA can be referenced in those URLs as `/mnt/opsknight-secrets/db-ca.crt`; add that file alias to the provider class. No application reload behavior is implied by mounting it.

Render without secret values:

```sh
kubectl kustomize deploy/kubernetes/kustomize/overlays/production > rendered-runtime.yaml
```

For agents or PgBouncer, start from the corresponding existing profile and add the CSI and external-Secret components explicitly. Remove bundled database resources separately if using an external database. Populate agent enrollment/execution-key Secrets and PgBouncer's auth/TLS Secrets independently, and configure PgBouncer's external database endpoint and network policy. Application CSI does not populate those component-specific Secrets.

## Run the migration owner with CSI

The CSI runtime profiles intentionally omit migration Jobs. Create an environment-owned migration overlay, copying the maintained Job so Kustomize can load the file without disabling its normal load restrictions:

```sh
mkdir -p deploy/kubernetes/kustomize/overlays/production-migration
cp deploy/kubernetes/kustomize/migration-job.yaml \
  deploy/kubernetes/kustomize/overlays/production-migration/migration-job.yaml
```

Place this `kustomization.yaml` alongside that copy:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - migration-job.yaml
components:
  - ../../components/secrets-store-csi
  - ../../components/openshift # Include when using the OpenShift application profile.
images:
  - name: ghcr.io/opsknight-labs/opsknight
    digest: sha256:<same-tested-image-digest>
```

Add the same workload identity Pod labels as the runtime overlay. The migration component selects the already provisioned `opsknight-app` service account. The namespace, account, and provider class must exist independently of running application Pods; migration's own CSI mount can bootstrap synchronization. The Job requires `DIRECT_DATABASE_URL` in `opsknight-secrets` and maps it to both database variables. It does not need application authentication credentials for its migration-only entrypoint.

Render the migration overlay, replace the previous completed Job during a controlled release, apply the new Job, and wait for completion before applying the runtime overlay. See [migration ordering](../kustomize-operations#migration-ownership). Keep this one-shot Job outside continuously reconciled runtime manifests. If you copy it into an environment repository, reconcile future changes from the maintained source when upgrading.

## Rotation, failures, and validation

Set `spec.template.metadata.annotations.secrets.opsknight.com/revision` in your runtime Deployment patches to a new non-secret value for each controlled credential rollout. Patch every split role, not only web. Commit and reconcile that overlay revision through the normal release procedure. Environment variables and startup-loaded files require restart; file consumers may also cache certificates. Coordinate password activation with the database and PgBouncer. Preserve historical encryption key IDs. Existing `Recreate` strategy implies downtime.

CSI synchronization requires a mounting Pod and the synchronized Secret can disappear after the final mount is gone. Required retrieval/key failures must block startup. Use Pod events, mounted object versions, and provider audit metadata for diagnostics without printing values. Follow the [live certification procedure](../helm/external-secrets#troubleshooting-and-live-certification) for missing classes, denied permissions, outages, rotation, scale-to-zero/bootstrap, and arbitrary UID/SCC checks. Rendering tests do not establish live AWS, Azure, or OpenShift certification.

Run `npx vitest run tests/lib/deployment-csi-kustomize.test.ts` to check both CSI profiles, migration-only composition, OpenShift security, identity/rollout metadata, mount coexistence, agent/PgBouncer isolation, and legacy profiles. Deployment CI runs this alongside Helm CSI checks.
