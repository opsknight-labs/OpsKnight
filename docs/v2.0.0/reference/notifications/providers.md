---
title: Notification provider reference
description: Reference the supported provider classes, credential boundaries, sender and endpoint requirements, tests, and security responsibilities.
type: reference
product_area: notifications
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/notification-providers.ts]
---

# Notification provider reference

OpsKnight can load configured email transports including Resend, SendGrid, Amazon SES, and SMTP, plus supported SMS, voice, and web-push paths. The settings UI is authoritative for fields enabled in the current build.

For every provider, operators own credential issuance/rotation, least privilege, verified sender/domain/number/application, region, account limits, network egress, suppression/complaint handling, and provider-side delivery evidence.

Provider configuration is global transport capability. Service/escalation routing and user endpoints/preferences determine whether a specific incident event is eligible for it.

Never expose credentials in screenshots, logs, tickets, rendered configuration, or certification artifacts. Preserve `ENCRYPTION_KEY` across restore so stored provider credentials remain decryptable.

Use [Configure a provider](../../guides/notifications/configure-provider) and [Test notification delivery](../../guides/notifications/test-notification).

