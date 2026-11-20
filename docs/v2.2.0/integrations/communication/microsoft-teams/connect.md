---
title: Connect and configure Microsoft Teams ChatOps
order: 2
description: Configure Microsoft Entra, Azure Bot, the Teams app package, consent, destinations, actions, and war rooms end to end.
type: how-to
product_area: chatops
audience: [administrator, operator]
keywords: [connect Teams, Microsoft 365 setup, Azure Bot, Entra app, Teams app package, Teams ChatOps]
reader:
  status: READER_COMPLETE
  task: Configure and validate Microsoft Teams ChatOps from Microsoft 365 through production incident workflows.
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/lib/microsoft-teams/app-manifest.ts
    - src/components/settings/microsoft-teams/MicrosoftTeamsSetupWizard.tsx
    - src/app/(app)/settings/integrations/microsoft-teams/actions.ts
    - src/app/api/microsoft-teams/messages/route.ts
    - src/lib/microsoft-teams/capabilities.ts
    - src/lib/microsoft-teams/invoke.ts
---

# Connect and configure Microsoft Teams ChatOps

This is the complete single-tenant Microsoft 365 journey: Entra application,
Azure Bot, Teams package and consent, OpsKnight credentials, channel routing,
identity-linked actions, and optional war rooms/video bridges.

## Before you begin

- Use an OpsKnight administrator account.
- Obtain permission to create an Entra app registration, client secret, Azure
  Bot resource, and Teams custom application in the target tenant.
- Set OpsKnight's public HTTPS origin correctly and allow Microsoft Bot traffic
  to reach `/api/microsoft-teams/messages` without interactive authentication.
- Record the Microsoft Entra **Directory (tenant) ID** and decide which Team and
  channel will be used for non-production validation.
- Decide whether only routine incident cards are required or whether war-room
  creation, lifecycle, participant management, and video bridges are approved.
- Name owners for the Entra app, bot resource, secret rotation, Teams package,
  consent, routing, and ChatOps fallback.

## Open the feature

Open **Settings → Integrations → Microsoft Teams**. Follow the displayed setup
wizard in order. OpsKnight 2.0 currently requires **SINGLE** tenant mode.

## Register the Microsoft Entra application

1. In the Microsoft Entra admin center, open **App registrations → New
   registration**.
2. Name it clearly, for example `OpsKnight Teams Bot - Production`.
3. Select **Accounts in this organizational directory only (Single tenant)**.
4. Register the application. Record the **Application (client) ID** and
   **Directory (tenant) ID**; both must be GUIDs.
5. Under **Certificates & secrets**, create a client secret with the shortest
   practical approved lifetime. Copy its **Value** immediately—the secret ID is
   not the credential.
6. If your tenant requires an Application ID URI, align it with the
   `webApplicationInfo.resource` in the generated OpsKnight manifest. By
   default this is `api://YOUR_OPSKNIGHT_HOST/CLIENT_ID` for a public host.
7. In OpsKnight, enter client ID, tenant ID, and secret value. Optionally set a
   default meeting organizer UPN for video bridges when an incident assignee
   has no linked Microsoft identity.
8. Select whether interactive actions and war rooms are enabled, then save.

OpsKnight encrypts the client secret. Changing client ID or tenant identity is
not an ordinary secret rotation: it invalidates stale installations,
destinations, tokens, queued delivery, and war-room assumptions.

## Configure Azure Bot

1. Create or select an Azure Bot resource associated with the same Entra
   application/client ID.
2. In **Configuration**, set the messaging endpoint to the exact value shown by
   OpsKnight:

   ```text
   https://YOUR_OPSKNIGHT_HOST/api/microsoft-teams/messages
   ```

3. Enable the **Microsoft Teams** channel on the Bot resource.
4. Save and confirm the endpoint is publicly reachable with valid TLS.

The messaging endpoint receives installations, Adaptive Card invokes, and
other Bot Framework activities. OpsKnight validates Bot authentication,
tenant/application identity, trusted service URL, activity context, identity,
authorization, and action schema before changing an incident.

## Choose and consent permissions

The generated package always requests `ChannelSettings.Read.Group` for
team/channel discovery. Routine cards are sent using Bot Framework Connector
transport, not Graph `ChannelMessage.Send.Group`.

Optional features add resource-specific consent (RSC):

| Feature | RSC permission |
| --- | --- |
| Read team settings | `TeamSettings.Read.Group` |
| Create war-room channels | `Channel.Create.Group` |
| Verify app installation consent | `TeamsAppInstallation.Read.Group` |
| Update/archive channel settings | `ChannelSettings.ReadWrite.Group` |
| Read team/channel membership | `TeamMember.Read.Group`, `ChannelMember.Read.Group` |
| Manage war-room membership | `ChannelMember.ReadWrite.Group` |

Server-side Graph access uses the application `.default` scope and the consent
represented by the installed Teams package. Generate a package for only the
features you intend to operate. Consent is team/resource-specific; installing
the app elsewhere does not prove the target Team granted the same RSC set.

## Install the Teams application package

1. Download the preconfigured `.zip` package from OpsKnight. It contains the
   client/bot ID, valid OpsKnight domain, icons, bot scope, and selected RSC
   permissions.
