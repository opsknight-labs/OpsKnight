---
title: Configure Microsoft Teams war rooms
description: Enable consented channel creation, lifecycle management, and membership sync.
type: how-to
product_area: chatops
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/microsoft-teams/app-manifest.ts, src/lib/war-room/providers/microsoft-teams/adapter.ts]
---

# Configure Microsoft Teams war rooms

## Before you begin

Complete the base Teams installation and obtain permission to grant optional
resource-specific consent in the target team.

War rooms require additional resource-specific consent beyond ordinary card
delivery. Enable war-room permissions in the generated package, reinstall or
update it in the target team, then select the war-room destination for the
service.

In a provisioned incident channel, the card can include the video bridge and
the actions available to the signed-in responder.

![OpsKnight Microsoft Teams incident war room with an Adaptive Card, video bridge, and responder actions](/docs/v2.0.0/assets/teams-chatops-war-room.png)

1. Enable war-room permissions in the generated application package.
2. Reinstall or update the package in the target team.
3. Select the service destination that owns automatic war-room behavior.
4. Create a test incident room and verify its lifecycle.

Channel creation needs `Channel.Create.Group` and
`TeamsAppInstallation.Read.Group`. Lifecycle and membership features add
`ChannelSettings.ReadWrite.Group`, `TeamMember.Read.Group`,
`ChannelMember.Read.Group`, and `ChannelMember.ReadWrite.Group`.

Verify creation, marker reconciliation, membership synchronization, message
projection, and terminal cleanup before production use.
