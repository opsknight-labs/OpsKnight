---
title: Configure responder notification preferences
order: 11
description: Enable usable personal endpoints and verify quiet-hours, opt-out, channel, and incident eligibility.
type: how-to
product_area: notifications
audience: [responder, administrator]
reader:
  status: READER_COMPLETE
  task: Configure and verify a responder's notification preferences.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/user-notifications.ts, src/lib/user-notification-endpoints.ts, src/app/api/settings/notifications/]
---

# Configure responder notification preferences

## Before you begin

The administrator must configure the provider. Know which channels the escalation/service route uses and ensure the responder has a verified usable email/phone/device endpoint.

## Open the feature

Open **Settings → Profile**, then select the **Notifications** tab. The
administrator-only **Settings → Notifications** page configures providers; it
does not contain responder preferences.

## Configure preferences

1. Review each personal endpoint and its health/verification state.
2. Enable intended channels/events.
3. Configure quiet hours or opt-out behavior deliberately.
4. Save and confirm displayed state.
5. Run a controlled notification/incident test.

## What OpsKnight does

Eligibility combines service/policy intent, user preferences, endpoint health, quiet hours/opt-out, incident context, provider availability, and control-plane admission. An enabled channel without a usable endpoint cannot deliver.

An endpoint that is `INVALID`, `BOUNCED` or `OPTED_OUT` stays that way when a late or out-of-order provider callback arrives, for example a delivered receipt for an older message after the recipient complained. The callback does not mark it healthy or degraded, so paging does not resume on its own. Changing the address, or an explicit action by the user or an administrator, clears the state.

When one of your own contacts is `INVALID` or `BOUNCED`, **Settings → Profile → Notifications** shows "Some contacts are being skipped" with the channel and a **Reset** button. Reset returns the contact to unverified so the next notification is tried again, and records `notification.endpoint.reset` in the audit log. It does not lift `OPTED_OUT`, and a contact that bounces again is blocked again.

Rotating `NEXTAUTH_SECRET` does not clear these states. Address hashes are keyed by that secret, so every hash changes after a rotation. OpsKnight records a fingerprint of the key in system configuration; when it detects that the key changed, a `BOUNCED` or `OPTED_OUT` endpoint stays blocked and only has its hash re-stamped. A changed address under an unchanged key still returns the endpoint to `UNVERIFIED` and needs verification again.

## Verify it worked

Test inside and, where safe, across a quiet-hours boundary. Confirm the expected channel/endpoint is selected and delivery history records the recipient/provider outcome.

## Change or undo it

Re-enable the prior channel/window or remove an obsolete endpoint after an alternate is verified. Administrators should remove endpoints for deactivated users and update on-call/escalation ownership.

## Troubleshooting

**Preference enabled but skipped:** inspect endpoint health, quiet hours, opt-out, event/channel route, incident state, and provider status.

**Wrong endpoint used:** inspect endpoint priority/current stored values and target resolution.

## Next steps

- [Manage your profile and preferences](../profile/manage-profile-and-preferences)
- [Configure routing](./configure-routing)
- [Test notification](./test-notification)
