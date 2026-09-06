---
title: Users
description: Invite users, assign application access, configure response channels, and offboard accounts safely.
order: 7
---

# Users

User accounts identify responders, administrators, observers, schedule participants, incident owners, and notification recipients. Application roles, account status, team roles, and notification preferences are independent controls.

## Application roles

| Role          | Intended access                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**      | Standard signed-in access to permitted dashboards and operational records. Some server-side resource checks also allow assigned users or owning-team members, but the v1.4 incident interface reserves management controls for Responders and Admins. |
| **Auditor**   | Read-only organization-wide access to incidents, services, schedules, reports, metrics, and audit evidence. Cannot change operational resources or workspace settings.                                                                                |
| **Responder** | Create and manage incidents, services, teams, schedules, integrations, and other response workflows. Cannot perform Admin-only workspace governance.                                                                                                  |
| **Admin**     | Full workspace administration, including users, policy administration, providers, security configuration, and destructive account/service operations.                                                                                                 |

Team **Owner**, **Admin**, and **Member** are separate team-scoped roles. See [Teams](teams.md).

Use least privilege. Prefer Auditor over Admin for compliance reviewers, keep at least two active application Admins, and review Responder access regularly.

## Account statuses

| Status       | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| **Invited**  | The account exists and needs an invitation/password setup or a new invite.         |
| **Active**   | The account can authenticate through its configured credential or linked identity. |
| **Disabled** | Sign-in and response participation should be treated as unavailable.               |

An Admin can reactivate a disabled user or generate a fresh invite. OIDC deployments may create, link, synchronize, reactivate, or map a user according to the configured identity-provider policy; review [Authentication and security](authentication-security.md) before enabling automatic provisioning.

## Invite a user

Only an Admin can invite users.

1. Open **Users**.
2. Enter name, email, and initial application role.
3. Select **Invite User**.
4. Copy the generated one-time invitation link immediately.
5. If workspace email is configured, confirm the invitation email was accepted by the provider. Otherwise share the link through a secure channel.
6. Ask the user to set a password and sign in before the link expires.

The invite link is a credential. Do not place it in tickets, public chat, screenshots, or documentation. Generating another invitation invalidates earlier outstanding invite tokens for that user.

If email delivery fails, the account and copyable link can still be created. Configure a provider and resend, or share the link securely.

## Manage first-time OIDC linking

For an existing **Active** account that has not linked OIDC yet:

1. Open **Users** as an Admin.
2. Open the user's **⋯** actions menu.
3. Select **Allow OIDC linking**.
4. Review the confirmation and select **Allow linking**.
5. Ask the user to sign in through the configured OIDC provider.

The approval does not change role, account status, password, or existing sessions. First-time linking still requires the configured provider to return the same email, a stable subject, and `email_verified: true`, and the external identity must not already belong to another OpsKnight account.

Before the identity is established, reopen **⋯** and select **Revoke OIDC linking approval** to disallow the first-time link again. Revocation does not deactivate the user or remove password access.

After the identity is established, the menu shows **OIDC linked**. The approval control intentionally does not unlink an established identity.

Users in **Invited** status already carry administrator-provisioning evidence from the invite workflow, so the explicit allow/revoke control is shown only for Active users. See [Authentication](../administration/authentication.md#manage-oidc-linking-for-an-existing-user).

## Find and manage accounts

The Users page shows 20 users per page and supports search by name/email, filters for status, application role, and team, plus sorting by creation date, name, email, or status. It also shows user/team audit activity.

An Admin can:

- change another user's application role;
- activate or deactivate accounts individually or in bulk;
- generate a new invite;
- allow or revoke first-time OIDC linking for an existing Active user;
- add users to teams;
- delete accounts after safety checks.

Admins cannot change their own role, deactivate themselves, or delete themselves through these actions. Deleting the last non-disabled Admin is blocked.

## User profile and timezone

Each user can open **Settings → Profile** to manage supported profile fields, timezone, gender/avatar selection, and an uploaded JPG, GIF, or PNG avatar up to 2 MB. Email and role are governed fields rather than normal profile edits. OIDC profile synchronization may update department, job title, or external avatar according to workspace configuration.

### In-process vector avatar engine

OpsKnight provides a zero-latency, local `@dicebear` vector avatar generator at `/api/avatar`. Users can select from 15 curated SVG style presets (including `bottts`, `shapes`, `initials`, `personas`, `identicon`, `avataaars`, `thumbs`, `lorelei`, `notionists`, `open-peeps`, `micah`, `miniavs`, `pixel-art`, `rings`, and `glass`) with gender-appropriate styling. Avatar SVGs are rendered locally without third-party network dependencies, cached immutably with `Cache-Control: public, max-age=31536000, immutable`, and served with strict SVG sandbox headers (`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`).

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

Team paging also respects the membership's `Receive team notifications` setting. Test the full chain and review notification history rather than assuming a saved switch guarantees delivery. Quiet Hours suppression is an intentional policy decision and should not be interpreted as a provider delivery failure.

## Passwords and sessions

Credential users can change their password from **Settings → Security**. Accounts created only through OIDC may not have a local password until an appropriate setup/reset workflow is completed.

**Revoke all sessions** increments the account's session version and signs it out across devices. Password reset and account-disable operations also revoke or invalidate access as implemented. OpsKnight v1.4 does not present a per-device session list; the control revokes all sessions.

Forgot-password responses do not reveal whether an email is registered. Treat reset and invite links as secrets.

## Deactivate, reactivate, or delete

### Deactivate

Use deactivation for temporary or normal offboarding. It preserves the account record and is safer than deletion, but you must still replace operational references.

Before deactivation:

- replace the user in schedules and overrides;
- replace direct escalation-policy steps;
- transfer incident and action-item assignments;
- transfer Team Lead and sole Team Owner responsibilities;
- review API keys, devices, dashboards, templates, postmortems, and external issue ownership;
- verify another Admin remains.

Then deactivate and run test escalations for affected services.

### Reactivate

An Admin can reactivate a disabled account. The user may need a new invitation or password reset before signing in. Re-enable response assignments only after authentication and notification channels are verified.

### Delete

Deletion is permanent and removes or disconnects related operational records according to application actions and database constraints. The current deletion workflow removes memberships, shifts, direct escalation rules, notes, notification records, watchers, and the account; other required references can block it.

Deletion of a sole Team Owner or the last Admin is blocked. Prefer deactivation unless retention or privacy policy requires permanent removal. Export required evidence and take a verified backup first.

## Offboarding verification

- [ ] Replacement Admin and Team Owners exist.
- [ ] Direct policy steps have been replaced and reordered.
- [ ] Schedules and overrides have continuous coverage.
- [ ] Active incidents and action items have new owners.
- [ ] API keys and registered devices are revoked or reassigned.
- [ ] Team Lead and dashboard/template ownership are handled.
- [ ] Affected service escalation tests succeed.
- [ ] Audit evidence and required records are retained.

## Troubleshooting

### The invitation email did not arrive

Use the copyable invite link, inspect the email provider and logs, verify sender/domain configuration, and generate a new invite if the earlier token should be invalidated.

### An existing user still cannot sign in with OIDC

For an Active user, open **⋯** and confirm the menu shows **Revoke OIDC linking approval**, which means first-time linking is currently allowed. Then verify the configured provider returns a stable subject, the same account email, and `email_verified: true`. Also check allowed-domain policy and whether the identity is already linked elsewhere.

If the menu shows **Allow OIDC linking**, approval is not currently present. If it shows **OIDC linked**, the external identity is already established and the problem is not first-link approval.

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
- [Published API and CLI guides](../api/README.md)
