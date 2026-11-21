---
title: Administrator test failures
description: Why your test sign-in in Test & activate failed, how to read the claims OpsKnight received, and how to fix each cause.
type: troubleshooting
product_area: identity
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Fix a failed administrator test sign-in.
keywords: [SSO test failed, administrator test, email mismatch, group overage, provider error]
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - src/lib/auth-control/messages.ts
    - src/lib/auth-control/oidc-revisions.ts
    - src/app/auth/oidc-test-result/page.tsx
    - src/app/api/auth/oidc/test/callback/route.ts
---

# Administrator test failures

When your test sign-in in **4 · Test & activate** fails, the result page names the cause, shows
**What OpsKnight received**, and has a button that opens the step where you fix it. Production
sign-in is never changed by a test.

**What OpsKnight received** lists every claim name in the ID token and the values of the claims
OpsKnight uses: `email` (masked), `email_verified`, `hd`, `org_id`, `tid`, `groups`, `roles` and
any claim your role rules use. Tokens are never stored. Compare these with what you expected:
a missing `email`, an unexpected group name or a `false` `email_verified` usually explains the
failure at a glance.

The result is kept for 15 minutes and only in the browser that started the test.

## Causes

<a id="origin_changed"></a>

### The OpsKnight address changed during the test

Code `ORIGIN_CHANGED`. The test started on one application URL and finished on another.

**Fix:** Make sure everyone uses the same canonical URL, then run the test again. The **Review the application URL** button opens **1 · Connect provider**.

<a id="organization_rejected"></a>

### Your identity provider account is outside the allowed organization

Code `ORGANIZATION_REJECTED`. The organization ID in your sign-in does not match the one configured for OpsKnight.

**Fix:** Sign in with an account from the configured organization, or correct the organization ID. The **Check the organization ID** button opens **1 · Connect provider**.

<a id="domain_not_allowed"></a>

### Your email domain is not in the allowed domains

Code `DOMAIN_NOT_ALLOWED`. OpsKnight checked your sign-in against the allowed domains list and it did not match.

**Fix:** Add your domain to the allowed domains, or test with an account in an allowed domain. The **Edit allowed domains** button opens **2 · Who can sign in**.

<a id="email_unverified"></a>

### Your identity provider says your email is not verified

Code `EMAIL_UNVERIFIED`. Allowed domains and account linking rely on a verified email, and this sign-in reported email_verified=false or did not send it.

**Fix:** Verify the email in your identity provider, or ask it to release the email_verified claim. The **Review provider claims** button opens **1 · Connect provider**.

<a id="email_missing"></a>

### Your identity provider did not send an email address

Code `EMAIL_MISSING`. OpsKnight needs the email claim to link the test sign-in to your administrator account.

**Fix:** Release the email claim to OpsKnight. For Microsoft Entra, add the optional "email" claim to the ID token in Token configuration. The **Review provider claims** button opens **1 · Connect provider**.

<a id="email_mismatch"></a>

### The email from your identity provider does not match your OpsKnight account

Code `EMAIL_MISMATCH`. The first SSO sign-in links to your administrator account only when the verified email is identical.

**Fix:** Sign in at the identity provider with the same email as your OpsKnight account, or change your OpsKnight email in Profile first. The **Back to the test** button opens **4 · Test & activate**.

<a id="subject_missing"></a>

### The sign-in did not include a stable account identifier

Code `SUBJECT_MISSING`. Every OpenID Connect sign-in must include a "sub" claim.

**Fix:** Check the provider application type is OpenID Connect, not plain OAuth. The **Review provider settings** button opens **1 · Connect provider**.

<a id="group_claims_incomplete"></a>

### Your group claims were incomplete

Code `GROUP_CLAIMS_INCOMPLETE`. A role rule uses a claim that was missing from your sign-in, or your provider sent a "too many groups" marker instead of the list.

**Fix:** Make the provider send the claim used by your role rules. For Microsoft Entra with many groups, use App roles (the "roles" claim) or emit only groups assigned to the application. The **Review role rules** button opens **3 · Roles & teams**.

<a id="config_changed"></a>

