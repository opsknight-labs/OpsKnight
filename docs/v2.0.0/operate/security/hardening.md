---
title: Harden an OpsKnight deployment
description: Establish and verify identity, transport, network, secret, database, runtime, and audit security boundaries.
type: deployment
product_area: security
audience: [operator, administrator]
reader:
  status: READER_COMPLETE
  task: Harden and verify an OpsKnight production deployment across every trust boundary.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/network-security.ts
    - src/lib/encryption-key-validation.ts
    - src/lib/authorization-policy.ts
    - src/lib/audit.ts
---

# Harden an OpsKnight deployment

Hardening is a deployment property, not one application switch. Protect the public edge, internal services, identities, stored credentials, database, runtime roles, and operational evidence. Validate denied paths as deliberately as successful ones.

## Prerequisites before production exposure

Record the deployment topology, public hostnames, trusted proxy path, database location, secret store, runtime roles, administrative identities, monitoring source networks, and backup encryption/recovery owner. Use a non-production environment with the same boundary design to test changes.

Generate unique secrets for this installation. Never copy session, encryption, provider, or database credentials from examples, local development, or another environment.

## Configure and protect the external edge

1. Terminate TLS at a maintained ingress, reverse proxy, or load balancer and redirect plain HTTP to HTTPS.
2. Set the public application/authentication URLs to the canonical HTTPS origin. Avoid aliases that create unexpected callback or cookie scope.
3. Forward only required headers and strip client-supplied forwarding headers before adding trusted values.
4. Enable `TRUST_PROXY_HEADERS` only when requests always traverse controlled proxies; set `TRUSTED_PROXY_HOPS` to the real hop count.
5. Restrict request/body sizes and timeouts at both proxy and application boundaries without breaking documented webhook limits.
6. Keep administrative and operator endpoints off anonymous public paths where network segmentation is available.

Test direct-origin access as well as the public hostname. If clients can bypass the trusted proxy, forwarded identity, scheme, or address assumptions are unsafe.

## Protect sessions and authentication

- Require secure cookies in production and verify browser cookies carry the intended `Secure`, `HttpOnly`, and same-site behavior.
- Use a high-entropy authentication/session secret stored outside the image and repository.
- Configure idle, maximum-age, and update-age settings according to organizational risk.
- Prefer OIDC with MFA enforced by the identity provider for human access.
- Restrict OIDC issuer, callback, audience/client, and claim mappings to the intended tenant.
- Keep an audited break-glass administrator that is tested, protected, and not used for ordinary work.
- Disable or deprovision departed users and review active sessions after role or identity changes.

Exercise failed login, expired session, wrong tenant, disabled user, and insufficient-role paths before sign-off.

## Protect application encryption keys

`ENCRYPTION_KEY` accepts one 64-character hexadecimal key. `ENCRYPTION_KEYS` accepts a bounded keyring in `id:64-hex-key` entries separated by commas. Key identifiers may contain letters, digits, `.`, `_`, and `-` and must be unique. Do not add whitespace.

Keep key material in a secret manager or orchestrator secret, never an environment file committed to source. Back it up separately from PostgreSQL while retaining the ability to recover the matching version; restoring the database without its key material can make encrypted provider configuration unusable.

For rotation:

1. Add the new key as the active key while retaining keys needed to decrypt existing data.
2. Deploy and verify encrypted integration/provider reads and writes.
3. Re-encrypt supported targets according to the rotation procedure.
4. Remove an old key only after proving no retained record or backup that must be read depends on it.

An emergency rotation after exposure must also rotate credentials encrypted by the key where compromise may have revealed plaintext.

## Segment networks

- Expose only the web/ingress service publicly.
- Restrict PostgreSQL and PgBouncer to application and approved administration networks.
- Restrict `/api/metrics` and `/api/health/deep` to monitoring/operator access and require the scrape bearer token or administrator session as applicable.
- Keep worker, scheduler, migration, and projector roles private.
- Limit outbound traffic to required identity, notification, ticketing, webhook, and update endpoints where the platform supports egress policy.
- Deny access to instance metadata and internal address ranges from user-configured outbound integrations.

OpsKnight rejects outbound webhook URLs that resolve to private, loopback, link-local, multicast, documentation, reserved, and other restricted address ranges. DNS answers are checked as a set, redirects are not followed by the safe sender, and credential-bearing URLs are rejected. `OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS` is a test-only exception; do not set it in production.

## Harden the database

1. Use dedicated application and migration accounts where the deployment supports separation.
2. Give the runtime only the permissions it needs; reserve schema-changing privileges for the controlled migration owner.
3. Require encrypted database transport and validate the server CA when crossing an untrusted network.
4. Keep `DIRECT_DATABASE_URL` away from web traffic and transaction-mode PgBouncer; expose it only to roles that require direct PostgreSQL semantics.
5. Restrict administrative access, log privileged operations, and alert on authentication or connection anomalies.
6. Encrypt backups, restrict deletion, and run restore drills with the matching application secrets.

