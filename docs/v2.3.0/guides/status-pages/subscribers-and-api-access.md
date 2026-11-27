---
title: Manage status-page subscribers and API access
description: Operate verified subscriptions, announcements, webhooks, and scoped status-page tokens.
type: how-to
product_area: status-pages
audience: [administrator, responder]
reader: { status: READER_COMPLETE, task: Configure status-page subscriber and API delivery. }
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/components/status-page/StatusPageWorkspace.tsx
    - src/app/api/status-page/subscribers/route.ts
    - src/app/api/settings/status-pages/[pageId]/[section]/route.ts
    - src/components/status-page/StatusPageSubscriberChannels.tsx
    - src/components/status-page/StatusPageSubscribe.tsx
    - src/components/status-page/StatusPageSubscribers.tsx
    - src/lib/status-pages/subscriber-channel-policy.ts
    - src/lib/status-pages/subscriber-channel-requests.ts
---

# Manage status-page subscribers and API access

## Before you begin

Publish and verify the page first. Define who owns subscriber privacy, token rotation, webhook receivers, and announcement approval.

## Open the feature

Open **Settings → Status Pages**, select the page, then use its announcements, subscribers, webhooks, and API-token sections.

## Configure delivery and access

1. Create announcements with type, schedule, message, and affected services; preview before publishing.

   An announcement created through the API (`POST /api/v2/status-pages/{id}/announcements`) or an MCP assistant notifies subscribers when it is published, the same as one created in the console. Create it with `isActive: false` to hold it back without notifying. The API cannot yet end or cancel an announcement: set `endDate` when you create it, or end it from the page workspace.
2. Review verified active subscribers separately from unverified/unsubscribed records.
3. Configure webhook endpoints and use the built-in test before relying on them.
4. Create a page-scoped API token, copy it once to the approved secret manager, and record its owner/purpose.
5. Revoke unused tokens and retest consumers after rotation.

## Choose subscriber channels

In the page's **Subscribers** section, **Subscriber channels** sets what visitors can pick in the
subscribe dialog. Only admins can change it. **Email** and **Webhook** are on by default; the
others are off.

| Channel                | How a visitor subscribes                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| **Email**              | Enters an address and confirms it from the link we send.                                            |
| **Webhook**            | Enters an HTTPS endpoint; it must answer a signed verification request.                             |
| **Slack**              | Pastes a Slack incoming-webhook URL. It becomes active once a test message posts to the channel.    |
| **Microsoft Teams**    | Pastes a Teams incoming-webhook or Workflows URL. It becomes active once a test message posts.      |
| **Text message (SMS)** | Enters a mobile number with country code, then the 6-digit code we text. The code lasts 10 minutes. |

SMS needs an SMS provider in notification settings first; until then its switch stays off. Slack
and Teams accept only Slack or Microsoft webhook URLs. Visitors pick services or business services
the same way on every channel, and every message carries an unsubscribe link.

Turning a channel off pauses delivery to its subscribers; they are kept. The subscriber list shows
each subscriber's channel, for example an SMS number or "Slack webhook".

## What OpsKnight does

Subscriptions require verification and support unsubscribe. Page tokens and webhooks are scoped to the status-page surface; they do not replace application API keys. Announcements may be scheduled and associated with services.

A subscriber who picked services or business services receives only incidents on those picks; a subscriber with no picks receives the whole page. Deleting a service (in the console or through API v2) or a business service therefore revokes, in the same transaction, every subscriber whose only pick it was. Their subscription becomes `UNSUBSCRIBED` and queued messages are skipped, so they are not widened to every incident on the page. Bounced, complained and suppressed subscribers keep that state, subscribers with other picks keep those, and the audit entry for a deleted service records `unsubscribedSubscribers`, the number revoked.

Verification mail is limited so a public form cannot be used to flood an inbox: at most 5 verification mails per address per page per day, and 1,000 per page per hour. A request over a limit gets the same generic answer as any other, sends nothing, and leaves the link already sent valid. An already active subscriber who submits the same service picks they already have, or a change that is already waiting for their confirmation, is not mailed again.

An invalid or expired confirm or unsubscribe link shows the page's own "invalid or has expired" message, on a custom domain as well as on the application host, rather than a Not Found error.

The verification link confirms only a pending subscription (or one that is already active). A subscriber suppressed after a complaint or repeated bounces stays suppressed when the original email's link is opened again.

Administrator changes to the page's tokens, webhooks and announcements are recorded in the [audit log](../administration/audit-logs) with the acting administrator. Each record is written in the same transaction as the change. The actions are `status_page.api_token.created` and `status_page.api_token.revoked`; `status_page.webhook.created`, `.updated`, `.deleted` and `.tested`; and `status_page.announcement.created`, `.updated` and `.deleted`. The entries never contain the token, the webhook secret or the webhook URL.

## Verify the setup

Subscribe a controlled address, complete verification, publish a test announcement/update, and confirm delivery/unsubscribe. Call the intended status API with the new token and confirm an invalid/revoked token is rejected.

## Revoke or undo

End/cancel an announcement, disable a webhook, or revoke a token from the same page workspace. Never paste a replacement token into documentation or tickets.

## Troubleshooting

- **Subscriber receives nothing:** verify subscription, page state, provider delivery, and unsubscribe status. Check the channel is still switched on in **Subscriber channels**.
- **SMS code fails:** codes expire after 10 minutes and allow five tries; request a new code.
- **Webhook fails:** inspect test response, TLS, receiver logs, and rate/timeout behavior.
- **API returns unauthorized:** confirm page, token, revocation state, and expected authentication header.

## Next steps

- [Configure the page](./create-and-configure)
- [Publish an update](./publish-update)
