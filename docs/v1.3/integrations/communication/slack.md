---
order: 1
title: Slack
description: Send interactive incident notifications to Slack with acknowledge and resolve actions
---

# Slack Integration

The Slack integration brings incident management directly into your team's workspace. Receive rich notifications, acknowledge incidents without leaving Slack, and keep everyone informed with real-time updates.

<!-- placeholder:slack-integration-overview -->
<!-- Add: Screenshot of a Slack incident notification with action buttons -->

---

## Endpoint

Slack uses OAuth and interactive endpoints rather than a single webhook. Primary endpoints:

- `GET /api/settings/slack-oauth/callback`
- `POST /api/slack/actions`
- `POST /api/slack/commands`

---

## Why Use Slack Integration

| Without Slack                 | With Slack                     |
| ----------------------------- | ------------------------------ |
| Check OpsKnight separately    | Incidents come to you          |
| Context switch to acknowledge | One-click acknowledge in Slack |
| Manual status updates         | Automatic thread updates       |
| Siloed incident info          | Team visibility                |

---

## Features

### Incident Notifications

- **Rich message format** with incident details
- **Urgency indicators** (color-coded)
- **Service information** and affected components
- **Timestamps** and duration tracking

### Interactive Actions

| Action          | Description                                       |
| --------------- | ------------------------------------------------- |
| **Acknowledge** | Mark incident as acknowledged directly from Slack |
| **Resolve**     | Resolve incident without leaving Slack            |
| **View**        | Open incident in OpsKnight                        |
| **Snooze**      | Temporarily silence the incident                  |

### Real-Time Updates

- **Thread updates** when incident status changes
- **Escalation notifications** in the same thread
- **Resolution summary** when incident closes

### Channel Routing

- **Default channel** for all incidents
- **Per-service channels** for focused alerting
- **Per-urgency routing** (critical to one channel, low to another)

---

## Prerequisites

Before setting up Slack integration:

- [ ] OpsKnight admin access
- [ ] Slack workspace admin access (or app installation permission)
- [ ] OpsKnight accessible via HTTPS (required for Slack interactivity)

---

## Setup Overview

```
1. Create Slack App
        ↓
2. Configure OAuth Scopes
        ↓
3. Set Up Interactivity
        ↓
4. Install to Workspace
        ↓
5. Connect in OpsKnight
        ↓
6. Configure Channels
```

---

## Step 1: Create Slack App

### Via Slack App Directory

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Choose **From scratch**
4. Configure app details:
   - **App Name**: `OpsKnight` (or your preferred name)
   - **Workspace**: Select your workspace
5. Click **Create App**

<!-- placeholder:create-slack-app -->
<!-- Add: Screenshot of Slack app creation dialog -->

### App Credentials

After creation, note these values (found in **Basic Information**):

- **Client ID**
- **Client Secret**
- **Signing Secret**

---

## Step 2: Configure OAuth Scopes

The Slack app needs specific permissions to function.

### Navigate to OAuth & Permissions

1. In your Slack app settings
2. Click **OAuth & Permissions** in the sidebar

### Add Bot Token Scopes

Add these scopes under **Bot Token Scopes**:

**Required** — incident features break without these:

| Scope              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `chat:write`       | Send messages to channels                            |
| `channels:read`    | List public channels                                 |
| `channels:join`    | Join channels the bot was not invited to             |
| `channels:manage`  | Create, retitle and archive war-room channels        |
| `channels:history` | Read a pinned message so it can be saved as a note   |
| `reactions:read`   | Receive 📌 reactions                                 |
| `users:read`       | Get user information                                 |
| `users:read.email` | Match users by email, so responders are auto-invited |

**Optional** — private channel and DM coverage:

| Scope                                           | Purpose                   |
| ----------------------------------------------- | ------------------------- |
| `groups:read`, `groups:write`, `groups:history` | Private channels          |
| `im:read`, `mpim:read`                          | Direct and group messages |

> `chat:write.public` is **not** requested by OpsKnight; the bot joins channels
> with `channels:join` instead. See
> [Slack ChatOps & War Rooms](./slack-chatops) for what each scope enables.

### Add Redirect URL

Under **Redirect URLs**, add:

```
https://YOUR_OPSKNIGHT_URL/api/settings/slack-oauth/callback
```

Replace `YOUR_OPSKNIGHT_URL` with your OpsKnight instance URL.

---

## Step 3: Set Up Interactivity

Enable interactive features for action buttons.

### Enable Interactivity

1. Go to **Interactivity & Shortcuts** in sidebar
2. Toggle **Interactivity** to **On**
3. Set **Request URL**:

