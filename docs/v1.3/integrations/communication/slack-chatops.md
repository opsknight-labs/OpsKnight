---
order: 3
title: Slack ChatOps & War Rooms
description: Open a dedicated Slack channel per incident, auto-invite responders, sync notes, and let responders act without leaving Slack
---

# Slack ChatOps & Incident War Rooms

When a qualifying incident is created, OpsKnight can open a dedicated Slack
channel, invite the on-call responders, post an incident command card, and keep
the channel in step with the incident until it is resolved and archived.

This page covers the whole setup. It takes about ten minutes.

---

## What you get

| Capability                | How it is used                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **War-room channel**      | A channel per incident, e.g. `#inc-104-payments-api`, created automatically for incidents that meet your threshold |
| **Auto-invite**           | On-call responders from the first three escalation steps, plus the assignee, are added to the channel              |
| **Incident command card** | Status, urgency, service and assignee, with one-click **Acknowledge**, **Assign to Me** and **Resolve** buttons    |
| **Video bridge**          | An optional Jitsi, Zoom or Google Meet link attached to the incident                                               |
| **Slash commands**        | `/incident ack`, `resolve`, `note`, `who`, `postmortem`, `help`                                                    |
| **📌 Emoji pin sync**     | React to any message with 📌 and it is saved as an incident note                                                   |
| **Auto-archive**          | The channel is archived when the incident resolves                                                                 |

---

## Step 1 — Create the Slack app from a manifest

The app needs a specific set of scopes, an events subscription and an
interactivity URL. Setting those by hand is easy to get wrong, so OpsKnight
generates a manifest containing all of it.

1. In OpsKnight, go to **Settings → Integrations → Slack**
2. Copy the **App Manifest** shown there — it is already filled in with your
   deployment's URLs
3. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
   **From a manifest**
4. Pick your workspace, paste the manifest, and create the app

??? note "Adding the manifest to an app that already exists"
Open your app → **App Manifest**, replace the contents, and save. Slack will
not grant newly added scopes to an existing installation until the app is
**reinstalled** — see step 4.

---

## Step 2 — Copy the credentials into OpsKnight

On the Slack app page, under **Basic Information → App Credentials**, you need
three values.

| Slack field        | Where it goes                   | Why                                                   |
| ------------------ | ------------------------------- | ----------------------------------------------------- |
| **Client ID**      | Settings → Integrations → Slack | Starts the OAuth flow                                 |
| **Client Secret**  | Settings → Integrations → Slack | Completes the OAuth flow                              |
| **Signing Secret** | Settings → Integrations → Slack | Verifies that inbound requests really came from Slack |

!!! warning "The signing secret is not optional"
OpsKnight **rejects** every slash command, button click and event unless it
can verify the request signature. Slack does **not** return this value during
OAuth — it is an app-level credential you must copy manually. If it is
missing or wrong, Slack features fail with `401` and the logs show
`Rejected unverified request`.

---

## Step 3 — Verify the endpoints

The manifest configures these automatically. If you set the app up by hand,
confirm all three under your Slack app:

| Setting                               | URL                                      |
| ------------------------------------- | ---------------------------------------- |
| **Interactivity & Shortcuts**         | `https://<your-host>/api/slack/actions`  |
| **Event Subscriptions** → Request URL | `https://<your-host>/api/slack/events`   |
| **Slash Commands** → `/incident`      | `https://<your-host>/api/slack/commands` |

Under **Event Subscriptions → Subscribe to bot events**, `reaction_added` must
be listed.

!!! danger "Interactivity and Events are separate settings"
These are configured independently, and it is easy to enable one and not the
other. If buttons work but 📌 pins do nothing, Event Subscriptions is the
reason. A verified Request URL with no subscribed bot events delivers
nothing while looking correct.

Slack verifies the Request URL by sending a signed challenge, so **enter the
signing secret (step 2) before saving it** — otherwise verification is rejected.

---

## Step 4 — Install to the workspace

Back in OpsKnight, **Settings → Integrations → Slack → Connect to Slack**, and
approve the permissions.

The **Scope Checklist** on that page then shows what the workspace actually
granted. It should report no missing scopes.

!!! note "Declared is not the same as granted"
Adding a scope to the Slack app only _declares_ it. The workspace grant is
fixed at install time, so after changing scopes you must **reinstall** for
them to take effect. Reconnecting cannot grant a scope the app does not
declare — update the manifest first, then reinstall.

