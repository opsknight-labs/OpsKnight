---
title: Configure responder notification preferences
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

Open **Settings → Notifications** in the responder profile/preferences area.

## Configure preferences

1. Review each personal endpoint and its health/verification state.
2. Enable intended channels/events.
3. Configure quiet hours or opt-out behavior deliberately.
4. Save and confirm displayed state.
5. Run a controlled notification/incident test.

## What OpsKnight does

Eligibility combines service/policy intent, user preferences, endpoint health, quiet hours/opt-out, incident context, provider availability, and control-plane admission. An enabled channel without a usable endpoint cannot deliver.

## Verify it worked

Test inside and, where safe, across a quiet-hours boundary. Confirm the expected channel/endpoint is selected and delivery history records the recipient/provider outcome.

## Change or undo it

Re-enable the prior channel/window or remove an obsolete endpoint after an alternate is verified. Administrators should remove endpoints for deactivated users and update on-call/escalation ownership.

## Troubleshooting

**Preference enabled but skipped:** inspect endpoint health, quiet hours, opt-out, event/channel route, incident state, and provider status.

**Wrong endpoint used:** inspect endpoint priority/current stored values and target resolution.

## Next steps

- [Configure routing](./configure-routing)
- [Test notification](./test-notification)

