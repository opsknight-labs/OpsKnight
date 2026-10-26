---
title: Upgrade an existing SSO installation
description: Preserve existing SSO and administrator access with a controlled deployment cutover and repeatable migration checks.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-12
  evidence:
    - scripts/certify-sso-upgrade.cjs
    - tests/integration/sso-upgrade-database.test.ts
    - tests/deployment/sso-cutover.test.mjs
---

# Upgrade an existing SSO installation

2.1 retains the established OIDC callback, provider configuration and issuer/subject
identity bindings. A policy import reads the existing local-login flags and provider
once; subsequent policy decisions come from PostgreSQL. Preserve your encryption
keys, NextAuth secret, canonical URL, provider registration and database backup.
Changing any of those while upgrading is a separate security operation.

## Prerequisites

- Complete database backup captured immediately prior to the upgrade cutover.
- Verified persistent encryption keys (`ENCRYPTION_KEYS` and `API_KEY_SECRET`).
- Canonical public HTTPS origin configured without protocol or trailing slash drift.
- Administrator access to verify initial post-upgrade authentication and session state.

## Login behavior on import

- Local login enabled with an enabled provider becomes **SSO Optional**. Existing
  password users, including an administrator named in break-glass environment
  settings, keep ordinary password login. That designation does not turn an optional
  administrator into a recovery-only principal.
- Local login disabled becomes **SSO Required**. Existing OIDC sessions remain
  permitted when their provider version is unchanged. Ordinary password sessions
  are cut off. A configured legacy break-glass administrator uses `/login/emergency`
  rather than ordinary login, then replaces that bridge with independent password or hardware-key identities.
- A zero-user installation remains bootstrappable in **Password Only**.
- The administrator's User ID, ADMIN ownership, teams, incident history and identity
  links are preserved. Existing link approvals retain their expiry, generation,
  consumed/revoked state and provider-version binding. Import does not renew them;
  later provider activation deliberately invalidates approvals bound to old trust.

An earlier 2.1 preview may already have stored a break-glass email in Optional mode.
Its ordinary password login/session is now treated as Optional; policy import is
not repeated and environment flags do not override the existing database policy.

## Controlled Kubernetes cutover

This release requires downtime. `Recreate` avoids overlap within each Deployment;
that alone cannot coordinate every split worker or stop old pods during a
pre-upgrade migration. The Helm chart therefore has a read-only **pre-upgrade
cutover gate**, before its migration hook. It refuses to proceed until all eight
possible integrated/split application Deployment names and release-labelled
Deployment inventory have desired replicas zero
and their pending/running/terminating pods are gone. PostgreSQL and PgBouncer stay
running. Fresh installs do not run this upgrade gate.

1. Rehearse on a restored, isolated copy of the deployment. Take and verify a
   consistent pre-upgrade database backup. Record image digests, Helm values,
   encryption keys and every application's current replica count.
2. Schedule a maintenance window. Suspend GitOps reconciliation and any external
   autoscaler that could restart application Deployments. Stop new ingress and
   ingestion; drain active responders and notification/worker operations. The
   release's API, UI and ingestion are unavailable while its runtimes are stopped.
3. Scale **all application Deployments** to zero, including scheduler and every
   worker/projector in split mode. Wait for pod deletion, including terminating pods.
   Do not scale PostgreSQL, PgBouncer or independently deployed infrastructure down.
   Check the actual release names; `fullnameOverride` changes the inventory.
4. Upgrade with an explicit `image.digest` or tested `image.tag` built from this
   branch; the chart rejects an upgrade using its implicit older appVersion image.
   Use the pinned 2.1 image and unchanged secrets/URLs. The cutover hook
   needs namespace `list pods`, `list deployments` and `get` on the named application Deployments; its
   dedicated Role grants no write permission. If the API is denied/unavailable or
   old pods remain, the hook fails **before schema migration**. Inspect its retained
   Job log and correct the stop condition before retrying. Do not bypass hooks.
5. For an HPA-managed web Deployment, use `helm upgrade ... --wait=false` for this
   controlled procedure. Hooks still gate migration. Verify Helm successfully
   applied the new pod template/image, then explicitly restore the recorded desired
   replica count for the new web Deployment. Scaling it to zero deactivates ordinary
   HPA adjustment when `minReplicas > 0`; applying a new template does not reactivate
   it when the chart intentionally omits `spec.replicas`. Verify fixed-count roles also resume at their intended replica counts; restore any
   still-zero count only after verifying the new template was applied. Review
   worker lane ownership before opening traffic.
