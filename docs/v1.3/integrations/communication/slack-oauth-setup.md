---
order: 2
title: Slack OAuth Setup
description: OAuth setup steps for the Slack integration
---

# Slack OAuth Integration Setup

## Overview

The Slack integration supports two methods:

1. **OAuth Integration (Recommended)**: Connect Slack workspace via OAuth for full API access
2. **Webhook (Legacy)**: Use incoming webhooks (limited functionality)

## OAuth Setup Steps

### 1. Create Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name your app (e.g., "OpsKnight") and select your workspace
4. Click "Create App"

### 2. Configure OAuth & Permissions

1. In your app settings, go to **OAuth & Permissions**
2. Under **Redirect URLs**, add:
   ```
   https://yourdomain.com/api/slack/oauth/callback
   http://localhost:3000/api/slack/oauth/callback  (for development)
   ```
3. Under **Scopes** → **Bot Token Scopes**, add every scope below.

   **Required** — incident features break without these:
   - `chat:write` - Send messages
   - `channels:read` - List channels
   - `channels:join` - Join channels the bot was not invited to
   - `channels:manage` - Create, retitle and archive war-room channels
   - `channels:history` - Read a pinned message so it can be saved as a note
   - `reactions:read` - Receive 📌 reactions
   - `users:read` - Read user information
   - `users:read.email` - Match Slack users to OpsKnight accounts, so
     responders are auto-invited to war rooms

   **Optional** — private channel and DM coverage:
   - `groups:read`, `groups:write`, `groups:history` - Private channels
   - `im:read`, `mpim:read` - Direct and group messages

4. Under **Scopes** → **User Token Scopes** (optional):
   - No user scopes needed for basic functionality

> **Faster alternative.** Settings → Integrations → Slack shows a generated
> **App Manifest** for your deployment. Creating the app from that manifest
> configures every scope, Event Subscriptions, interactivity and the
> `/incident` command in one step, with nothing to tick by hand.

### 2b. Enable Event Subscriptions

Required for 📌 emoji pin sync. This is a **separate setting from
Interactivity** — buttons can work perfectly while events do nothing.

1. Go to **Event Subscriptions** and turn it on
2. Set the Request URL to `https://yourdomain.com/api/slack/events`
3. Under **Subscribe to bot events**, add `reaction_added`

Slack verifies that URL with a signed challenge, so configure the Signing
Secret (step 5) **before** saving it, or verification is rejected.

### 3. Install App to Workspace

1. Go to **OAuth & Permissions** page
2. Click **Install to Workspace**
3. Review permissions and click **Allow**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 4. Get Signing Secret

1. Go to **Basic Information** in your app settings
2. Under **App Credentials**, find **Signing Secret**
3. Click **Show** and copy the secret

### 5. Enter Credentials in OpsKnight

Slack credentials are entered in the app, not in environment variables, and are
stored encrypted. Go to **Settings → Integrations → Slack** and provide:

| Field              | Where to find it in Slack           |
| ------------------ | ----------------------------------- |
| **Client ID**      | Basic Information → App Credentials |
| **Client Secret**  | Basic Information → App Credentials |
| **Signing Secret** | Basic Information → App Credentials |

> **The Signing Secret is required, not optional.** OpsKnight verifies that every
> inbound request genuinely came from Slack and **rejects those it cannot verify**.
> Without it, slash commands, interactive buttons and events all fail with `401`
> and the logs show `Rejected unverified request`.
>
> Slack does **not** return this value during OAuth — it is an app-level
> credential, so reconnecting will not fill it in. It must be copied manually.

`SLACK_SIGNING_SECRET` is still honoured as an environment override, which is
convenient for local development, but is not needed in a normal deployment.

Legacy fallbacks, only for installs not using OAuth:

```env
# Optional: legacy webhook URL (fallback if OAuth is not configured)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Optional: legacy bot token (fallback if OAuth is not configured)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
```

### 6. Generate Encryption Key

`ENCRYPTION_KEY` is **required in production** — it encrypts the stored bot token
and signing secret. A development fallback is used automatically when it is unset
outside production.

Generate one with:

```bash
openssl rand -hex 32
```

Add this to your `ENCRYPTION_KEY` environment variable.

## Usage

### Connect Slack to Service

1. Go to Service Settings → Notifications
2. Click "Connect Slack Workspace"
3. Authorize the app in Slack
4. Select a channel for notifications
5. Save settings

### Connect Slack Globally

1. Go to Settings → Integrations
2. Click "Connect Slack Workspace"
3. Authorize the app
4. This becomes the default Slack integration

## How It Works

1. **OAuth Flow**: User clicks "Connect Slack" → Redirected to Slack → Authorizes → Callback stores encrypted token
2. **Token Storage**: Bot tokens are encrypted and stored in `SlackIntegration` table
3. **Service-Specific**: Each service can have its own Slack workspace connection
4. **Global Fallback**: If no service-specific integration, uses global integration
5. **Env Fallback**: If no OAuth integration, falls back to `SLACK_BOT_TOKEN` env var

## Security

- Bot tokens are encrypted using AES-256-CBC before storage
- Encryption key should be stored securely (env var, secret manager)
- Tokens are decrypted only when needed for API calls
- Never log or expose decrypted tokens

## Troubleshooting

### "Slack bot token not configured"

- Ensure OAuth integration is connected
- Or set `SLACK_BOT_TOKEN` environment variable
- Check that integration is enabled

### "Failed to decrypt token"

- Ensure `ENCRYPTION_KEY` is set correctly
- Key must be same across all instances
- If changed, re-connect Slack integrations

### "Invalid OAuth state"

- OAuth state expired (10 minutes)
- Try connecting again
- Clear cookies if issue persists

## Endpoints

- `GET /api/slack/oauth` - Initiate OAuth flow
- `GET /api/slack/oauth/callback` - OAuth callback handler
- `GET /api/slack/channels` - List available channels
- `POST /api/slack/actions` - Handle interactive button clicks
- `DELETE /api/slack/disconnect` - Disconnect integration
