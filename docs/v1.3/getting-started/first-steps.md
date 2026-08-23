---
title: First steps
description: Complete a first-week setup with users, team ownership, on-call coverage, paging, integrations, and operational verification.
order: 3
---

# First steps

The [Getting Started](README.md) page is the 15-minute Compose path. This guide is the longer first-week setup for a real team: accounts, ownership, on-call rotation, escalation, notifications, integration ingest, status communication, and operating checks.

## What you will build

```text
active users → team → schedule → escalation policy → service
                                                  ↘ integration → incident
service + policy + providers → tested responder notification
```

Use synthetic names and a non-production service until the workflow is verified.

## 1. Secure the first Admin

On a new installation, `/setup` is available only while no user exists.

1. Enter the first Admin's name and email.
2. Select **Generate Admin Credentials**.
3. Copy the generated temporary password; it is shown once.
4. Sign in at `/login`.
5. Open **Settings → Security**, change the password, and store recovery information securely.

Create a second Admin before production so administration does not depend on one account.

## 2. Configure a notification provider

In-app notifications work without a third-party provider, but they are not sufficient for dependable on-call paging.

1. Open **Settings → Notification Providers**.
2. Configure at least one provider—email is a practical first test.
3. Save and enable it.
4. Open your personal **Settings → Notifications** and enable the matching channel.
5. Add the required phone/device data for SMS, WhatsApp, or push.

The provider card's save result is not a delivery test. You will verify it with a test incident later. See [Notifications](../administration/notifications.md).

## 3. Invite responders

1. Open **Users**.
2. Invite at least one additional person as **Responder**.
3. Copy the invitation link and deliver it through a secure channel.
4. Have the user set a password, sign in, configure a timezone, and enable a notification channel.

Use **User** for standard read-oriented access, **Responder** for incident/on-call work, and **Admin** for workspace governance. Do not give Admin access merely to make paging work.

## 4. Create the owning team

1. Open **Teams** and create a uniquely named team, such as `Platform Engineering`.
2. Add active responders.
3. Assign at least two appropriate Team Owners.
4. Optionally select a Team Lead.
5. Confirm `Receive team notifications` is enabled for people expected to receive team-targeted pages.

Application roles and team roles are separate. See [Teams](../core-concepts/teams.md).

## 5. Create and verify the schedule

Create the schedule before the policy so it is available as a policy target.

1. Open **Schedules** and create `Platform Primary On-Call`.
2. Select the team's authoritative IANA timezone, for example `America/New_York`.
3. Add a `Primary Rotation` layer with a current start time and rotation length such as `168` hours for weekly handoff.
4. Add responders in rotation order.
5. Inspect the timeline, calendar, current on-call user, and next handoff.
6. Create a short test override, verify it changes effective coverage, then remove it.

Do not continue with an empty layer, expired layer, coverage warning, or unexpected current user. See [On-call schedules](../core-concepts/schedules.md).

## 6. Create the escalation policy

Only an application Admin can manage policies.

1. Open **Escalation Policies** and create `Platform Service Escalation`.
2. Add these example steps:

| Step | Target                              |      Delay | Purpose                                         |
| ---- | ----------------------------------- | ---------: | ----------------------------------------------- |
| 1    | `Platform Primary On-Call` schedule |  0 minutes | Notify current primary immediately.             |
| 2    | Backup Responder user               |  5 minutes | Cover a missed acknowledgement or schedule gap. |
| 3    | `Platform Engineering` team         | 10 minutes | Broader escalation.                             |

3. Confirm the displayed order and delays.

The delay belongs to the step and is the wait before that step runs. Policies do not repeat after the final step in v1.3. The current add-step UI uses user notification preferences; it does not expose a new per-step channel selector. See [Escalation policies](../core-concepts/escalation-policies.md).

## 7. Create the service

1. Open **Services** and select **Create New Service**.
2. Use a unique name such as `Payment API - Docs Test`.
3. Select the owning team and escalation policy.
4. Optionally choose region and SLA tier.
5. Create the service, then open **Settings** to verify ownership and policy.

The tier label does not set the service's acknowledgement/resolution target minutes in the v1.3 settings UI. See [Services](../core-concepts/services.md).

## 8. Run a manual incident test

Coordinate the test with all recipients.

1. Open **Incidents → Create incident**.
2. Enter `TEST: Payment API response workflow`.
3. Select the test service, High urgency, and private visibility.
4. Create the incident.
5. Verify the incident timeline shows the first policy step and the expected current on-call user receives an in-app and configured external notification.
6. Let the second step execute once and verify its timing.
7. Acknowledge the incident and confirm no later step runs.
8. Add a note, assign/reassign it, then resolve with a resolution note.
9. Review Notification History and the event timeline.

If the test fails, keep the service out of production routing and use [Troubleshooting](../troubleshooting.md).

## 9. Add an inbound integration

1. Open **Service → Integrations**.
2. Select **Events API** for the simplest contract test or choose the production monitoring provider.
3. Enter a descriptive integration name and create it.
4. Copy the generated integration/routing key into secret storage.

Test Events API ingest:

```bash
curl --request POST "https://YOUR_OPSKNIGHT_HOST/api/events" \
  --header "Authorization: Token token=INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "event_action": "trigger",
    "dedup_key": "first-week/payment-api",
    "payload": {
      "summary": "TEST: integration routing",
      "source": "first-week-check",
      "severity": "warning"
    }
  }'
```

Confirm it creates a Medium-urgency incident for the correct service. Send a resolve with the same integration key and `dedup_key`:

```bash
curl --request POST "https://YOUR_OPSKNIGHT_HOST/api/events" \
  --header "Authorization: Token token=INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "event_action": "resolve",
    "dedup_key": "first-week/payment-api",
    "payload": {
      "summary": "TEST: integration routing recovered",
      "source": "first-week-check",
      "severity": "info"
    }
  }'
```

See the [Events API](../api/events.md) and [Integration catalog](../integrations/README.md).

## 10. Configure public communication intentionally

If you need a status page:

1. Open **Settings → Status Page**.
2. Add only approved services.
3. Review every privacy field.
4. Keep the page disabled while testing its preview.
5. Enable it, then inspect `/status` signed out and from outside your network.

Use a private synthetic incident to prove excluded data stays private, then a public synthetic incident to verify the approved display. See [Status page](../core-concepts/status-page.md).

## 11. Establish operating ownership

Before production, assign owners for:

- user onboarding/offboarding and Admin continuity;
- schedule coverage and override review;
- provider credentials and delivery failures;
- each service and inbound integration;
- status-page communication and subscribers;
- backups, upgrades, retention, audit review, and security response.

## First-week acceptance checklist

- [ ] Two active Admins can sign in and manage the workspace.
- [ ] Responders completed invitation and configured timezone/channels.
- [ ] Team ownership and notification participation are correct.
- [ ] Schedule has continuous expected coverage and a tested override.
- [ ] Policy reaches schedule, backup, and team targets at expected times.
- [ ] Manual incident acknowledge/resolve stops later escalation.
- [ ] Events API trigger and resolve reuse one incident.
- [ ] Notification History shows expected success/failure detail.
- [ ] Service ownership, SLA labels/limits, integrations, and status-page exposure are reviewed.
- [ ] Backup, upgrade, retention, and security owners are named.

## Continue learning

- [Core concepts](../core-concepts/README.md)
- [Deployment](../deployment/README.md)
- [Administration](../administration/README.md)
- [Security](../security/README.md)
- [Mobile](../mobile/README.md)
