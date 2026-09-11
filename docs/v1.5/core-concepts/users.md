---
title: Users
description: Invite users, assign application access, configure response channels, and offboard accounts safely.
order: 7
---

# Users

User accounts identify responders, administrators, observers, schedule participants, incident owners, and notification recipients. Application roles, account status, team roles, notification preferences, and identity-management source are independent controls.

## Application roles

| Role | Intended access |
| --- | --- |
| **User** | Standard signed-in access to permitted dashboards and operational records. Some server-side resource checks also allow assigned users or owning-team members, but incident management controls are reserved for appropriate responder/admin roles. |
| **Auditor** | Read-only organization-wide access to incidents, services, schedules, reports, metrics, and audit evidence. Cannot change operational resources or workspace settings. |
| **Responder** | Create and manage incidents, services, teams, schedules, integrations, and other response workflows. Cannot perform Admin-only workspace governance. |
| **Admin** | Full workspace administration, including users, policy administration, providers, security configuration, and destructive account/service operations. |

Team **Owner**, **Admin**, and **Member** are separate team-scoped roles. See [Teams](teams.md).

Use least privilege. Prefer Auditor over Admin for compliance reviewers, keep at least two active application Admins, and review Responder access regularly.

OpsKnight v1.5 also tracks the source of an application role so manually managed roles can be distinguished from OIDC- or SCIM-managed roles. This allows authoritative external role de-provisioning without treating every role change as manual administration.

## Account statuses

| Status | Meaning |
| --- | --- |
| **Invited** | The account exists and needs invitation/password setup or a supported external-identity activation flow. |
| **Active** | The account can authenticate through its permitted credential or linked identity. |
| **Disabled** | Sign-in and response participation are unavailable until the account is reactivated through an allowed lifecycle path. |

An Admin can reactivate a disabled user or generate a fresh invite. OIDC can create/link users according to the configured provider policy, and SCIM can provision/deprovision lifecycle-managed users. Review [Authentication](../administration/authentication.md) and [SCIM Provisioning](../security/scim-provisioning.md) before enabling automatic identity management.

## Invite a user

Only an Admin can invite users.

1. Open **Users**.
2. Enter name, email, and initial application role.
3. Select **Invite User**.
4. Copy the generated one-time invitation link immediately.
5. If workspace email is configured, confirm the invitation email was accepted by the provider. Otherwise share the link through a secure channel.
6. Ask the user to complete setup before the link expires.

The invite link is a credential. Do not place it in tickets, public chat, screenshots, or documentation. Generating another invitation invalidates earlier outstanding invite tokens for that user.

If email delivery fails, the account and copyable link can still be created. Configure a provider and resend, or share the link securely.

## Manage first-time OIDC linking

OpsKnight does not silently bind a new OIDC subject to an existing account merely because the email matches.

For an existing **Active** or supported **Invited** account that has not linked OIDC yet:

1. Open **Users** as an Admin.
2. Open the user's actions menu.
3. Select **Allow OIDC linking**.
4. Review the confirmation and select **Allow linking**.
5. Ask the user to sign in through the configured OIDC provider.

A linking approval:

- does not itself change role, account status, password, or active sessions;
- expires after the configured approval lifetime;
- can be renewed or revoked;
- is scoped to the provider/configuration and issuer trust boundary;
- is tied to the expected account email; and
- is consumed atomically by the successful first link.

The provider must still return a stable subject and satisfy its email-assurance and organization/tenant policy. Microsoft Entra is handled provider-specifically because validated Entra workforce issuers may legitimately omit the standard `email_verified` claim; an explicit `email_verified: false` remains a rejection.

After the identity is established, sign-in resolves by normalized issuer plus subject (`iss` + `sub`), not by email. The approval control is not an unlink mechanism.