```
https://YOUR_OPSKNIGHT_URL/api/slack/actions
```

### Configure Shortcuts (Optional)

Add a global shortcut to create incidents:

1. Click **Create New Shortcut**
2. Choose **Global**
3. Configure:
   - **Name**: Create Incident
   - **Short Description**: Create an OpsKnight incident
   - **Callback ID**: `create_incident`

---

## Step 4: Install to Workspace

### Install App

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Review permissions
4. Click **Allow**

### Save Bot Token

After installation, copy the **Bot User OAuth Token** (starts with `xoxb-`).

---

## Step 5: Connect in OpsKnight

### Configure Slack Settings

1. Go to **Settings** → **Integrations** → **Slack**
2. Click **Configure** or **Connect**
3. Enter credentials:

| Field              | Value            |
| ------------------ | ---------------- |
| **Client ID**      | From Slack app   |
| **Client Secret**  | From Slack app   |
| **Signing Secret** | From Slack app   |
| **Bot Token**      | `xoxb-...` token |

4. Click **Save**

### Test Connection

1. Click **Test Connection**
2. Verify "Connection successful" message
3. Select a test channel
4. Send a test message

<!-- placeholder:slack-config-form -->
<!-- Add: Screenshot of OpsKnight Slack configuration form -->

---

## Step 6: Configure Channels

### Default Channel

Set a default channel for all incident notifications:

1. Go to **Settings** → **Integrations** → **Slack**
2. Select **Default Channel** from dropdown
3. Save

### Per-Service Channels

Route specific services to dedicated channels:

1. Go to **Services**
2. Open a service
3. Click **Edit** or **Settings**
4. Set **Slack Channel** (e.g., `#payment-alerts`)
5. Save

**Channel Precedence**:

```
Service-specific channel (if set)
        ↓
Default channel (fallback)
```

### Private Channels

To use private channels:

1. Invite the OpsKnight bot to the channel: `/invite @OpsKnight`
2. The channel will appear in the dropdown

---

## Notification Configuration

### Event Types

Control which events trigger Slack notifications:

| Event                     | Default | Description               |
| ------------------------- | :-----: | ------------------------- |
| **Incident Triggered**    |   ✅    | New incident created      |
| **Incident Acknowledged** |   ✅    | Someone acknowledged      |
| **Incident Resolved**     |   ✅    | Incident resolved         |
| **Incident Escalated**    |   ✅    | Escalated to next step    |
| **SLA Breached**          |   ✅    | SLA target missed         |
| **Note Added**            |   ❌    | Comment added to incident |

### Configuring Events

1. Go to **Settings** → **Integrations** → **Slack**
2. Scroll to **Notification Events**
3. Toggle events on/off
4. Save

### Urgency Filtering

Only notify for certain urgency levels:

| Setting           | Effect                       |
| ----------------- | ---------------------------- |
| **All**           | Notify for HIGH, MEDIUM, LOW |
| **High Only**     | Only HIGH urgency incidents  |
| **High + Medium** | Exclude LOW urgency          |

---

## Message Format

### Incident Notification

```
┌─────────────────────────────────────────────────┐
│ 🔴 HIGH URGENCY                                  │
├─────────────────────────────────────────────────┤
│ Database Connection Timeout                      │
│                                                  │
│ Service: Payment API                             │
│ Triggered: 2 minutes ago                         │
│ Status: Open                                     │
│                                                  │
│ [Acknowledge]  [Resolve]  [View in OpsKnight]    │
└─────────────────────────────────────────────────┘
```

### Message Elements

| Element       | Description                             |
| ------------- | --------------------------------------- |
| **Color bar** | Red (HIGH), Yellow (MEDIUM), Blue (LOW) |
| **Title**     | Incident title/summary                  |
| **Service**   | Affected service name                   |
| **Triggered** | Time since incident started             |
| **Status**    | Current incident status                 |
| **Actions**   | Interactive buttons                     |

### Thread Updates

Status changes appear as thread replies:

```
Main message: Database Connection Timeout
  └─ Thread: ✅ Acknowledged by @jane (2 min ago)
  └─ Thread: 🔧 Resolved by @bob (15 min ago)
             Resolution: Restarted connection pool
```

---

## Interactive Actions

### Acknowledge Button

When clicked:

1. Incident status changes to ACKNOWLEDGED
2. Escalation stops
3. Thread update posted
4. Button changes to "Acknowledged ✓"

### Resolve Button

When clicked:

1. Modal appears for resolution note (optional)
2. Incident status changes to RESOLVED
3. Thread update with resolution summary
4. Buttons removed (incident closed)

### View Button