### Single sign-on settings changed during the test

Code `CONFIG_CHANGED`. Another administrator activated a configuration while you were signing in.

**Fix:** Reload the console and run the test again. The **Run the test again** button opens **4 · Test & activate**.

<a id="admin_state_changed"></a>

### Your administrator account changed during the test

Code `ADMIN_STATE_CHANGED`. Your role, status or sessions changed between starting and finishing the test.

**Fix:** Sign in again and run the test again. The **Run the test again** button opens **4 · Test & activate**.

<a id="identity_owned_by_other_user"></a>

### This identity is already linked to another OpsKnight user

Code `IDENTITY_OWNED_BY_OTHER_USER`. The account you used at the identity provider belongs to someone else in OpsKnight.

**Fix:** Sign in at the identity provider as yourself (try a private window), then run the test again. The **Run the test again** button opens **4 · Test & activate**.

<a id="link_not_allowed"></a>

### Linking was not allowed for this test

Code `LINK_NOT_ALLOWED`. This is your first SSO sign-in, so OpsKnight needs your permission to link it to your account.

**Fix:** Tick “Allow this SSO identity to link…” and run the test again. The **Allow linking and retest** button opens **4 · Test & activate**.

<a id="role_would_drop_admin"></a>

### These role rules would remove your administrator access

Code `ROLE_WOULD_DROP_ADMIN`. After applying the role rules to your sign-in, your role would no longer be Administrator, so activation would lock you out.

**Fix:** Add a rule that grants Administrator to a group you belong to (see the claims below), or change the default role. The **Fix role rules** button opens **3 · Roles & teams**.

<a id="provider_access_denied"></a>

### Your identity provider refused the sign-in

Code `PROVIDER_ACCESS_DENIED`. Either the sign-in was cancelled, or your account is not assigned to the OpsKnight application at the identity provider.

**Fix:** Assign yourself (or your group) to the OpsKnight application, then run the test again. The **Run the test again** button opens **4 · Test & activate**.

<a id="provider_invalid_scope"></a>

### Your identity provider rejected the requested scopes

Code `PROVIDER_INVALID_SCOPE`. One of the additional scopes is not allowed for this application.

**Fix:** Remove or correct the additional scopes. The **Edit additional scopes** button opens **1 · Connect provider**.

<a id="provider_client_rejected"></a>

### Your identity provider rejected the client credentials

Code `PROVIDER_CLIENT_REJECTED`. The client ID, client secret or token authentication method does not match the provider.

**Fix:** Copy the client ID and a fresh secret from the provider, and choose the token authentication method it advertises. The **Edit client credentials** button opens **1 · Connect provider**.

<a id="provider_error"></a>

### Your identity provider returned an error

Code `PROVIDER_ERROR`. The provider ended the sign-in with an error.

**Fix:** Read the provider message below, fix it in the provider, then run the test again. The **Review provider settings** button opens **1 · Connect provider**.

<a id="token_exchange_failed"></a>

### OpsKnight could not complete the sign-in with your provider

Code `TOKEN_EXCHANGE_FAILED`. The authorization code could not be exchanged or the ID token failed validation (signature, nonce, audience or clock).

**Fix:** Check the client secret and token authentication method, both callback URLs, and that the server clock is correct. The **Edit client credentials** button opens **1 · Connect provider**.

<a id="flow_expired"></a>

### The test took too long or was opened in another browser

Code `FLOW_EXPIRED`. A test must finish in the same browser within a few minutes.

**Fix:** Run the test again and complete the provider sign-in promptly. The **Run the test again** button opens **4 · Test & activate**.

<a id="revision_deleted"></a>

### The configuration under test was deleted

Code `REVISION_DELETED`. It was removed before the sign-in completed.

**Fix:** Save your configuration again and run a new test. The **Back to the provider** button opens **1 · Connect provider**.

<a id="unknown"></a>

### The administrator test failed

Code `UNKNOWN`. OpsKnight could not verify administrator access with this configuration.

**Fix:** Check the diagnostics below and the server log, then run the test again. The **Back to the provider** button opens **1 · Connect provider**.

