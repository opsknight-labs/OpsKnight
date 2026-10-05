---
title: Diagnose OIDC sign-in and access
description: Diagnose OIDC runtime readiness, callback failures, account linking, organization policy, role mapping, SSO-only access, and stale sessions.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify OIDC sign-in and access without weakening identity controls.
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-05
  evidence:
    - src/lib/auth.ts
    - src/lib/oidc-validation.ts
    - src/lib/oidc-identity-resolution.ts
    - src/lib/oidc-linking-approval.ts
    - src/lib/oidc/role-mapping.ts
    - src/lib/local-auth-policy.ts
    - src/app/login/page.tsx
---

# Diagnose OIDC sign-in and access

Do not solve OIDC failures by widening roles, enabling email-only linking, or temporarily trusting an unverified domain. First determine which boundary failed: provider readiness, authorization callback, identity resolution, organization policy, role mapping, or the OpsKnight session.

## 1. Is the SSO option available?

Open `/login` in a private browser.

- If the SSO button appears, runtime OIDC metadata validation is currently ready.
- If the page says SSO is enabled but not configured correctly, inspect issuer validation, encrypted-secret access, and provider availability.
- If no SSO option appears, confirm the OIDC configuration is enabled and saved.

OpsKnight does not expose an OIDC provider to the login runtime merely because a database row exists. The client secret must decrypt and the provider discovery/JWKS contract must validate.

Check:

1. `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` point to the same public HTTPS origin.
2. The issuer is the exact canonical issuer returned by provider discovery.
3. The configured encryption key/keyring can decrypt the stored client secret.
4. Discovery, authorization, token, and JWKS endpoints are public HTTPS endpoints reachable from the OpsKnight web runtime.
5. The provider still exposes an RS256-compatible signing key.
6. The configured token endpoint authentication method matches provider metadata.

## 2. Test Connection succeeds but a real login fails

This usually means discovery is healthy but the application registration or user policy is wrong. **Test Connection does not perform the authorization-code exchange.**

Check:

- client ID and client secret;
- exact callback URI registration;
- provider-side application assignment;
- user consent/policy;
- required ID-token claims;
- allowed domain or organization policy;
- existing-account link approval; and
- whether the user/account is disabled.

Capture the OpsKnight request time and reason code, but do not paste ID tokens, authorization codes, client secrets, or cookies into tickets.

## 3. Interpret identity-resolution failures

The following reason codes identify the first-link/JIT boundary that rejected the sign-in:

| Reason | Meaning | Corrective action |
| --- | --- | --- |
| `OIDC_EMAIL_REQUIRED` | No linked `(issuer, sub)` exists and the provider did not supply usable email for first binding. | Correct provider claims or link through a provider flow that supplies the required first-binding identity data. |
| `OIDC_EMAIL_ASSURANCE_REQUIRED` | Email cannot be trusted for the first link/provisioning decision. | Ensure the provider asserts the required verified-email assurance; for Entra use the supported tenant-specific workforce issuer. |
| `OIDC_ORGANIZATION_REJECTED` | Provider-specific tenant/domain/organization policy failed. | Check Entra tenant, Google `hd`, Auth0 `org_id`, or verified generic/Okta email-domain policy. |
| `OIDC_AUTO_PROVISION_DISABLED` | The identity is unknown and JIT is disabled. | Pre-create/invite the user, then explicitly allow OIDC linking. |
| `OIDC_LINK_NOT_APPROVED` | An existing email account was found but no usable first-link approval exists. | In **Users**, select **Allow OIDC linking** and retry with a fresh sign-in. |
| `OIDC_LINK_APPROVAL_EXPIRED` | The first-link approval passed its 7-day lifetime. | Renew the approval and retry. |
| `OIDC_AMBIGUOUS_IDENTITY_CONFLICT` | Legacy issuer representations resolve the same subject to conflicting users. | Stop rollout and reconcile the identity records; do not guess based on email. |
| `OIDC_TARGET_NOT_OPERATIONAL` | The linked/target account is missing or disabled. | Restore the intended account state only after confirming the person should have access. |

## 4. Existing user cannot link

Open the user in **Users** and inspect the OIDC link state.

A usable approval is bound to the current provider configuration, issuer/client trust fingerprint, expected email, and configuration version. It is single-use. Security-relevant provider changes intentionally revoke or stale outstanding approvals.

