---
title: Manage status-page subscribers and API access
description: Operate verified subscriptions, announcements, webhooks, and scoped status-page tokens.
type: how-to
product_area: status-pages
audience: [administrator, responder]
reader: { status: READER_COMPLETE, task: Configure status-page subscriber and API delivery. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/components/status-page/StatusPageWorkspace.tsx", "src/app/api/status-page/subscribers/route.ts", "src/app/api/settings/status-pages/[pageId]/[section]/route.ts"]
---

# Manage status-page subscribers and API access

## Before you begin

Publish and verify the page first. Define who owns subscriber privacy, token rotation, webhook receivers, and announcement approval.

## Open the feature

Open **Settings → Status Pages**, select the page, then use its announcements, subscribers, webhooks, and API-token sections.

## Configure delivery and access

1. Create announcements with type, schedule, message, and affected services; preview before publishing.
2. Review verified active subscribers separately from unverified/unsubscribed records.
3. Configure webhook endpoints and use the built-in test before relying on them.
4. Create a page-scoped API token, copy it once to the approved secret manager, and record its owner/purpose.
5. Revoke unused tokens and retest consumers after rotation.

## What OpsKnight does

Subscriptions require verification and support unsubscribe. Page tokens and webhooks are scoped to the status-page surface; they do not replace application API keys. Announcements may be scheduled and associated with services.

## Verify the setup

Subscribe a controlled address, complete verification, publish a test announcement/update, and confirm delivery/unsubscribe. Call the intended status API with the new token and confirm an invalid/revoked token is rejected.

## Revoke or undo

End/cancel an announcement, disable a webhook, or revoke a token from the same page workspace. Never paste a replacement token into documentation or tickets.

## Troubleshooting

- **Subscriber receives nothing:** verify subscription, page state, provider delivery, and unsubscribe status.
- **Webhook fails:** inspect test response, TLS, receiver logs, and rate/timeout behavior.
- **API returns unauthorized:** confirm page, token, revocation state, and expected authentication header.

## Next steps

- [Configure the page](./create-and-configure)
- [Publish an update](./publish-update)
