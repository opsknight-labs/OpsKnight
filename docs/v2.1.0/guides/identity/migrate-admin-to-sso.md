---
title: Migrate an existing administrator to SSO
description: Migrate an existing administrator to SSO with staged configuration, explicit verification and audited recovery.
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

# Migrate an existing administrator to SSO

For administrators preserving the first administrator's incident, ownership and audit history.

## Prerequisites

Keep a working administrator session and use the existing User record. Configure the exact tenant issuer, client registration and both callback URIs using [Configure OIDC](configure-oidc/). Obtain an IdP identity with a verified email matching this administrator for the first link. Check whether roles come from manual administration, OIDC or SCIM before changing mappings.

## Link and verify the original account

1. Sign in freshly, then open **Settings → System → SSO / Authentication → Connection**.
2. Enter provider credentials and mappings. Stage the configuration; production remains unchanged.
3. Select the revision and your existing administrator account. Explicitly approve the first link only after verifying ownership of the IdP identity.
4. Run **Test administrator sign-in** and authenticate at the provider. The test binds state, nonce, PKCE, browser, administrator and revision. It creates no ordinary production session.
5. Return to **Overview** and preview impact. Check that the tested account retains ADMIN. Activate **SSO Optional** using the confirmation checkbox.
6. Open a separate browser session and use the production SSO button. Confirm the existing administrator name, User ID and operational references remain intact.

A stable issuer and subject identify the external identity after linking; subsequent email changes do not transfer the account. An identity already belonging to another user is rejected. Never delete and recreate the administrator or enable email-only linking to fix a collision.

## Failures and rollback

A mismatching verified email needs an explicit review of the original record and provider claim; do not change claims merely to bypass ownership checks. Missing ADMIN claims, Entra group overage, disabled users and changed token versions invalidate the test. Re-stage after issuer/client changes and repeat the test. Optional keeps ordinary password access available while piloting. Roll back a provider through [credential rotation](rotate-oidc-credentials/), which requires a fresh test of the rollback revision.

Complete [Emergency Access](configure-emergency-access/) and [enforcement](test-and-enforce-sso/) before removing ordinary passwords.

## Verify identity ownership and administrator continuity

Record the existing administrator’s stable User ID, manual/IdP role source, team
assignments, and the intended issuer/client. Do not create a duplicate administrator
just to test SSO. Test from the acting normal administrator’s own account, or use
independent emergency recovery to search and select the existing active admin.
Administrator search is paginated and searches names/emails beyond the first page.

Approval of a first link is explicit: a signed stable subject, verified email, and
matching selected account are required. Email alone does not grant access. Existing
issuer/subject bindings, including legacy canonical issuer aliases, retain their
original owner; an identity owned by another User rejects the staged test. Resolve
ambiguous historical bindings under a documented identity incident process.

A mapped role that removes ADMIN blocks administrator activation. Entra group
overage requires resolving the provider’s claim shape; do not widen an ADMIN rule
to all authenticated users as a workaround. Confirm OIDC group assignment and SCIM
lifecycle changes separately, because they represent different authorities.

## Acceptance after activation

Sign out of the verification browser and perform a new production sign-in. Confirm
the stable User ID, expected role source, team access, and registered OIDC session.
Verify an unrelated identity with a matching unapproved email does not link itself.
For Required, a prior password session must be rejected on its next protected
request. Keep the two independent custodians available during migration.

Inspect account links using Access & provisioning search. The directory pages 25
accounts at a time; changing a search aborts superseded requests. Review diagnostics
for the activation policy version and security alert delivery. Retire the imported
legacy bridge only after two independent drill results are current.
