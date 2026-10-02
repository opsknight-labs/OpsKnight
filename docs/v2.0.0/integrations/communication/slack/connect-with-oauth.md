---
title: Connect and configure Slack ChatOps
order: 2
description: Create the Slack app, configure every callback and permission, connect OAuth, route services, and verify ChatOps end to end.
type: how-to
product_area: chatops
audience: [administrator, operator]
keywords: [slack oauth, connect slack, Slack app manifest, Slack ChatOps setup, rotate Slack credential]
reader:
  status: READER_COMPLETE
  task: Configure and validate Slack ChatOps from the Slack app through production incident workflows.
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/lib/slack/app-manifest.ts
    - src/components/settings/GuidedSlackSetup.tsx
    - src/components/settings/SlackManifestCard.tsx
    - src/app/api/slack/oauth/route.ts
    - src/app/api/slack/oauth/callback/route.ts
    - src/app/api/slack/actions/route.ts
    - src/app/api/slack/events/route.ts
    - src/app/api/slack/commands/route.ts
---

# Connect and configure Slack ChatOps

This is the complete administrator journey from a new Slack application to a
verified OpsKnight incident workflow. A successful OAuth callback alone is not
production acceptance.

## Before you begin

- Use an OpsKnight administrator account and a Slack account permitted to create
  and install apps in the target workspace.
- Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the same public HTTPS origin.
- Confirm Slack can reach that origin without private DNS, VPN, or an
  authentication proxy intercepting `/api/slack/*`.
- Decide whether private-channel support is required; it adds optional scopes.
- Create a non-production Slack channel and synthetic OpsKnight service.
- Name owners for the app, secrets, routing, and incident fallback.

## Open the feature

Open **Settings → Integrations → Slack**. Use the guided setup and manifest from
this deployment, not callback URLs copied from another environment.

## Create the Slack application

1. Copy the generated Slack app manifest from OpsKnight.
2. In the Slack API console, select **Create New App → From a manifest**.
3. Select the intended workspace, paste the manifest, review it, and create the
   app. Stop if the workspace is wrong.
4. Under **Basic Information → App Credentials**, record the numeric **Client
   ID**, reveal and copy the **Client Secret**, and copy the separate **Signing
   Secret**. Do not use a Workspace ID beginning with `T` or App ID beginning
   with `A` as the Client ID.
5. Enter all three values in OpsKnight and save. Stored secrets are encrypted.
   `SLACK_SIGNING_SECRET` can act as an environment override; operate one
   documented source of truth.

The manifest configures:

| Slack setting | OpsKnight endpoint |
| --- | --- |
| OAuth redirect URL | `https://YOUR_HOST/api/slack/oauth/callback` |
| Interactivity request URL | `https://YOUR_HOST/api/slack/actions` |
| Event subscription request URL | `https://YOUR_HOST/api/slack/events` |
| `/incident` request URL | `https://YOUR_HOST/api/slack/commands` |

It enables signed interactivity, `/incident`, and the `reaction_added`,
`app_uninstalled`, and `tokens_revoked` events. Manual setup must reproduce
every URL, event, and scope. OAuth, buttons, commands, and Events API can fail
independently.

## Review Slack permissions

Core ChatOps requires `chat:write`, `channels:read`, `channels:join`,
`channels:manage`, `channels:history`, `reactions:read`, `users:read`, and
`users:read.email`. Private coverage additionally uses `groups:read`,
`groups:write`, `groups:history`, `im:read`, and `mpim:read`.

`channels:manage` enables public war-room lifecycle; `users:read.email`
supports responder matching; and `reactions:read` with channel history supports
pin-to-note behavior. Grant optional scopes only when approved. Reinstall after
changing scopes, events, commands, or request URLs.

## Configure Slack OAuth

1. Select **Connect Slack** in OpsKnight.
2. Confirm the Slack authorization page names the intended workspace and scopes.
3. Select **Allow** with an authorized workspace administrator.
4. Return to OpsKnight and confirm the workspace is connected and required
   scopes are healthy.

## What OpsKnight does

OpsKnight validates OAuth state and encrypts the bot token. Workspace
authorization does not grant private-channel membership or create routing.
Signed Slack requests are timestamp-checked before identity resolution and
normal product authorization. Incident delivery is durable and later lifecycle
events update the stored provider projection rather than treating Slack as a
second incident database.

## Configure service delivery

1. Invite the app to private test channels; it can join eligible public channels.
2. Open **Services → select service → Notifications → Slack**.
3. Enable Slack and add up to three destinations. All active destinations
   receive lifecycle messages; they are not fallbacks.
4. Save and send a real test to every channel.
5. Configure global/service ChatOps and war-room policy only after routine
   delivery succeeds.

## Configure responder actions

1. Ask a pilot responder to [link their Slack identity](./user-identity-linking).
2. Confirm an unlinked user is prompted to link.
3. Use one permitted button and `/incident help`.
4. Confirm a user without product permission is denied.

Slack identity establishes the actor; OpsKnight authorization and current
incident state still decide whether an action is allowed.

## Verify the complete workflow

1. Trigger a synthetic incident on the configured service.
2. Confirm exactly one message reaches every mapped channel.
3. Acknowledge, assign where applicable, add a safe note, and resolve. Standard Slack actions do not expose manual escalation in 2.0.
4. Confirm existing Slack messages update and the OpsKnight timeline records the
   correct actor and transitions.
5. If enabled, create a war room and verify channel creation, topic, responders,
   context, optional meeting behavior, and closure.
6. When pin sync is in scope, add 📌 to a harmless message and verify the note.
7. Inspect OpsKnight delivery operations for provider and terminal outcomes.

## Production acceptance checklist

- Correct workspace and installing administrator
- Required scopes healthy; optional scopes justified
- OAuth, signed buttons, Events API, and `/incident` independently verified
- Every production destination tested
- Allowed and denied responder authorization tested
- Trigger-through-resolution cards converge without duplicates
- War-room lifecycle tested when enabled
- Rotation, revocation, disconnect, and fallback owners documented

## Change or undo it

For scope changes, update the manifest and reinstall/reconnect. For credential
rotation, update OpsKnight and test every destination before revoking the old
secret/app. To stop delivery, disable service routing, account for open war
rooms and queued operations, then disconnect and revoke deliberately.

## Troubleshooting

**OAuth reports an invalid client:** use the numeric Client ID and Client Secret
from **App Credentials**. The Client Secret and Signing Secret differ.

**Redirect URI mismatch:** copy the exact callback displayed by OpsKnight and
correct the public URL/proxy instead of registering an internal HTTP callback.

**Buttons or commands fail:** verify Signing Secret, clock, request URL,
TLS/proxy body handling, identity link, and product permission.

**Events fail while buttons work:** enable Event Subscriptions, verify the event
URL and bot events, then reinstall if required.

**Private channel missing:** grant approved optional scopes, reinstall, and
invite the app. Installation does not bypass private membership.

**Test works but incidents do not:** confirm the incident service and lifecycle
event/channel routing.

## Next steps

- [Slack permissions and scopes](./permissions-and-scopes)
- [Configure service channels](./configure-service-channels)
- [Send and verify a test](./send-test)
- [Configure war rooms](./war-rooms)
- [Troubleshoot Slack](./troubleshooting)
- [Disconnect or reconnect](./disconnect-reconnect)
