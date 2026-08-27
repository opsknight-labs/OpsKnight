---
title: First Steps
description: Turn the verified first incident into a production-ready team, paging, integration, and communication setup.
order: 3
---

# First Steps

Use this guide after completing [Getting Started](./README). Getting Started proves the shortest core path. This guide turns that working path into a setup suitable for a real team.

Use synthetic names and a non-production service until paging, routing, and public communication are verified.

## What you will build

```text
responders → team → schedule → escalation policy → service
                                             ↘ integration → incident
service + policy + providers → verified responder notification
```

## 1. Secure administration

On a new installation, `/setup` is available only while no user exists.

After creating the first Admin:

1. Sign in with the generated temporary password.
2. Open **Settings → Security** and change it.
3. Store recovery information securely.
4. Create a second Admin before production so administration does not depend on one account.

Use Admin access for workspace governance, not simply to make paging work.

## 2. Configure an external notification provider

In-app notifications are useful for validation, but production on-call paging should use at least one external provider.

1. Open **Settings → Notification Providers**.
2. Configure and enable a provider. Email is a practical first test.
3. Open your personal **Settings → Notifications**.
4. Enable the matching channel and add any required destination data.
5. Do not treat a successful provider save as proof of delivery; verify delivery with a test incident later in this guide.

See [Notifications](../administration/notifications).

## 3. Invite responders

1. Open **Users**.
2. Invite at least one additional person as **Responder**.
3. Deliver the invitation link through an appropriate secure channel.
4. Have the responder sign in, set a password, select a timezone, and enable a notification channel.

Use **User** for standard read-oriented access, **Responder** for incident/on-call work, and **Admin** for workspace governance.

## 4. Create the owning team

1. Open **Teams** and create a team such as `Platform Engineering`.
2. Add active responders.
3. Assign appropriate Team Owners.
4. Optionally select a Team Lead.
5. Confirm that people expected to receive team-targeted pages are configured to receive team notifications.

Application roles and team roles are separate concepts. See [Teams](../core-concepts/teams).

## 5. Create and verify the on-call schedule

Create the schedule before the escalation policy so it is available as a policy target.

1. Open **Schedules** and create `Platform Primary On-Call`.
2. Select the team's authoritative IANA timezone.
3. Add a primary rotation layer covering the current time.
4. Add responders in rotation order.
5. Inspect the current on-call responder and next handoff.
6. Create a short test override, verify effective coverage changes, then remove it.

Do not continue with an empty layer, expired layer, coverage warning, or unexpected current responder. See [On-call schedules](../core-concepts/schedules).

## 6. Create the escalation policy

Create `Platform Service Escalation` with a simple staged path. For example:

| Step | Target | Delay | Purpose |
| --- | --- | ---: | --- |
| 1 | `Platform Primary On-Call` schedule | 0 min | Page the current primary immediately. |
| 2 | Backup responder | 5 min | Cover a missed acknowledgement. |
| 3 | `Platform Engineering` team | 10 min | Broaden escalation. |

Confirm the displayed order and delays before attaching the policy to a production service. See [Escalation policies](../core-concepts/escalation-policies).

## 7. Create the service

1. Open **Services** → **Create New Service**.
2. Use a clear name such as `Payment API - Validation`.
3. Select the owning team and escalation policy.
4. Optionally choose region and SLA tier.
5. Create the service and verify the ownership and policy from its settings.

See [Services](../core-concepts/services).

## 8. Verify paging with a manual incident

Coordinate the test with all recipients before sending external pages.

1. Open **Incidents → Create Incident**.
2. Enter `TEST: Payment API response workflow`.
3. Select the validation service, High urgency, and private visibility.
4. Create the incident.
5. Verify the expected responder receives the configured notification.
6. Allow the second escalation step to execute once and verify timing.
7. Acknowledge the incident and confirm later escalation stops.
8. Add a note, assign or reassign the incident, then resolve it with a resolution note.
9. Review Notification History and the incident timeline.

If notification delivery or escalation behavior is not correct, keep the service out of production routing until the problem is resolved.

## 9. Verify inbound integration routing

Open the service's **Integrations** page and create an **Events API** integration or the monitoring integration you intend to use.

For a contract test, send a trigger:

```bash
curl --request POST "https://YOUR_OPSKNIGHT_HOST/api/events" \
  --header "Authorization: Token token=INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "event_action": "trigger",
    "dedup_key": "first-steps/payment-api",
    "payload": {
      "summary": "TEST: integration routing",
      "source": "first-steps-check",
      "severity": "warning"
    }
  }'
```

Confirm it reaches the correct service. Resolve it with the same integration key and `dedup_key`:

```bash
curl --request POST "https://YOUR_OPSKNIGHT_HOST/api/events" \
  --header "Authorization: Token token=INTEGRATION_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "event_action": "resolve",
    "dedup_key": "first-steps/payment-api",
    "payload": {
      "summary": "TEST: integration routing recovered",
      "source": "first-steps-check",
      "severity": "info"
    }
  }'
```

Confirm trigger and resolve operate on the same incident. See the [Events API](../api/events).

## 10. Configure public communication intentionally

If you need a public status page:

1. Open **Settings → Status Page**.
2. Add only approved services.
3. Review privacy and visibility fields.
4. Keep the page disabled while validating the preview.
5. Enable it only after verifying the public view while signed out.

Use private synthetic incidents to prove excluded data stays private before testing approved public communication. See [Status page](../core-concepts/status-page).

## 11. Assign operational ownership

Before production, assign explicit owners for:

- user onboarding, offboarding, and Admin continuity;
- schedule coverage and override review;
- provider credentials and delivery failures;
- services and inbound integrations;
- status-page communication;
- backups, upgrades, retention, audit review, and security response.

## Production-readiness checklist

- [ ] Two Admins can administer the workspace.
- [ ] Responders have completed onboarding and configured timezone and notification channels.
- [ ] Team ownership and notification participation are correct.
- [ ] Schedule coverage is continuous and an override has been tested.
- [ ] Escalation reaches the expected targets at the expected times.
- [ ] Acknowledging an incident stops later escalation.
- [ ] Events API trigger and resolve reuse one incident.
- [ ] External notification delivery has been verified with a real test.
- [ ] Service ownership, integrations, and public exposure have been reviewed.
- [ ] Backup, upgrade, retention, and security responsibilities have owners.

Once this checklist passes, move the validated service and integrations into production use.
