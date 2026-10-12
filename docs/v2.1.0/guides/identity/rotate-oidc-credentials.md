---
title: Rotate OIDC credentials and provider configuration
description: Rotate OIDC credentials and provider configuration with staged configuration, explicit verification and audited recovery.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-12
  evidence:
    - src/components/settings/AuthenticationConsole.tsx
    - src/lib/auth-control
    - tests/integration/emergency-authentication-database.test.ts
---

# Rotate OIDC credentials and provider configuration

For administrators rotating a client secret, issuer, client ID, claims or session policy.

## Prerequisites

Keep the current working provider registration and encryption key. Confirm two independent recovery identities are drilled if Required is active. Register both callback URIs on the replacement client. Sign in freshly or verify an emergency key before staging. Overlap old and new client secrets at the provider when supported.

## Rotate without replacing untested production state

1. Open **Connection** and enter the new credentials. A blank secret preserves the existing encrypted secret only when issuer and client ID match; it is never displayed.
2. Review organization/domain boundaries, scopes, role/profile mappings and session limits. Stage the revision.
3. Run a real administrator sign-in for that revision. Discovery alone cannot demonstrate that the secret works or that the administrator keeps ADMIN.
4. Preview impact and activate with the current policy version. Under Required choose Required; provider repair does not implicitly relax policy.
5. Test production sign-in in a separate session and inspect Diagnostics. Provider changes revoke old OIDC sessions through a durable issuing-policy cutoff; users sign in again.
6. Remove obsolete provider-side secrets after the successful production test and recovery verification.

Issuer migration creates a new issuer/subject binding only through verified ownership. Existing User IDs remain stable; unbound users require renewed first-link approval. Activating a provider invalidates outstanding linking approvals. Renew invitations against the new exact configuration rather than carrying approvals across trust changes.

## Rollback and failure

Select the previous revision and stage it for rollback. This makes a new immutable revision using the current production base version. Run a fresh administrator test and activate it explicitly. A previously successful test is not reusable after a production change. If the old secret is revoked at the IdP, rollback requires a valid new secret; retaining an encrypted historical secret does not restore provider-side validity.

Discovery, DNS, signature, nonce, PKCE, role or transaction failures preserve the current production provider. Secrets, tokens and private keys are excluded from Diagnostics. Emergency repairs depend on PostgreSQL and the retained encryption key. See [lockout recovery](sso-lockout-recovery/) when neither provider registration works.

## Controlled rotation checklist

Identify the current production issuer/client ID, active revision, secret expiry,
IdP application owner, and which deployments hold the encryption key. Record the
normal and administrator-test callback URLs shown in Connection. Provider-side
secret overlap is preferable when supported, but confirm its exact behavior with
your IdP administrator; the application cannot guarantee vendor overlap periods.

Choose the saved revision to populate the editable draft. Production remains
separate. A blank secret keeps that selected revision’s encrypted secret only
when issuer and client ID remain the same; changing either requires the new
secret. Field changes mark the draft unsaved, clear impact confirmation, and block
testing/activation until a new immutable revision is staged.

1. Create the replacement provider-side secret and record its expiry externally.
2. Enter it in the draft, stage discovery, and run the real administrator test.
3. Confirm role mapping retains ADMIN and the original OpsKnight User ID.
4. Preview recovery readiness/session impact and activate with fresh proof.
5. Sign in from a fresh ordinary browser and inspect token/JWKS errors and alerts.
6. After the overlap window and acceptance checks, revoke the old provider secret.

## Failure and rollback

A discovery success is not token-exchange certification. A wrong secret may only
fail at the real code callback. A provider version change invalidates the proof;
a cancelled/expired test requires a new state/nonce/PKCE ceremony. Do not paste an
ID/access token into Sample claims: that editor accepts sanitized claim examples.

Rollback stages the previous configuration as a new immutable revision. Complete
its own discovery and administrator login test before activation. It cannot revive
a provider-side revoked secret. Preserve Required while repairing through recovery;
if real SSO cannot be repaired, use the explicitly scoped recovery procedure.