If the state is expired, revoked, consumed, or stale, renew **Allow OIDC linking** under the current provider configuration. Do not delete/recreate the user and do not rely on matching email to bypass linking.

## 5. Provider-specific organization failures

### Microsoft Entra ID

Use a tenant-specific workforce issuer such as:

```text
https://login.microsoftonline.com/<tenant-id>/v2.0
```

`common`, `organizations`, and `consumers` are rejected. Confirm the user is assigned to the Enterprise Application and expected app-role/group claims are emitted.

### Google Workspace

When **Allowed Email Domains** is configured, OpsKnight authorizes Workspace membership from the signed `hd` claim. A matching email suffix alone is insufficient.

### Auth0

If **Organization ID** is configured, the signed `org_id` claim must match exactly. Allowed-domain checks can apply in addition to organization membership.

### Okta and generic OIDC

When allowed domains are configured, OpsKnight requires an exact email-domain match and `email_verified: true`. If the provider cannot securely assert verified mailbox ownership, do not use the email-domain field as an organization boundary.

## 6. Login works but the role is wrong

Check the configured claim, value, type, case, rule order, and the user's `roleSource`.

Role mapping is exact and first-match-wins. Claims may be a string or string array. If no rule matches, an OIDC-managed role falls back to `USER`; a manual role is not silently replaced merely because no mapping matched.

For Microsoft Entra group mappings, inspect group overage. When Entra signals that the complete groups claim was omitted, OpsKnight does not grant a mapped elevated role from missing group data.

After correcting a mapping, complete a fresh OIDC sign-in. Role changes update the user's security state so stale authorization should not remain active.

## 7. Profile mapping does not update

Confirm the configured department, job-title, or avatar claim exists as a string in the signed profile. Department and job-title values are bounded before storage. Avatar values must be HTTPS URLs, and a local uploaded avatar is not overwritten by OIDC mapping.

Profile mapping does not control identity ownership. A changed email/name/profile claim does not change the linked `(issuer, sub)`.

## 8. Session is cleared after login or after a configuration change

OpsKnight can end an OIDC session when:

- the OIDC configuration version changed;
- the user's token/security version changed;
- the user was disabled or can no longer be resolved;
- idle timeout was reached;
- the reauthentication window was reached; or
- a required security lookup failed closed.

A security-relevant OIDC configuration change intentionally forces reauthentication. If the new sign-in succeeds, the sign-out was expected.

## 9. SSO-only or break-glass behavior is wrong

For SSO-enforced deployments, verify the effective environment on **every** web/integrated replica:

```env
AUTH_LOCAL_LOGIN_ENABLED=false
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=emergency-admin@example.com
```

If a normal user's password still works, at least one serving process is likely running with local login enabled or stale deployment configuration.

If break-glass does not work, confirm the exact email, active account state, existing password, and that break-glass is enabled. Password recovery is disabled while normal local login is disabled, so the emergency credential must be prepared beforehand.

OpsKnight never automatically enables password fallback during an IdP outage.

## 10. Provider outage or discovery failure

Known-good runtime metadata is cached and can be served stale for a bounded period while OpsKnight revalidates in the background. This reduces discovery-path latency and tolerates short metadata outages.

New OIDC authentication still requires the provider's authorization/token path to function. If the IdP itself is unavailable, normal SSO users cannot authenticate. Use the tested break-glass administrator rather than weakening the global authentication policy.

## 11. Logout appears incomplete

OpsKnight ends the local session first. If the validated provider metadata advertises an `end_session_endpoint`, OpsKnight then attempts provider logout.

If a user signs in again without a password prompt, the IdP may still have an active browser SSO session. That does not mean the previous OpsKnight session remained valid.

## Verification after a fix

Test with separate accounts rather than only an administrator:

1. one allowed ordinary user;
2. one denied/unassigned or wrong-organization user;
3. one existing account that requires linking;
4. one mapped elevated role and the same user after claim removal;
5. one disabled account;
6. the break-glass administrator if SSO-only mode is enabled.

Confirm both successful and denied operations, review authentication/audit events, and preserve only redacted claims, issuer, subject hash, mapping rule, role source, timestamps, and request IDs as evidence.

See [Configure OIDC single sign-on](../../guides/identity/configure-oidc/) for setup, rollout, session policy, provider migration, and SSO enforcement.