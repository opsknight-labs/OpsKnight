---
order: 2
title: Notifications
description: How OpsKnight pages people — email, SMS, push, Slack, WhatsApp, and webhooks. There is no voice channel.
---

# How a person gets paged

When an incident needs a human, OpsKnight sends a message on the channels you configured. There are **six** channels:

| Channel | Typical provider in Settings | Notes |
| --- | --- | --- |
| Email | SMTP, SendGrid, AWS SES, or Resend | Every user has an address |
| SMS | Twilio or AWS SNS | For urgent pages |
| Push | Web Push on the PWA | Same login as the desktop app |
| Slack | Slack app / OAuth | Channel notifications; war rooms are a separate Slack ChatOps feature from v1.2 |
| WhatsApp | Twilio | Optional extra path |
| Webhook | Any HTTPS URL | Including Microsoft Teams and Google Chat **incoming webhook formats** — not Slack-style rooms |

**There is no native phone-voice channel.** Missed pages escalate to the next person or layer; they do not place a voice call.

Configure providers under **Settings → Notification Provider**. Use **Test Connection** on email when that button is present.

Recommended baseline: **email + Slack**, then **SMS or push** for people who are actually on call.

## Email

1. Open **Settings → Notification Provider → Email**.
2. Choose SMTP, SendGrid, AWS SES, or Resend.
3. For SMTP, host/port/username/password, From address, From name.
4. Save, then send a test if the UI offers it.

## SMS

1. Open the SMS provider settings.
2. Choose **Twilio** or **AWS SNS**.
3. Enter the credentials that provider requires.
4. Assign SMS on the user and on escalation steps that should use it.

## Push (phone)

Install the OpsKnight PWA, allow notifications, and stay signed in. Push uses the same account as the browser app — it is not a separate App Store product.

## Slack notifications vs Slack rooms

- **Notifications:** incident cards in a channel you pick, with acknowledge/resolve when the Slack app is configured.
- **War rooms (v1.2 and later):** a dedicated channel per qualifying incident. See Slack ChatOps in this version’s docs if that page exists. Older versions only have channel notifications.

## WhatsApp

Uses Twilio. Configure only if you already use Twilio WhatsApp; it is optional.

## Webhooks (including Teams and Google Chat)

Webhooks POST incident JSON to an HTTPS URL. OpsKnight can format payloads for **Microsoft Teams** and **Google Chat** incoming webhooks. That is **not** ChatOps: there is no Teams or Google Chat war room, slash command, or pin-sync.

## Escalation

Escalation policies decide **who** is notified and **after how long**. Each step can target a user, a team, or a schedule, and can override channels. See [Escalation policies](../core-concepts/escalation-policies).

## What this page does not cover

- Native voice / PSTN calling
- SAML (SSO is OIDC — see Authentication)
- AI correlation or a workflow engine (not shipped)
