---
title: Microsoft Teams permissions
description: Review base and optional Teams resource-specific consent permissions.
type: reference
product_area: chatops
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/microsoft-teams/app-manifest.ts]
---

# Microsoft Teams permissions

Base team and channel discovery requires `ChannelSettings.Read.Group`.
OpsKnight requests the Microsoft Graph `.default` scope and sends ordinary
incident cards using Bot Framework Connector transport.

War-room consent is explicitly optional. See
[Configure Microsoft Teams war rooms](./war-rooms) for the additional channel
lifecycle and membership permissions. Grant only the feature set you intend to
operate.
