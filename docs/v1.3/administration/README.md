---
title: Administration
description: Operate users, authentication, notification providers, custom fields, retention, and audit evidence.
order: 3
---

# Administration

Administration turns a working OpsKnight installation into a governed service. Use these guides to configure access, delivery providers, metadata, retention, and audit review.

## Guides

| Guide                                 | Use it to                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [Notifications](notifications.md)     | Configure email, Twilio SMS, web push, WhatsApp, Slack/service delivery boundaries, user preferences, and history. |
| [Authentication](authentication.md)   | Configure local credentials and OIDC sign-in safely.                                                               |
| [Custom fields](custom-fields.md)     | Add structured incident metadata and control public exposure.                                                      |
| [System settings](system-settings.md) | Safely change application URL, OIDC, retention, encryption, and performance settings.                              |
| [Data retention](data-retention.md)   | Set cleanup policy and understand reporting/status-history effects.                                                |
| [Audit logs](audit-logs.md)           | Investigate user, team, service, policy, and administrative changes recorded by v1.3.                              |
| [System logs](system-logs.md)         | Troubleshoot the current process and understand the boundary with durable platform logs.                           |

User, team, service, schedule, escalation-policy, and API-key operations are also documented in their task guides. The API index intentionally does not publish Users, Teams, Services, or Schedules REST contracts.

## Recommended setup order

1. Create a second Admin and define break-glass access.
2. Choose local credentials, OIDC, or a controlled combination.
3. Configure one outbound provider and test a real delivery path.
4. Invite Responders and verify personal preferences/contact data.
5. Build teams, schedules, policies, and services.
6. Define custom fields and status-page privacy before storing sensitive metadata.
7. Choose retention only after backup, compliance, analytics, and public-history review.
8. Establish a recurring audit, provider-failure, access, backup, and credential-rotation review.

## Notification baseline

| Need          | Supported v1.3 choice                                   |
| ------------- | ------------------------------------------------------- |
| Email         | Resend, SendGrid, SMTP, or Amazon SES.                  |
| SMS           | Twilio.                                                 |
| Mobile push   | Standard Web Push/PWA with VAPID.                       |
| WhatsApp      | Twilio WhatsApp Business.                               |
| Slack         | Slack workspace/OAuth and service configuration.        |
| External HTTP | Service or status-page webhooks, depending on audience. |

Twilio and AWS SNS are the v1.3 SMS choices. FCM and OneSignal are not the v1.3 push-provider model. There is no native voice/PSTN channel.

## Administrator safety rules

- Keep at least two active Admins and do not share accounts.
- Store all credentials in approved secret storage.
- Test authentication, notifications, schedules, and escalation after every relevant change.
- Deactivate before deleting users unless permanent removal is required.
- Back up and verify restore before retention changes, upgrades, or destructive operations.
- Treat status-page, webhook, notification, audit, and analytics data as potentially sensitive.
- Use the published UI and API contracts; the existence of an internal route is not authorization to integrate against it.

## Related topics

- [Users](../core-concepts/users.md)
- [Teams](../core-concepts/teams.md)
- [Security](../security/README.md)
- [Deployment](../deployment/README.md)
- [Published API and CLI guides](../api/README.md)