2. For governed production rollout, upload it through **Teams admin center →
   Teams apps → Manage apps → Upload new app**, approve it, and apply the
   required app policies.
3. For an approved pilot, use **Apps → Manage your apps → Upload a custom app**
   in Teams when tenant policy allows sideloading.
4. Add/install the app in the exact Team that will host the test destination.
   Approve the displayed resource-specific permissions deliberately.
5. Return to OpsKnight and confirm an enabled installation with tenant, Team,
   bot recipient, service URL, and granted permissions is detected.

Uploading the package to the tenant catalog is not the same as installing it
into a Team. OpsKnight needs the Team installation activity to learn the safe
Bot Connector routing context.

## Configure service destinations

1. Open **Services → select service → Notifications → Microsoft Teams**.
2. Enable Teams and select a discovered Team and channel.
3. Add up to three destinations. Every active destination receives lifecycle
   cards; they are not ordered fallbacks.
4. Choose at most one destination as the automatic war-room owner for that
   service.
5. Save and send a real test Adaptive Card to every destination.

## Configure identities and incident actions

1. Ask a pilot responder to [link their Microsoft Teams identity](./identity-linking).
2. Confirm an unlinked Teams user receives the linking flow.
3. Exercise a permitted action such as acknowledge or assign-to-me.
4. Confirm an unauthorized user is denied and a stale card cannot bypass the
   current OpsKnight incident state.
5. Verify the OpsKnight timeline attributes the correct actor and all cards
   converge after the change.

## Configure war rooms and video bridges

Enable war rooms only after the installed Team grants channel creation,
lifecycle, and any selected membership RSC permissions. Configure global and
service policy, pick the owning destination, and decide whether creation is
manual or automatic. If video bridges are enabled, ensure the organizer UPN is
licensed/allowed to create online meetings and is either linked from the
incident assignee or configured as the default.

Test provisioning, duplicate avoidance, context card, participant handling,
meeting link, rename/update behavior, closure/archive, and reconciliation after
an ambiguous Graph result.

## Verify the complete workflow

1. Trigger a synthetic incident on the configured service.
2. Confirm exactly one Adaptive Card reaches each mapped destination.
3. Acknowledge, assign/escalate, add a safe note, and resolve from supported
   surfaces.
4. Confirm OpsKnight state, timeline actor, and every Teams card converge.
5. Create and close a test war room when enabled; verify channel and membership
   state in both Teams and OpsKnight operations.
6. Inspect delivery/provider operations and Teams integration health for
   terminal results, retries, missing consent, or cleanup debt.

## What OpsKnight does

OpsKnight encrypts the Entra client secret, validates Bot Framework activities,
binds installations and destinations to the configured tenant, and stores
durable delivery/activity identities. Adaptive Card actions still pass identity,
authorization, policy, and current incident-state checks. Graph channel and
membership operations are preflighted against the RSC consent detected for the
specific Team; ambiguous provider results are retained for reconciliation
rather than assumed successful or blindly repeated.

## Production acceptance checklist

- Entra client ID and tenant ID belong to the intended tenant
- Client secret ownership and expiry alert documented
- Azure Bot uses the exact public messaging endpoint and Teams channel
- Approved package version installed in every target Team
- Required and optional RSC permissions match enabled features
- Every production destination tested individually
- Allowed and denied responder actions tested
- Trigger-through-resolution Adaptive Cards converge without duplicates
- War-room/video/cleanup lifecycle tested when enabled
- Rotation, disconnect, tenant change, and fallback runbooks owned

## Change or undo it

For secret rotation, create a replacement secret, update OpsKnight, test every
destination/action, and then revoke the old secret. For manifest permission or
package changes, increment/install the generated package and revalidate consent
per target Team. Before disabling or changing tenant/client identity, disable
routing, inventory open war rooms and queued operations, and follow the
disconnect/reconciliation workflow.

## Troubleshooting

**Installation is not detected:** verify tenant/client IDs, package bot ID,
actual installation in the Team, Teams app policy, and messaging endpoint.

**Team or channel is missing:** verify the app installation and
`ChannelSettings.Read.Group` consent in that specific Team.

**Cards do not arrive:** inspect the stored installation service URL, bot
recipient ID, Azure Bot Teams channel, client secret, trusted Connector host,
and OpsKnight provider result.

**Card arrives but actions fail:** verify interactive ChatOps is enabled,
identity linking, tenant/activity context, product permission, and current
incident state.

**War-room creation returns forbidden:** confirm `Channel.Create.Group` and
`TeamsAppInstallation.Read.Group` on the owning Team. Lifecycle and membership
features require their additional RSC permissions.

**Meeting creation fails:** verify the organizer UPN, Microsoft identity link,
licensing/policy, tenant, and Graph application consent.

## Next steps

- [Microsoft Teams permissions](./permissions)
- [Configure destinations](./configure-destinations)
- [Send a test](./send-test)
- [Link identities](./identity-linking)
- [Configure war rooms](./war-rooms)
- [Troubleshoot Microsoft Teams](./troubleshooting)
- [Disconnect or reconnect](./disconnect-reconnect)
