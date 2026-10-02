---
title: Notification tasks
order: 1
description: Configure providers and routing, test delivery, and repair failures.
type: concept
product_area: notifications
audience: [administrator, responder]
verification: { level: source, verified_at: 2026-10-01, evidence: [src/lib/notification-providers.ts, src/lib/notification-control-plane.ts] }
---

# Notifications

Administrators should [configure a provider](./configure-provider), send a
[test notification](./test-notification), and then [configure routing](./configure-routing).
Responders manage [user preferences](./user-preferences). Operators use
[delivery inspection](./inspect-delivery) and [failure retry](./retry-failures)
to distinguish routing, queue, provider, and destination failures.

Provider-specific requirements and limits remain in the
[notification provider reference](../../reference/notifications/).

## Provider setup

- [SMTP](./configure-smtp)
- [Resend](./configure-resend)
- [SendGrid](./configure-sendgrid)
- [Amazon SES](./configure-amazon-ses)
- [Amazon SNS SMS](./configure-amazon-sns)
- [Web Push](./configure-web-push)
- [Twilio voice, SMS, and WhatsApp](../../integrations/communication/voice)