### Scopes and what they are for

**Required**

| Scope              | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `chat:write`       | Post incident cards and updates                                         |
| `channels:read`    | List channels during service configuration                              |
| `channels:join`    | Join channels the bot was not invited to                                |
| `channels:manage`  | Create the war-room, set its topic, archive it                          |
| `channels:history` | Read a pinned message so it can be saved as a note                      |
| `reactions:read`   | Receive 📌 reactions                                                    |
| `users:read`       | Resolve Slack users for attribution                                     |
| `users:read.email` | Match Slack users to OpsKnight accounts, so responders are auto-invited |

**Optional** — `groups:read`, `groups:write`, `groups:history` add private
channel support; `im:read` and `mpim:read` cover direct messages.

---

## Step 5 — Choose when war rooms open

**Settings → Integrations → ChatOps**

| Setting                           | Meaning                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| **Enabled**                       | Master switch for war-room creation                          |
| **Urgency / Priority thresholds** | Which incidents open a channel automatically                 |
| **Channel prefix**                | Defaults to `inc`, producing `#inc-104-payments-api`         |
| **Archive on resolve**            | Archive the channel automatically when the incident resolves |
| **Default video bridge**          | `JITSI`, `ZOOM`, `GOOGLE_MEET` or `NONE`                     |

Each service can override auto-creation and the video bridge under **Service →
Settings → ChatOps & War Room**.

These thresholds govern **automatic** creation only. The **Create War-Room**
button on an incident always works, whatever the urgency — likewise **Archive**
is not blocked by the _archive on resolve_ setting.

!!! note "Zoom needs a meeting URL"
Jitsi and Google Meet links are generated per incident. Zoom requires a
static meeting URL in the custom template field; without one, no bridge link
is attached.

---

## Using it

### Slash commands

| Command                       | Effect                                       |
| ----------------------------- | -------------------------------------------- |
| `/incident ack`               | Acknowledge and stop the escalation chain    |
| `/incident resolve [summary]` | Resolve, with the summary recorded as a note |
| `/incident note <message>`    | Add a note to the timeline                   |
| `/incident who`               | Show the current on-call responders          |
| `/incident postmortem`        | Create a postmortem draft from the timeline  |
| `/incident help`              | List the commands                            |

These work inside a war-room channel, which is how the incident is identified.

### Pinning messages

React to any message in a war-room channel with 📌 and it is saved as an
incident note, credited to you. `:memo:`, `:star:` and `:bookmark:` work too.
Pinning is idempotent — reacting twice, or two people reacting to the same
message, records it once.

Your Slack email must match your OpsKnight account email for the note to be
credited to you.

---

## Troubleshooting

| Symptom                                                                             | Cause                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Slash commands and buttons return an error; logs show `Rejected unverified request` | Signing secret missing or wrong. Re-copy it from **Basic Information**          |
| Buttons work but 📌 pins do nothing                                                 | Event Subscriptions not enabled, or `reaction_added` not subscribed             |
| Pin note says _"message text unavailable — missing `channels:history`"_             | Scope declared but not granted. Reinstall the app                               |
| War room opens but nobody is invited                                                | `users:read.email` not granted, or Slack emails do not match OpsKnight accounts |
| **Create War-Room** reports _"does not meet urgency/priority threshold"_            | Older release; the manual button now bypasses the thresholds                    |
| Checklist shows missing scopes after adding them in Slack                           | Reinstall — grants are fixed at install time                                    |

### Reading the logs

```bash
docker compose logs --tail=200 opsknight | grep -i "slack"
```

| Log line                                               | Meaning                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `Rejected unverified request` with `reason: no_secret` | No signing secret configured                          |
| `Rejected unverified request` with `reason: mismatch`  | The configured secret is not this app's               |
| `Could not read pinned message text`                   | The error field names the cause, e.g. `missing_scope` |
| `Pinned message saved as incident note`                | Pin sync working                                      |

---

## Security notes

- The bot token and signing secret are encrypted at rest with envelope
  encryption, keyed by `ENCRYPTION_KEY`
- Every inbound request is signature-verified and rejected if it cannot be —
  there is no fail-open path
- Requests older than five minutes are rejected as replays
- War-room channels are public within the workspace, so avoid pasting
  credentials or customer data into them
