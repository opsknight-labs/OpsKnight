---
title: Create and operate an incident war room
description: Provision, verify, reconcile, and close an incident-scoped Slack or Microsoft Teams room.
type: how-to
product_area: chatops
audience: [responder, administrator]
reader:
  status: READER_COMPLETE
  task: Create, verify, reconcile, and close a provider-backed incident war room.
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/war-room/engine.ts
    - src/lib/war-room/reconcile.ts
---

# Create and operate an incident war room

## Before you begin

Connect Slack or Microsoft Teams, configure a destination, and create an active
test incident. Confirm the responder can read the incident and use collaboration
actions. Automatic creation also requires an owning destination in the global or
service ChatOps policy.

## Open the feature

Open **Incidents → select incident** and locate the **Create war room** launcher in the incident command bar.

## Configure manual or automatic creation

- **Manual:** a responder opens an incident and explicitly creates the room.
  Use this when only selected incidents require a dedicated channel.
- **Automatic:** the effective global/service policy creates a room when a
  qualifying incident begins. Only one destination should own automatic room
  creation for a service.

Service policy overrides the global default. Test the effective policy with a
new incident; changing it does not migrate an already provisioned room.

## Verify the room

1. Open the incident command bar and select **Create war room**.
2. Select the provider (Slack or Microsoft Teams) in the creation dialog, then confirm creation.
3. Wait for provisioning to finish. Do not retry while the operation is still
   pending; durable operation and provider markers prevent duplicate rooms.
4. Open the returned provider URL and confirm incident title, urgency, service,
   assignee, status, and optional video bridge are correct.
5. Verify intended responders can enter the room and that provider identity
   links resolve for interactive actions.
6. Exercise one safe action, such as acknowledge or assign to me, and confirm
   both the incident and provider card update.

## Operate during the incident

Treat OpsKnight as authoritative for incident state. Provider messages and cards
project that state; manual channel edits do not replace incident actions. Use
the room for coordination, pin or update incident context through supported
controls, and keep sensitive credentials out of chat history.

Participant synchronization depends on provider permissions, bot/app access,
and identity availability. A missing participant should be investigated rather
than worked around by repeatedly creating rooms.

## How synchronization works

OpsKnight stores the durable provider room and operation identity, projects
incident state, and reconciles supported membership, messages, and cleanup.

## Reconcile drift and avoid duplicates

If the provider room was renamed, membership changed, a card is stale, or a
request timed out, inspect collaboration health and the existing operation/room
identifier first. Run reconciliation or retry the recorded operation. Do not
delete the remote room and immediately create another: the first request may
have succeeded even when its response was lost.

## Remove or close the room

Resolve the incident according to the response workflow, then use the OpsKnight
collaboration control to close/archive the room. Verify terminal context is
published and provider cleanup reaches a terminal state. Provider capabilities
and policy determine whether the channel is archived, retained, or otherwise
closed; do not assume manual deletion is equivalent.

## Troubleshooting

- **Creation forbidden:** verify destination, app installation, scopes/RSC, and
  public/private-channel permission.
- **Action rejected:** link the provider identity and confirm product role and
  incident authorization.
- **Members missing:** verify provider directory availability and membership
  read/write permission.
- **Ambiguous or timed-out create:** inspect the durable operation and remote
  marker before retrying.
- **Closure incomplete:** reconcile from OpsKnight and inspect provider response;
  do not erase the remote channel as the first repair step.

## Next steps

Provider details:

- [Slack war rooms](../../integrations/communication/slack/war-rooms)
- [Microsoft Teams war rooms](../../integrations/communication/microsoft-teams/war-rooms)
- [Configure global ChatOps policy](./configure-global-policy)
