---
title: External secrets with Secrets Store CSI
description: Mount externally managed secrets with AWS or Azure while preserving the Kubernetes Secret environment contract.
type: how-to
product_area: deployment
audience: [operator, administrator]
keywords: [Helm, Kubernetes, OpenShift, AWS, Azure, CSI, secrets]
verification:
  level: source
  verified_at: 2026-10-28
  evidence: [deploy/kubernetes/helm/opsknight/, tests/lib/deployment-csi.test.ts]
---

# External secrets with Secrets Store CSI

**Implementation candidate — not certified external-secrets support.** PR #931 must remain draft until the functional release gates are satisfied. See the repository record `plans/certification/external-secrets-csi.json` for scoped evidence and explicit blockers. Live legacy Kubernetes startup, CSI bootstrap/recovery, cloud identity, rotation/decryption, and OpenShift SCC checks remain pending.

The chart optionally mounts a pre-created `SecretProviderClass` into the integrated application, all seven split roles, and the migration Job. Existing deployments continue to use their existing Secret behavior with CSI disabled. The chart does not install cluster components, create a `SecretProviderClass`, enable driver rotation, or synchronize a Secret itself.

## Prerequisites and ownership

A cluster administrator must install a compatible [Secrets Store CSI driver](https://secrets-store-csi-driver.sigs.k8s.io/getting-started/installation) and provider on every eligible node. Enable the driver's Secret synchronization RBAC if using environment variables, and its rotation reconciler if required. Configure cloud identity federation, least-privilege access to specific external objects, private endpoint/DNS connectivity, and provider egress. Do not put static cloud credentials into Helm values.

The application operator creates the `SecretProviderClass` in the **same namespace** as the Helm release. Its `secretObjects` owns the synchronized Secret. Set `secrets.existingSecret` to that Secret's name, preventing Helm from rendering a competing Secret. Use the existing `secrets.keys` mappings unchanged. Never allow ESO and CSI to manage the same Secret.

```yaml
externalSecrets:
  csi:
    enabled: true
    secretProviderClass: opsknight-runtime
    mountPath: /mnt/opsknight-secrets
secrets:
  existingSecret: opsknight-runtime
```

The mount is read-only, covers the entire directory, and uses no `subPath`. To avoid masking application/system directories the schema restricts custom mount paths to a child of `/mnt/`. Configure file permissions in the provider's objects, not in the application chart. Confirm that the assigned UID/groups can read every required file, particularly on OpenShift. With the examples' `0440` permissions, an arbitrary UID without a matching owner/group cannot read the files. Verify provider/driver ownership and the SCC-assigned primary/supplemental groups on the target cluster; removing fixed IDs alone does not grant read access. Do not resolve this by granting privileged SCC or broadly readable file modes.

Synchronization starts when a Pod mounts the CSI volume; the synchronized Secret depends on mounting Pods and can disappear when the last consumer is deleted. See the [driver synchronization lifecycle](https://secrets-store-csi-driver.sigs.k8s.io/topics/sync-as-kubernetes-secret). A missing required Secret/key blocks container startup. An unavailable driver, missing class, denied provider identity, or unreachable backend leaves the mount pending; the chart does not fall back to placeholder credentials when `existingSecret` is selected.

## Workload consumption contract

- **Integrated application:** required `DATABASE_URL`, `NEXTAUTH_SECRET`, `API_KEY_SECRET`; optional `ENCRYPTION_KEY`, `ENCRYPTION_KEYS`, `SETUP_SECRET`. Supply a valid encryption key or keyring for features storing encrypted credentials. Optional metrics token remains in `metrics.scrapeTokenSecret`. CSI is mounted in the application container.
- **Split web, scheduler, general-worker, critical-worker, bulk-worker, runbook-worker, status-projector:** the same application credentials; `DIRECT_DATABASE_URL` is optional. With PgBouncer enabled, web requires `WEB_DATABASE_URL`, while workers use `DATABASE_URL`. Every role mounts CSI. Setup and metrics keep their existing role-specific references.
- **Migration Job:** required `DATABASE_URL`, `NEXTAUTH_SECRET`, `API_KEY_SECRET`; optional `DIRECT_DATABASE_URL` and encryption material. Supply the direct route when application connections use a transaction pool. CSI is mounted before the migration command runs. When CSI is enabled the Job uses the application service account, workload labels, and security contexts, including on pre-upgrade hooks.
- **Authentication cutover hook:** only inspects Kubernetes deployment/Pod state. It uses its own restricted service account and needs no application secrets or CSI access.
- **Bundled PostgreSQL:** consumes `POSTGRES_USER` and `POSTGRES_PASSWORD` from the application Secret. It does not mount CSI. Prefer an external database for the supplied cloud examples; otherwise ensure independent synchronization/bootstrap so database startup does not rely on an application Pod remaining mounted. Changing a Secret does not change the password of an existing database.
- **PgBouncer:** consumes its separate `existingAuthSecret`/`authFileKey` and optional PostgreSQL TLS Secret. It receives no application CSI mount or cloud permissions. Keep its auth Secret populated independently, for example with ESO. Reload/restart it deliberately after changing credentials.
- **Optional Kubernetes agent:** uses `agent.enrollmentToken.existingSecret` and its execution public-key Secret. It has a separate service account and receives no application CSI mount. Populate those Secrets independently. Enrollment and execution signing material must not be combined with application credentials.
- **Database TLS:** existing `postgresql.tls.existingSecret` mounts remain supported alongside CSI in application and migration containers. PgBouncer also has its existing TLS mount. These are independent Secret sources.

## AWS Secrets Manager example

Use the repository files under `deploy/kubernetes/helm/opsknight/examples/`:

1. Create a Secrets Manager JSON object named `opsknight/runtime` containing the seven keys listed in `secretproviderclass-aws.yaml`, with production values. Use stable historical encryption key IDs.
2. Follow [AWS ASCP identity and configuration guidance](https://docs.aws.amazon.com/secretsmanager/latest/userguide/integrating_ascp.html). Configure the application's service account for IRSA or the provider-supported EKS Pod Identity configuration. The sample assumes IRSA; set `serviceAccount.annotations.eks.amazonaws.com/role-arn`. Restrict the IAM role to the specific secret and required KMS key, if applicable.
3. Customize region, namespace, object identifier, and file permissions in `secretproviderclass-aws.yaml`. The JMESPath aliases must match `secretObjects.data.objectName` exactly.
4. Apply the class, then install with `values-external-secrets.yaml`, your identity configuration, a tested image, and your production application URL/network configuration.

```sh
kubectl apply -f deploy/kubernetes/helm/opsknight/examples/secretproviderclass-aws.yaml
helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  -f deploy/kubernetes/helm/opsknight/examples/values-external-secrets.yaml \
  -f production.yaml
```

Customize these files before running commands; they are examples with placeholder identifiers. The namespace must exist. If migration hooks are enabled, install the class first. When switching to a new identity on upgrade, pre-provision the account and use `serviceAccount.create=false`: pre-upgrade hooks run before Helm updates normal service-account resources.

## Azure Key Vault example

Follow [Azure Workload Identity with the CSI provider](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-identity-access). Federate the namespace/service-account subject with a managed identity, grant scoped secret-read access, and configure the supported driver token audience. Set the service-account annotation `azure.workload.identity/client-id` and the Pod label `podLabels.azure.workload.identity/use: "true"`. These labels apply to both runtime Pods and CSI-enabled migration Pods.

Customize `secretproviderclass-azure.yaml` with the vault name, tenant ID, and client ID. Create the hyphenated vault object names listed in its `objects` array. Aliases translate those names into the existing uppercase environment keys. Apply the class in the release namespace, then use the same Helm values example. The sample uses workload identity; it does not embed a client secret or install the AKS add-on.

The AWS and Azure examples are validated for YAML structure, alias/Secret-key consistency, and chart references in CI. They have not been certified against live cloud accounts by those rendering tests.

## Direct file consumption

CSI mounting is independent of `secrets.existingSecret`. You can mount files while keeping existing environment-variable credentials. For example, add a `db-ca.crt` object alias to the class (without adding it to `secretObjects`) and set the external `DATABASE_URL` to include `sslmode=verify-full&sslrootcert=/mnt/opsknight-secrets/db-ca.crt`. The application and migration Job can use the mounted CA directly. A transaction-pooled web URL and direct migration URL must include their own TLS settings. PgBouncer does not receive that mount; use its documented TLS Secret instead.

Mounting alone does not configure a file consumer. The image entrypoint supports selected `_FILE` variables, but this feature does not replace the chart's required environment-variable references or automatically map filenames into application settings. Use synchronization for core credentials. A file-only credential startup mode would require additional explicit chart and migration-command wiring.

## Rotation and controlled restarts

[Driver rotation](https://secrets-store-csi-driver.sigs.k8s.io/topics/secret-auto-rotation) updates mounted files and synchronized Secrets. Environment variables stay fixed until container restart. Startup `_FILE` loading also does not reload running processes; applications reading certificates may cache them. Validate consumer behavior or restart even when files have refreshed. Do not use `subPath` for rotating files.

For a controlled rollout, update a non-secret revision annotation in your release values:

```yaml
podAnnotations:
  secrets.opsknight.com/revision: "rotation-2026-10-28-1"
```

Deploy the values with the normal tested-image upgrade procedure. The chart uses `Recreate` for application Deployments and has an authentication cutover gate; plan the resulting downtime. This annotation changes all integrated/split Pod templates without exposing values or depending on a chart-managed Secret checksum. A namespace-scoped `kubectl rollout restart deployment/<name>` also works for each runtime Deployment when coordinated with the operational cutover procedure. Restart all seven roles in split mode and verify readiness before ending the maintenance window.

The upgrade migration hook remounts CSI but must finish before runtime replacement. Keep external object names/key sets backward compatible during upgrades. Retain old encryption keys and coordinate database password activation with the database, pooler, workers, and migration owner; a cloud Secret update alone does not rotate the database password. If the final mounting Pod is removed, verify synchronization has recreated the Secret before expecting environment consumers to start.

## OpenShift

Use `values-openshift.yaml` after the other values files as an application security profile. It removes fixed UID/GID/fsGroup values, keeps non-root execution, drops capabilities, disables privilege escalation, and requests `RuntimeDefault` seccomp. It defaults to external PostgreSQL. This is a **candidate profile**, not a certification that the container image runs with every arbitrary UID.

A cluster administrator must select a [Red Hat supported Secrets Store CSI Driver Operator/provider combination](https://docs.redhat.com/en/documentation/openshift_container_platform/4.21/html/nodes/working-with-pods), check its compatibility with the actual target OpenShift release, and install its required node-level permissions/SCCs. Do not grant the application privileged SCC or install node plugins through this chart. AWS/Azure federation and supported provider features on OpenShift must be configured for that platform; EKS/AKS examples do not establish OpenShift identity federation automatically.

Test the production image under the namespace-assigned UID range and selected SCC, including writable application/cache paths, mounted file group ownership, and migration execution. Optional agent and PgBouncer workloads need separate SCC/identity validation. Existing Kustomize profiles remain unchanged. Kustomize also provides opt-in [CSI profiles and an OpenShift component](../kustomize/external-secrets).

## Troubleshooting and live certification

Inspect `kubectl describe pod <pod> -n <namespace>` for `FailedMount`, missing Secret/key, and scheduling events. Confirm the class and Pod are in the same namespace, the class provider matches the installed provider, and driver/provider DaemonSets cover the scheduled node. Inspect `SecretProviderClassPodStatus` for mounted object versions. Check cloud audit events for identity/permission failures and provider DNS/private endpoint access. Confirm synchronization RBAC and object aliases when mounts succeed but Secret keys are absent. On OpenShift inspect Pod admission events and the selected SCC before changing security settings.

Do not print Secret contents, process environments, or decoded values into tickets/CI. Check only metadata, object versions, condition status, and presence of required keys.

Run `npx vitest run tests/lib/deployment-csi.test.ts tests/lib/deployment-secret-matrix.test.ts tests/lib/deployment-config-unit.test.ts` and `helm lint deploy/kubernetes/helm/opsknight` for local regression coverage. Existing deployment CI retains its Kustomize rendering checks. Before claiming live support, record target OpenShift/Kubernetes release, image digest, driver/provider/operator versions, identity mode, namespace SCC, and results of these staging checks:

1. Install integrated and split deployments with migration Jobs; verify mounted object versions and readiness without logging values.
2. Remove/misname the class, deny one required object permission, and interrupt provider access separately. Confirm startup stays blocked, events explain the cause, and restoring access recovers it.
3. Rotate a disposable external test secret. Observe file/object-version and synchronized Secret resource-version changes; verify the running environment remains unchanged until controlled restart, then confirm authentication and database connectivity.
4. Exercise a CA/file consumer refresh and restart if it caches the file. Coordinate a database password change with the actual database and pooler.
5. Scale all mounting consumers down, verify synchronized Secret lifecycle, then scale up and verify bootstrap. Test an upgrade where migration hooks run while previous consumers are absent.
6. Run the production image with the namespace-assigned arbitrary UID; verify file readability, writable paths, probes, migration completion, and all optional components used in that installation.

No live AWS, Azure, provider outage/rotation, or OpenShift SCC result is implied by Helm rendering tests. Track those outcomes in your environment's certification record before production release. ESO remains an alternative for independently populating `existingSecret` when direct mounts are unnecessary.
