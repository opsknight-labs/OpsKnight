---
title: Microsoft Teams permissions
order: 3
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

Permissions are split between Bot Framework installation context and Microsoft
Graph resource-specific consent (RSC). OpsKnight requests the Graph
`https://graph.microsoft.com/.default` scope; the installed package determines
which application RSC permissions exist in each Team.

## Base package

`ChannelSettings.Read.Group` is required to discover channels for the
destination picker. Ordinary incident Adaptive Cards are sent through Bot
Framework Connector transport using the installation service URL and bot
recipient identity. OpsKnight therefore does not request
`ChannelMessage.Send.Group` for routine card delivery.

## Optional feature permissions

| Capability | Permission | Why OpsKnight needs it |
| --- | --- | --- |
| Read Team settings | `TeamSettings.Read.Group` | Read Team metadata required by optional operational surfaces |
| Create a war-room channel | `Channel.Create.Group` | Provision an incident-scoped channel |
| Verify installed-app consent | `TeamsAppInstallation.Read.Group` | Inspect the exact Team installation's granted permission set before provisioning |
| Rename/update/archive a war room | `ChannelSettings.ReadWrite.Group` | Manage the channel lifecycle after creation |
| Read Team members | `TeamMember.Read.Group` | Resolve approved participants from the owning Team |
| Read channel members | `ChannelMember.Read.Group` | Reconcile actual incident-channel participation |
| Add/remove channel members | `ChannelMember.ReadWrite.Group` | Manage war-room membership when that automation is enabled |

## Consent boundaries

RSC is granted by installing/consenting to the app in a specific Team. An app
uploaded to the tenant catalog or installed in a different Team does not prove
the target Team granted the permissions. Generate the package only after
selecting the OpsKnight features you intend to enable, install that exact
package in every target Team, and review the consent prompt.

Do not enable war-room automation based only on `Channel.Create.Group`.
OpsKnight also needs `TeamsAppInstallation.Read.Group` to verify consent;
lifecycle and membership automation need their corresponding permissions.

## Verify permission health

1. In OpsKnight, confirm the detected installation belongs to the expected
   tenant and Team.
2. Review granted RSC permissions and missing-capability messages.
3. Test routine card delivery independently of Graph channel management.
4. Create and close a disposable war room when that feature is enabled.
5. Add/remove a pilot participant only when membership automation is approved.

After changing the manifest or enabled feature set, upload/install the newly
generated package and repeat verification. Existing installation consent does
not automatically expand when a local checkbox changes.

## Troubleshooting

**Routine cards work but Team/channel discovery fails:** check
`ChannelSettings.Read.Group` on the target Team installation.

**Channel creation returns `403`:** verify `Channel.Create.Group` and
`TeamsAppInstallation.Read.Group` were consented through the installed package.

**Creation works but rename/archive fails:** add
`ChannelSettings.ReadWrite.Group`, reinstall, and reconfirm consent.

**Membership does not reconcile:** verify the Team/channel read permissions and
`ChannelMember.ReadWrite.Group`; then check that the responder can be resolved
to a Microsoft identity in the same tenant.

## Related pages

- [Complete Microsoft Teams setup](./connect)
- [Configure destinations](./configure-destinations)
- [Configure war rooms](./war-rooms)