See [Authentication](../administration/authentication.md#first-time-oidc-linking).

## Find and manage accounts

The Users page supports search by name/email, filters for status, application role, and team, sorting, and user/team audit activity.

An Admin can:

- change another user's application role when the role-management source permits it;
- activate or deactivate accounts individually or in bulk;
- generate a new invite;
- allow, renew, or revoke first-time OIDC linking where applicable;
- add users to teams;
- delete accounts after safety checks.

Admins cannot change their own role, deactivate themselves, or delete themselves through these actions. Deleting the last non-disabled Admin is blocked.

## OIDC-managed users

OIDC identity ownership is based on issuer plus subject. Email changes do not move the external identity to another OpsKnight account.

When OIDC role mapping is authoritative for a user, removing the mapped IdP claim can remove the corresponding OpsKnight privilege on a later sign-in. Group-overage/missing-claim conditions are handled explicitly rather than always being interpreted as a normal empty set.

Provider organization policy is evaluated even for previously linked identities. For example:

- Entra identities remain constrained by the configured tenant trust boundary;
- Google Workspace access uses the signed `hd` claim;
- Auth0 can enforce the signed `org_id` claim.

## SCIM-managed users

SCIM can provision, update, deactivate, and remove users from the SCIM namespace.

Deprovisioning disables the internal account and invalidates active access. SCIM DELETE removes the external SCIM identity while intentionally retaining the disabled OpsKnight user for history, audit evidence, and operational references.

OpsKnight v1.5 supports SCIM **Users**, not a SCIM Groups endpoint. See [SCIM Provisioning](../security/scim-provisioning.md).

## User profile and timezone

Each user can open **Settings → Profile** to manage supported profile fields, timezone, gender/avatar selection, and an uploaded JPG, GIF, or PNG avatar up to 2 MB. Email and role are governed fields rather than normal profile edits. OIDC profile synchronization may update department, job title, or external avatar according to workspace configuration.

### In-process vector avatar engine

OpsKnight provides a local `@dicebear` vector avatar generator at `/api/avatar`. Users can select from curated SVG style presets, with avatar SVGs rendered locally without third-party network dependencies, cached immutably, and served with strict SVG sandbox headers.

Timezone affects how the application displays dates for that user. Schedule calculation remains authoritative in each schedule's timezone. Quiet Hours also evaluates its configured times in this profile timezone.

## Notification preferences

Open **Settings → Profile & Preferences** to configure personal notification behavior:

- Email;
- SMS, with a phone number;
- Push, with a registered supported device and provider;
- WhatsApp, with a phone number in E.164 format; and
- **Quiet Hours** under General Preferences, an optional LOW-urgency suppression policy.

Quiet Hours is **off by default** for both existing and new users. OpsKnight does not silently mute paging after an upgrade or account creation. A user must explicitly enable Quiet Hours before it can suppress any delivery channel.

When enabled, the user chooses a start time, end time, and whether weekends are quiet all day. Times use the user's profile timezone. During an active Quiet Hours window, only LOW-urgency Push, SMS, and WhatsApp delivery is suppressed. Email and in-app notifications remain available, and MEDIUM/HIGH urgency bypasses Quiet Hours entirely.

These switches express user preference; they do not configure workspace providers. Delivery requires all of the following:

1. the workspace provider is enabled and valid;
2. the user enabled the channel;
3. required contact/device data exists;
4. the escalation or service event selects or inherits that channel;
5. Quiet Hours does not intentionally suppress that LOW-urgency disruptive channel; and
6. the provider accepts the message.

Team paging also respects the membership's `Receive team notifications` setting. Test the full chain and review notification history rather than assuming a saved switch guarantees delivery.

## Passwords and sessions

Credential users can change their password from **Settings → Security**. OIDC-only accounts may not have a normal local password, especially when SSO-only policy is enabled.

Credential sessions retain the normal local policy, including the longer Remember Me lifetime. OIDC sessions use the separate enterprise maximum-age/idle/renewal policy described in [Authentication](../administration/authentication.md#oidc-sessions).

**Revoke all sessions** increments the account's token/security version and signs it out across devices. Password reset, account disablement, SCIM deprovisioning, and relevant OIDC trust changes also invalidate active access.

Forgot-password responses do not reveal whether an email is registered. When local login is disabled, password recovery must not provide a bypass around the SSO-only policy.

## Deactivate, reactivate, or delete

### Deactivate

Use deactivation for temporary or normal offboarding. It preserves the account record and is safer than deletion, but you must still replace operational references.

Before deactivation:

- replace the user in schedules and overrides;
- replace direct escalation-policy steps;
- transfer incident and action-item assignments;
- transfer Team Lead and sole Team Owner responsibilities;
- review API keys, devices, dashboards, templates, postmortems, and external issue ownership;
- verify another Admin remains; and
- disable/deprovision the identity at the authoritative IdP/SCIM source where applicable.

Then deactivate and run test escalations for affected services.

### Reactivate

An Admin can reactivate a disabled manually managed account. For OIDC/SCIM-managed users, coordinate reactivation with the authoritative external identity/provisioning policy so OpsKnight and the provider do not fight over lifecycle state.

### Delete

Deletion is permanent and removes or disconnects related operational records according to application actions and database constraints. The current deletion workflow removes memberships, shifts, direct escalation rules, notes, notification records, watchers, and the account; other required references can block it.

Deletion of a sole Team Owner or the last Admin is blocked. Prefer deactivation unless retention or privacy policy requires permanent removal. Export required evidence and take a verified backup first.

SCIM DELETE is intentionally different from an OpsKnight Admin deleting the internal user: SCIM DELETE removes the SCIM resource and disables/retains the internal OpsKnight account for history.

## Offboarding verification

- [ ] Replacement Admin and Team Owners exist.
- [ ] Direct policy steps have been replaced and reordered.
- [ ] Schedules and overrides have continuous coverage.
- [ ] Active incidents and action items have new owners.
- [ ] API keys and registered devices are revoked or reassigned.
- [ ] Team Lead and dashboard/template ownership are handled.
- [ ] Authoritative IdP/SCIM access is removed when externally managed.
- [ ] Existing sessions are invalidated.
- [ ] Affected service escalation tests succeed.
- [ ] Audit evidence and required records are retained.

## Troubleshooting

### The invitation email did not arrive

Use the copyable invite link, inspect the email provider and logs, verify sender/domain configuration, and generate a new invite if the earlier token should be invalidated.

### An existing user still cannot sign in with OIDC

Confirm the user has a valid first-link approval when required. Check approval expiry and provider/config scope, stable subject, current account status, organization/tenant restriction, and whether the external `(issuer, sub)` identity is already linked elsewhere.

For Entra, do not assume a missing standard `email_verified` claim is an error; validated Entra issuers use the provider-specific policy. An explicit false claim is still rejected.

### A SCIM-deleted user still appears in OpsKnight

Expected: SCIM DELETE removes the external SCIM identity and disables the account, but the internal OpsKnight user is retained for history/audit. It should no longer be exposed as the deleted SCIM resource.

### A user is targeted but receives no page

Confirm account status, channel preference, contact/device data, team notification participation, Quiet Hours state for LOW urgency, workspace provider, and notification history.

### An account cannot be removed

Check whether it is the current Admin, last Admin, a sole Team Owner, or still referenced by required data. Transfer responsibility before retrying.

## Related topics

- [Teams](teams.md)
- [On-call schedules](schedules.md)
- [Escalation policies](escalation-policies.md)
- [Authentication and security](authentication-security.md)
- [Authentication](../administration/authentication.md)
- [OIDC SSO Setup](../security/oidc-setup.md)
- [SCIM Provisioning](../security/scim-provisioning.md)
- [Published API and CLI guides](../api/README.md)
