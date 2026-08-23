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
| **User**      | Standard signed-in access to permitted dashboards and operational records. Some server-side resource checks also allow assigned users or owning-team members, but the v1.3 incident interface reserves management controls for Responders and Admins. |
| **Responder** | Create and manage incidents, services, teams, schedules, integrations, and other response workflows. Cannot perform Admin-only workspace governance.                                                                                                  |
| **Admin**     | Full workspace administration, including users, policy administration, providers, security configuration, and destructive account/service operations.                                                                                                 |

Team **Owner**, **Admin**, and **Member** are separate team-scoped roles. See [Teams](teams.md).

Use least privilege. Keep at least two active application Admins, and review Responder access regularly.

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

## Allow an existing user to link OIDC

Use this for an existing **Active** account that needs to start using the configured OIDC provider and does not already have a linked OIDC identity.

1. Open **Users** as an Admin.
2. Find the Active user.
3. Select **Allow OIDC linking**.
4. Ask the user to sign in through OIDC.

The control does not change the user's role or account status and does not issue a usable invitation link. It records administrator approval for first-time identity linking. The next OIDC sign-in is still accepted only when the configured provider supplies a stable subject and explicitly reports `email_verified: true`, and when that issuer-plus-subject identity is not linked to another OpsKnight account.

Users still in **Invited** status already carry administrator-provisioning evidence from the invite workflow and do not need this extra step. If an existing user is denied after approval, do not repeatedly approve the account; check the provider subject, verified-email claim, email value, allowed-domain policy, and existing OIDC identity links. See [Authentication](../administration/authentication.md#allow-oidc-linking-for-an-existing-user).

## Find and manage accounts

The Users page shows 20 users per page and supports search by name/email, filters for status, application role, and team, plus sorting by creation date, name, email, or status. It also shows user/team audit activity.

An Admin can:

- change another user's application role;
- activate or deactivate accounts individually or in bulk;
- generate a new invite;
- explicitly allow first-time OIDC linking for an existing Active user;
- add users to teams;
- delete accounts after safety checks.

Admins cannot change their own role, deactivate themselves, or delete themselves through these actions. Deleting the last non-disabled Admin is blocked.

## User profile and timezone

Each user can open **Settings → Profile** to manage supported profile fields, timezone, gender/avatar selection, and an uploaded JPG, GIF, or PNG avatar up to 2 MB. Email and role are governed fields rather than normal profile edits. OIDC profile synchronization may update department, job title, or external avatar according to workspace configuration.

Timezone affects how the application displays dates for that user. Schedule calculation remains authoritative in each schedule's timezone.

## Notification preferences

Open **Settings → Notifications** to enable supported user channels:

- Email;
- SMS, with a phone number;
- Push, with a registered supported device and provider;
- WhatsApp, with a phone number in E.164 format.

These switches express user preference; they do not configure workspace providers. Delivery requires all of the following:

1. the workspace provider is enabled and valid;
2. the user enabled the channel;
3. required contact/device data exists;
4. the escalation or service event selects or inherits that channel;
5. the provider accepts the message.

Team paging also respects the membership's `Receive team notifications` setting. Test the full chain and review notification history rather than assuming a saved switch guarantees delivery.

## Passwords and sessions

Credential users can change their password from **Settings → Security**. Accounts created only through OIDC may not have a local password until an appropriate setup/reset workflow is completed.

**Revoke all sessions** increments the account's session version and signs it out across devices. Password reset and account-disable operations also revoke or invalidate access as implemented. OpsKnight v1.3 does not present a per-device session list; the control revokes all sessions.

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

Confirm the user is Invited or an Admin selected **Allow OIDC linking**, then verify the configured provider returns a stable subject, the same account email, and `email_verified: true`. Also check allowed-domain policy and whether the external identity is already linked to another user.

### A user is targeted but receives no page

Confirm account status, channel preference, contact/device data, team notification participation, workspace provider, and notification history.

### An account cannot be removed

Check whether it is the current Admin, last Admin, a sole Team Owner, or still referenced by required data. Transfer responsibility before retrying.

## Related topics

- [Teams](teams.md)
- [On-call schedules](schedules.md)
- [Escalation policies](escalation-policies.md)
- [Authentication and security](authentication-security.md)
- [Authentication](../administration/authentication.md)
- [Published API and CLI guides](../api/README.md)