## Harden containers and orchestrators

- Pin application images by immutable digest and verify provenance before rollout.
- Run as the image's non-root user and prevent privilege escalation.
- Drop Linux capabilities not required by the workload; use a read-only root filesystem where validated.
- Mount secrets as controlled secrets rather than baking them into images or ConfigMaps.
- Give each runtime role the smallest ServiceAccount/RBAC permissions it needs.
- Apply network policies between ingress, web, runtime roles, PgBouncer, and PostgreSQL.
- Set CPU/memory requests and limits based on certified capacity, and preserve disruption/availability controls.
- Keep migration Jobs single-owner and short-lived.

Inspect the rendered manifests, not only values files. An intended security setting that is not present in the deployed object is not effective.

## Minimize application authorization

Use the least-privileged role and resource scope for administrators, responders, API keys, SCIM, ChatOps, and integrations. Review:

- Global versus scoped incident capabilities.
- Service/team membership and private-incident visibility.
- API-key scopes, last use, owner, expiry, and revocation.
- Slack/Teams identity links and app permissions.
- SCIM token storage and provisioning scope.
- Notification and webhook secrets.

Assignment is not an access grant. Test that a newly assigned user can view only the resources intended by policy.

## Protect inbound and outbound integrations

- Use provider signatures or the documented authentication mechanism on every inbound webhook.
- Rotate webhook/API secrets after exposure and verify both rejection of the old secret and acceptance of the new one.
- Use HTTPS provider endpoints and validate the expected host/tenant.
- Scope OAuth applications and bot permissions to documented requirements.
- Treat notification contents as potentially sensitive; send the minimum incident data appropriate for the channel.
- Alert on signature failures, rate-limit responses, repeated delivery failures, and unexpected outbound destinations.

## Logging, audit, and evidence

Ship application, ingress, orchestrator, database, and identity-provider logs to access-controlled storage with synchronized time. Retain the OpsKnight audit trail according to policy and verify administrators cannot silently modify external copies.

Do not log session cookies, bearer tokens, webhook secrets, encryption keys, database URLs, or full sensitive payloads. Validate redaction after configuration and provider errors, not only during successful requests.

## Run production acceptance

Execute the checks below from both trusted operator networks and an untrusted client path. Record the denied and successful outcomes with the deployment evidence.

## Validation checklist

Before go-live and after material security changes, prove:

1. HTTP redirects to the canonical HTTPS origin and direct-origin bypass is blocked or controlled.
2. Secure session behavior and OIDC tenant restrictions work.
3. An unauthenticated user cannot reach administration, deep health, or metrics.
4. A lower-privileged user is denied a representative cross-scope incident and administrator action.
5. Invalid webhook signatures and disallowed outbound/private URLs are rejected.
6. Database and secret-store access is restricted to intended roles.
7. Images are digest-pinned and workloads run without unnecessary privilege.
8. Audit events and security logs reach protected storage.
9. Backup restoration works with the separately stored encryption key.
10. Revoking a test API key, user session, and integration secret takes effect.

Record reviewer, date, application revision/image digest, configuration revision, result, and evidence location.

## Incident response and rotation

If a secret or administrative identity may be compromised, contain access first, preserve audit evidence, rotate at both OpsKnight and the external provider, revoke sessions/API keys, and verify denied use of the old credential. Encryption-key compromise can require rotation of the keyring plus every credential whose plaintext may have been exposed.

## Operate the hardened deployment

Review the trust-boundary inventory after every new integration, ingress, identity provider, or runtime role. Re-run denied-path tests, restore tests, audit export checks, and secret-rotation exercises on a defined schedule and after security-sensitive upgrades.

## Troubleshooting

### Login loops after enabling HTTPS

Check canonical URLs, secure-cookie settings, proxy scheme headers, trusted hop count, and OIDC redirect URI. Do not disable cookie security as a permanent workaround.

### Requests show the wrong client address or scheme

Disable proxy trust until the proxy chain is understood. Strip inbound forwarding headers at the edge, then configure the exact trusted hop count.

### A webhook to an internal service is rejected

This is the SSRF boundary working as designed. Use an approved public relay or supported integration architecture; do not add production hosts to the load-test allowlist.

### Encrypted configuration cannot be read after restore

Restore the matching encryption key/keyring version. Do not overwrite data or remove old keys while recovery is unresolved.

## Related pages

- [Authentication](../../concepts/authentication.md)
- [Permissions](../../concepts/permissions.md)
- [API keys](../../guides/administration/api-keys.md)
- [Configuration reference](../../reference/configuration/)
- [Back up and restore](../data/backup-and-restore.md)
