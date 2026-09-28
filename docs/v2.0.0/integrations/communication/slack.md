---
title: Slack
description: Configure Slack destinations, incident messages, and war rooms.
type: integration
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/slack/app-manifest.ts
    - src/lib/war-room/providers/slack/adapter.ts
---

# Slack

Slack supports configured destinations and provider-backed incident war rooms.
Install the app with the generated manifest or configured OAuth flow, verify the
workspace, map destinations to services, and test with a synthetic incident.

For the complete workflow, use the [Slack ChatOps guide](./slack/), including
OAuth, scopes, service channels, incident actions, identity linking, war rooms,
and symptom-based troubleshooting.

## Link service destinations

Open **Services → your service → Notifications**, enable Slack, and link as many
as three workspace channels. Each linked channel receives the service's Slack
incident lifecycle messages; it is not a fallback chain. Use **Test** beside
each destination before saving the service configuration. Remove an obsolete
destination before attempting to add a fourth.

The destination channel, an automatically provisioned incident war room, and a
user's Slack identity are separate records. Linking a service channel does not
create a war room or authorize interactive actions for an unlinked user.

## Validate interactive behavior

Trigger a synthetic incident and confirm that every linked destination receives
one message. Acknowledge or resolve from Slack, then verify both the OpsKnight
timeline and the existing Slack message update. Link the responder identity when
prompted; do not share another responder's identity-link URL.

The integration must validate Slack signatures and timestamps for inbound
requests. Store bot and signing secrets encrypted. Confirm message projection,
interactive actions, participant reconciliation, and terminal room cleanup.

When diagnosing a failure, separate OAuth installation, destination mapping,
provider API response, identity linking, and war-room lifecycle state.
