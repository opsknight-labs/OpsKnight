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
3. Under **Scopes** → **Bot Token Scopes**, add:
   - `chat:write` - Send messages
   - `channels:read` - List channels
   - `groups:read` - List private channels
   - `im:read` - List DMs
   - `mpim:read` - List group DMs
   - `users:read` - Read user information

4. Under **Scopes** → **User Token Scopes** (optional):
   - No user scopes needed for basic functionality

### 3. Install App to Workspace

1. Go to **OAuth & Permissions** page
2. Click **Install to Workspace**
3. Review permissions and click **Allow**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 4. Get Signing Secret

1. Go to **Basic Information** in your app settings
2. Under **App Credentials**, find **Signing Secret**
3. Click **Show** and copy the secret

### 5. Configure Environment Variables

Add to your `.env` file:

```env
# Slack OAuth Configuration
SLACK_CLIENT_ID=your_client_id_here
SLACK_CLIENT_SECRET=your_client_secret_here
SLACK_REDIRECT_URI=https://yourdomain.com/api/slack/oauth/callback

# Optional: Encryption key for token storage (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=your_32_byte_hex_key_here

# Optional: Legacy webhook URL (fallback if OAuth not configured)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Optional: Legacy bot token (fallback if OAuth not configured)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# Optional: Signing secret for interactive components
SLACK_SIGNING_SECRET=your_signing_secret_here
```

### 6. Generate Encryption Key

For production, generate a secure encryption key:

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