Opens the incident detail page in OpsKnight.

### Snooze Options

Snooze menu options:

- 15 minutes
- 30 minutes
- 1 hour
- 4 hours
- Custom duration

---

## User Mapping

OpsKnight maps Slack users to OpsKnight users for attribution.

### Automatic Mapping

When a Slack user takes an action:

1. OpsKnight looks up user by email
2. If found, action attributed to that user
3. If not found, action shows "via Slack"

### Ensuring Mapping Works

- Users must have **same email** in Slack and OpsKnight
- Slack profile email must be visible to apps
- OpsKnight user must be ACTIVE

---

## Slash Commands (Optional)

Add slash commands for quick actions.

### Available Commands

| Command                | Description            |
| ---------------------- | ---------------------- |
| `/opsknight incidents` | List open incidents    |
| `/opsknight oncall`    | Who's on-call now      |
| `/opsknight status`    | System status summary  |
| `/opsknight create`    | Create manual incident |

### Setting Up Slash Commands

1. Go to Slack app settings
2. Click **Slash Commands**
3. Click **Create New Command**
4. Configure:
   - **Command**: `/opsknight`
   - **Request URL**: `https://YOUR_OPSKNIGHT_URL/api/integrations/slack/commands`
   - **Description**: OpsKnight incident management
5. Save

---

## Multiple Workspaces

Connect OpsKnight to multiple Slack workspaces.

### Adding Another Workspace

1. Go to **Settings** → **Integrations** → **Slack**
2. Click **Add Workspace**
3. Complete OAuth flow for new workspace
4. Configure channels for new workspace

### Workspace-Specific Settings

Each workspace can have:

- Different default channel
- Different notification preferences
- Different user mappings

---

## Troubleshooting

### Messages Not Sending

1. **Verify bot token** is correct
2. **Check channel exists** and bot has access
3. **Verify bot is in channel** (for private channels)
4. **Test connection** in settings
5. **Check OpsKnight logs** for errors

### Action Buttons Not Working

1. **Verify interactivity URL** is correct
2. **Check HTTPS** — Slack requires HTTPS
3. **Verify signing secret** is correct
4. **Check OpsKnight is accessible** from internet

### Wrong User Attribution

1. **Check email match** between Slack and OpsKnight
2. **Verify Slack email is visible** to apps
3. **Check user is ACTIVE** in OpsKnight

### Channel Not Appearing

1. **Public channels** appear automatically
2. **Private channels** need bot invited first
3. **Refresh channel list** in settings

### Rate Limiting

If you see rate limit errors:

- OpsKnight batches notifications automatically
- Reduce notification frequency if needed
- Check for notification loops

---

## Best Practices

### Channel Organization

| Channel               | Purpose                 |
| --------------------- | ----------------------- |
| `#incidents-critical` | HIGH urgency only       |
| `#incidents-all`      | All incidents           |
| `#payment-oncall`     | Payment team incidents  |
| `#platform-alerts`    | Platform team incidents |

### Reducing Noise

- **Use per-service channels** to segment alerts
- **Filter by urgency** in low-priority channels
- **Disable "note added" notifications** unless needed
- **Use threads** — updates don't spam channel

### Response Workflow

1. **Incident posted** to channel
2. **On-call sees notification**
3. **Clicks Acknowledge** in Slack
4. **Investigates** the issue
5. **Clicks Resolve** when fixed
6. **Adds resolution note** in modal

### Integration with Slack Workflows

Combine with Slack Workflow Builder:

- Auto-create incident channel for major incidents
- Notify stakeholders on HIGH urgency
- Post to status channel on resolution

---

## Security Considerations

### Signing Secret Verification

OpsKnight verifies all requests from Slack using the signing secret:

- Prevents spoofed requests
- Validates request timestamp
- Required for production

### Token Security

- **Never share tokens** in public channels
- **Rotate tokens** if compromised
- **Use environment variables** for tokens

### Channel Access

- Bot only accesses channels it's invited to
- Users can only see incidents they have access to
- Actions are attributed to authenticated users

---

## API Reference

### Webhook Endpoint

```
POST /api/slack/actions
```

Handles all button clicks and modal submissions.

### Command Endpoint

```
POST /api/slack/commands
```

Handles slash command invocations.

### OAuth Callback

```
GET /api/settings/slack-oauth/callback
```

Handles OAuth flow completion.

---

## Related Topics

- [Slack OAuth Setup](./slack-oauth-setup) — Detailed OAuth configuration
- [Notifications](../../administration/notifications) — All notification channels
- [Integrations Overview](.) — Other integrations
- [Services](../../core-concepts/services) — Per-service channel configuration
