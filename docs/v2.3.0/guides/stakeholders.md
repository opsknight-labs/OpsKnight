---
title: Keep stakeholders informed
description: Give business people a read-only view of business impact, subscribe them by team, and send them plain-language updates during an incident without ever paging them.
type: how-to
product_area: services
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/lib/authorization.ts
    - src/lib/access/server.ts
    - src/lib/escalation/target-resolution.ts
    - src/lib/business-services/stakeholder-comms.ts
    - src/emails/templates/stakeholder-update.tsx
    - src/components/incident/detail/NotifyStakeholdersButton.tsx
    - src/app/api/v2/incidents/[id]/stakeholder-notify/route.ts
---

# Keep stakeholders informed

Support leads, account managers and executives need to know when Checkout is down, not which
pod restarted. OpsKnight gives them the **Stakeholder** role, subscriptions to
[business services](./services/business-services), and updates you send from the incident.

## The Stakeholder role

An administrator sets it in **Users → Edit → Role**, or maps it from your identity provider (SSO
role rules and SCIM). Stakeholders can:

- see the internal status dashboard (`/status-dashboard`), which is where they land after sign-in;
- see business services in their teams and follow them;
- manage their own profile and notification preferences.

They cannot:

- open incidents, incident lists or anything that shows incident details. Pages that would
  load incidents send them to the status dashboard, and the access-denied page explains why;
- be paged. A stakeholder cannot be an escalation target, on call in a schedule layer, take an
  on-call override, be assigned an incident or hold an incident role. If a team is an escalation
  target, its stakeholders are skipped.

Changing someone already on call to Stakeholder does not remove them from schedules; they are
skipped when an escalation fires. Move their shifts first.

## Subscribe people to a business service

People hear about a business service when they:

- **follow** it themselves, from the business service page;
- are in a **team that subscribes** to it. Team members who turned off team notifications are
  skipped;
- were added by **Subscribe all users**, which makes everyone active today a follower. People who
  join later are not added, and anyone can unfollow.

Set teams and "subscribe all" in the [setup wizard](./services/business-service-import#set-up-one-business-service).

Followers automatically get plain-language in-app messages when an incident affecting the
business service starts, is picked up and is resolved.

## Send an update during an incident

On the incident, next to **Impacts**, choose **Notify stakeholders**:

1. Pick the stage: Investigating, Identified, Monitoring or Resolved. A message template with
   the business service names fills in.
2. Edit the message in plain language. Say what customers notice and when the next update is.
3. **Send update**.

Followers and subscribed team members of the impacted business services get an email and an
in-app notification. It is never a page: it uses the status-page delivery class and never rings
a phone. You need to be able to add notes to the incident.

To keep inboxes calm, an incident can send at most 3 stakeholder updates every 10 minutes. Every
update is in the audit log with its stage, business services and number of people reached.

The REST equivalent is `POST /api/v2/incidents/{id}/stakeholder-notify` with
`{ "phase": "identified", "message": "..." }`. Send an `Idempotency-Key` so a retry never sends
twice.

## Related

- [Business services](./services/business-services)
- [Import and set up business services](./services/business-service-import)
- [Status page layouts](./status-pages/business-service-layouts)
