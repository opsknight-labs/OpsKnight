---
title: Configure the global ChatOps and war-room policy
description: Connect provider readiness to automatic war-room triggers, naming, lifecycle, and video bridges.
type: how-to
product_area: chatops
audience: [administrator]
reader: { status: READER_COMPLETE, task: Configure and verify the workspace ChatOps policy. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/settings/integrations/chatops/page.tsx", "src/components/settings/ChatOpsSettingsPage.tsx", "src/app/(app)/settings/integrations/chatops/actions.ts"]
---

# Configure the global ChatOps and war-room policy

## Before you begin

Connect and test Slack, Microsoft Teams, or both. For Teams war rooms, enable war rooms and at least one destination. Decide which incident priorities/urgencies justify automatic room creation and who owns room closure.

## Open the feature

Open **Settings → Integrations → ChatOps** as an administrator. Provider cards show actual connection/readiness; saving policy does not connect a provider.

## Configure the policy

1. Enable **War Room Provisioning** only after provider tests pass.
2. Choose **Slack**, **Microsoft Teams**, or **Both** as the default provider set.
3. Enter a short channel prefix such as `inc`; OpsKnight adds incident-derived identity.
4. Select automatic creation priorities (`P1`–`P5`) and/or urgencies (`HIGH`, `MEDIUM`, `LOW`). Empty selections mean manual creation.
5. Decide whether resolution automatically closes/archives collaboration.
6. Choose Teams Meeting, Jitsi, Zoom, Google Meet, or no video bridge.
7. For static/template bridge providers, enter a valid provider URL/template. Leave Teams/Jitsi empty when using their documented automatic behavior.
8. Save changes and confirm the hero summary reflects triggers, prefix, bridge, and lifecycle.

## What OpsKnight does

The global policy determines provider requests and defaults. Service-level overrides can narrow or replace behavior. A provider conflict or disconnected provider prevents successful provisioning rather than silently creating a different room. War-room operations remain auditable and tied to the incident.

## Verify the policy

Create a synthetic incident matching exactly one configured trigger. Confirm the expected provider room(s), normalized name, incident card, bridge link, responder actions, and resolution-close behavior. Then create a nonmatching incident and confirm no automatic room is requested.

## Change or undo

Turn off provisioning to stop new automatic/manual requests; existing provider rooms are not retroactively deleted. Remove triggers for manual-only behavior. Disable automatic closure before changing provider retention procedures.

## Troubleshooting

- **No room:** check global enablement, trigger match, provider connection, Teams destination readiness, and service override.
- **Two rooms unexpectedly:** default is **Both** or a service override requests both.
- **Invalid bridge:** correct the URL/template or use `NONE`; never publish credentials in it.
- **Configuration conflict:** reconcile global and service policies explicitly, then retest.

## Next steps

- [Create a war room](./create-war-room)
- [Slack war rooms](../../integrations/communication/slack/war-rooms)
- [Teams war rooms](../../integrations/communication/microsoft-teams/war-rooms)