6. Wait for all new runtimes to become ready and verify their image digests. Test the
   original administrator, existing SSO user, current session, password behavior,
   linking approval and emergency recovery. Reopen traffic only after acceptance;
   resume GitOps/autoscaling with the new values and recorded replica counts.

[Kubernetes Deployment strategies](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
and [HPA maintenance behavior](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
explain the per-Deployment and scale-to-zero boundaries. The operator must keep the
release stopped between the gate and new template application; the hook does not
lock external controllers. Namespace-wide network policies must permit the hook's
TLS connection to the Kubernetes API. Its token is read-only and TLS uses the
service-account CA; application secrets are not mounted in the gate.

If a gate or migration fails, remain in maintenance and diagnose the retained Job.
Before any migration, the unchanged old runtime may be restored deliberately from
its recorded configuration. **After schema changes or new-version writes, never
resume old binaries on that database or use automatic Helm rollback as a database
rollback.** Restore the tested pre-upgrade backup and old release together, or fix
forward while stopped. In particular, old code may not understand `SECURITY`
notification values. Do not use `--atomic` as a substitute for this recovery plan.
External migration owners, Kustomize, Swarm and Compose installations must follow the same stop-all,
migrate-once, start-new sequence; Compose service recreation is not a release-wide
compatibility guarantee.

## Historical configuration and provider changes

The runtime reader retains its existing tolerant handling of historical mappings.
The console requires HTTPS issuers, supported profile keys, bounded rules/domain
lists and valid session bounds for **new staged revisions**. A historical value
outside those rules no longer makes the entire console fail: it displays a review
warning and leaves production unchanged. Uneditable historical snapshots remain in
PostgreSQL and are omitted from the editable revision selector. Stage a complete
validated replacement, including its secret when required, and perform the real
administrator test before activation. Back up historical configuration before
replacement; a snapshot outside staging rules cannot be rolled back from the
console without normalization and a new administrator proof.

Every authentication-options request checks the current provider record. Unchanged
records reuse decryption/options/validated metadata; changed records invalidate
replica-local options without waiting for a TTL. A callback captured before rotation
is rejected with a restart-sign-in message rather than reinterpreting the subject
under the new registration. First-link/JIT writes lock the policy and recheck the
registration inside their transaction. Rotation and rollback still intentionally
invalidate sessions/approvals according to their version cutoffs. Retrying sign-in
starts a new state/nonce/PKCE ceremony; never retry an old callback URL.

## Repeatable isolated upgrade evidence

`node scripts/certify-sso-upgrade.cjs` accepts only a database named
`enterprise_sso_upgrade_test`. Create that disposable database and set `DATABASE_URL`
and `DIRECT_URL` to it. The script never drops or resets a database and refuses an
already-upgraded fixture. It extracts baseline schema/migrations from commit
`097f4916a38ddcc6d1512f71b72bde36abbeb171` (override with a full
`SSO_UPGRADE_BASELINE` hash only for another reviewed 2.0 baseline), seeds existing
users/provider/links/approvals/history plus a legacy encrypted session, then applies
the branch migrations and runs the upgrade suite. Fixture encryption/JWT secrets
are generated in memory and passed only to the test subprocess.

These tests establish the migration and application boundaries on an isolated
fixture. They do not certify a customer's IdP tenant, physical recovery keys,
production ingress or Kubernetes cluster. Rehearse the same acceptance cases with
an upgraded copy of the actual deployment before production cutover.

See [Local certification and failure rehearsal](./local-certification/) for exact
released-version evidence, read/HTTP probes, the Kind cutover, database interruption
and restored-database rollback results.

## Preserve existing hardware identities when adding passwords

The additive emergency-method migration defaults every existing identity to WEBAUTHN;
existing public keys, identity IDs and session references remain intact. No ordinary
User password is copied into an emergency identity. Select PASSWORD explicitly when
creating a new independent identity, save its generated secret once and complete its
own login drill. Two passwords, two hardware identities or one of each satisfy Required
only when both identities have current origin/version-bound drills.

Apply the migrations using the same stop-all/migrate-once/start-new release procedure
above for Compose, Swarm and Kubernetes, including integrated and split runtimes.
No new application environment toggle enables passwords. Keep web replicas on the
same schema and code; workers do not serve recovery login. Rehearse recovery through
the deployment ingress during an IdP outage and after database recovery, and verify
ordinary User password login remains denied under Required. Never resume older binaries
against a database with newer authentication writes; restore the tested backup and
release together if rollback is required.
