---
order: 1
title: Jira Cloud Integration Guide
description: Complete step-by-step setup guide for OpsKnight bi-directional Jira Cloud integration, service project routing, webhook security, and real-time comment synchronization.
---

# Jira Cloud Integration Guide

OpsKnight provides a **production-grade, bi-directional Jira Cloud integration** that turns incidents and postmortem action items into tracked engineering work while keeping OpsKnight and Jira synchronized in real-time.

```
┌─────────────────┐       Auto-Create / Manual       ┌─────────────────┐
│                 │ ───────────────────────────────► │                 │
│  OpsKnight      │                                  │   Jira Cloud    │
│  Incidents      │ ◄─────────────────────────────── │   Workflows     │
│                 │      Webhook Sync & Status       │                 │
└─────────────────┘                                  └─────────────────┘
        │                                                     ▲
        │               Real-Time Comments                    │
        └─────────────────────────────────────────────────────┘
```

---

## Key Capabilities

- 🔐 **Envelope Encryption**: API tokens and webhook secrets are encrypted at rest using AES-256-GCM.
- 🎯 **Service-Owned Project Routing**: Each service maps to its own Jira Project Key (e.g. `SCRUM`, `INFRA`, `API`).
- ⚡ **Auto-Issue Creation**: Automatically create Jira tickets for new incidents based on urgency (`HIGH`, `MEDIUM`, `LOW`).
- 🔗 **Smart Link & URL Parser**: Link existing Jira issues by key (`SCRUM-42`), lowercase (`scrum-42`), or by pasting full Jira URLs directly.
- 💬 **Real-Time Comment Sync**: Incident notes added in OpsKnight automatically post as formatted comments on linked Jira tickets.
- 🔄 **Idempotent Webhook Synchronization**: Status and assignee changes in Jira update OpsKnight instantly via timing-safe HMAC webhooks.
- 🛡️ **Graceful Production Error Handling**: Clear, user-friendly UI warnings for missing projects, invalid issue types, or duplicate links without exposing raw stack traces.

---

## System Requirements & Prerequisites

Before setting up the Jira integration, ensure you have:

1. **Jira Cloud Site**: An active Jira Cloud workspace (e.g. `yourcompany.atlassian.net`).
2. **Atlassian Account API Token**: Created by an account with create/read/update permissions in your target Jira projects.
3. **OpsKnight Administrator Role**: Required to configure workspace-level integration credentials.

---

## Step 1: Workspace Credential Setup

### 1.1 Generate an Atlassian API Token

1. Log in to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token**.
3. Label it `OpsKnight Integration` and click **Create**.
4. Copy the API token string.

### 1.2 Configure Workspace Connection in OpsKnight

1. In OpsKnight, navigate to **Settings → Integrations → Jira** (or click the **Jira** card in the Integrations directory).
2. Fill in the workspace connection fields:

| Field               | Description                                                     | Example                     |
| ------------------- | --------------------------------------------------------------- | --------------------------- |
| **Jira Site URL**   | Your Atlassian site domain (protocol auto-prepended if omitted) | `yourcompany.atlassian.net` |
| **Jira User Email** | Email address associated with your Atlassian API token          | `ops@yourcompany.com`       |
| **API Token**       | The API token generated in Step 1.1                             | `ATATT3x...`                |
| **Webhook Secret**  | Shared secret string used to sign inbound webhook requests      | `sk_jira_live_8f9a2b...`    |
| **Enable**          | Toggle on to activate Jira workflows workspace-wide             | ✅ Checked                  |

3. Click **Save Configuration**.
4. Click **Test Connection** to verify credentials. Upon success, a banner will confirm `Connected as <Your Jira Name>`.

---

## Step 2: Configure Jira Inbound Webhook

To sync status and assignee changes from Jira back to OpsKnight in real-time, register a webhook in Jira Cloud.

### 2.1 Webhook Registration

1. In Jira Cloud, navigate to **⚙️ Settings → System → WebHooks** (`https://yourcompany.atlassian.net/plugins/servlet/webhooks`).
2. Click **+ Create a WebHook**.
3. Enter the configuration:

| Setting    | Value                                                |
| ---------- | ---------------------------------------------------- |
| **Name**   | `OpsKnight Webhook Sync`                             |
| **Status** | `Enabled`                                            |
| **URL**    | `https://your-opsknight-domain.com/api/jira/webhook` |

> 💡 **Local Development**: If running OpsKnight locally, use a tunnel URL such as `https://xxxx.ngrok-free.app/api/jira/webhook`.

4. Under **Headers**, add:

| Header Name             | Header Value                                              |
| ----------------------- | --------------------------------------------------------- |
| `x-jira-webhook-secret` | The exact Webhook Secret configured in OpsKnight Settings |

5. Under **Issue Events**, select:
   - ✅ **Issue → updated**
   - ✅ **Issue → deleted**

6. (Optional) Under **JQL**, filter by project to scope webhooks:

   ```jql
   project IN (SCRUM, INFRA, API)
   ```

7. Click **Create**.

---

## Step 3: Service-Level Jira Mapping

Configure how each service routes incidents and postmortem work to Jira.

1. Navigate to **Services → (Select Service) → Settings**.
2. Scroll to the **Service Integrations & Workflows** section (positioned side-by-side with Slack notifications).
3. In the **Jira Workflow Mapping** card, configure:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🎟️ Jira Project & Workflow Mapping                                     │
├────────────────────────────────────────────────────────────────────────┤
│ Project Key                     [ SCRUM                              ] │
│ Incident Issue Type             [ Task                               ] │
│ Action Item Issue Type          [ Task                               ] │
│ Default Labels                  [ opsknight, infrastructure          ] │
│ Default Component (Optional)    [ API Gateway                        ] │
│ Auto-Create Jira Issues         [☑ Enabled                           ] │
│ Auto-Create Urgencies           [☑ High]  [☑ Medium]  [☐ Low]           │
└────────────────────────────────────────────────────────────────────────┘
```

| Field                      | Description                                       | Notes                                               |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| **Project Key**            | Target Jira project key                           | Must be uppercase (e.g. `SCRUM`, `INFRA`)           |
| **Incident Issue Type**    | Issue type created for incidents                  | Must exist in target project (e.g. `Task`, `Story`) |
| **Action Item Issue Type** | Issue type created for postmortem items           | Standard type (e.g. `Task`)                         |
| **Default Labels**         | Comma-separated labels attached to created issues | e.g. `opsknight, production`                        |
| **Default Component**      | Optional component assigned to created issues     | Must exist in Jira project settings if specified    |
| **Auto-Create**            | Automatically create Jira ticket on new incident  | Triggered asynchronously on incident start          |

---

## Step 4: Workflow Operations

### 4.1 Creating Jira Issues from Incidents

1. Open any Incident Detail page.
2. In the right sidebar **Jira Issues** card, click **Create Jira Issue**.
3. OpsKnight creates the issue in Jira, attaches default labels and components, and links it immediately.
4. An event is recorded on the incident timeline: `Jira issue SCRUM-42 created`.

### 4.2 Linking Existing Jira Issues

1. In the **Jira Issues** card, click **+ Link**.
2. Enter the Jira issue key (e.g. `SCRUM-42` or `scrum-42`) **OR** paste the full Jira URL:
   ```
   https://yourcompany.atlassian.net/jira/software/projects/SCRUM/boards/1/backlog?selectedIssue=SCRUM-42
   ```
3. Click **Link**. OpsKnight validates the issue key, fetches metadata from Jira, and records the link.

### 4.3 Real-Time Comment Sync

- When a responder adds a note or investigation update to an incident in OpsKnight:
  ```text
  Investigated DB connection pool exhaust — restarted database cluster.
  ```
- OpsKnight automatically formats and posts a comment to all linked Jira tickets:
  ```text
  [OpsKnight Note by Dushyant Rahangdale]:
  Investigated DB connection pool exhaust — restarted database cluster.
  ```

### 4.4 Postmortem Action Items

1. In any Postmortem report or Action Items list, click **Create Jira** on an action item.
2. OpsKnight creates a tracked Jira issue using the service's configured `Action Item Issue Type` (e.g. `Task`).

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SECURITY CONTROLS                             │
├───────────────────────────────┬─────────────────────────────────────────┤
│ Encryption at Rest            │ AES-256-GCM envelope encryption for     │
│                               │ API Tokens and Webhook Secrets.         │
├───────────────────────────────┼─────────────────────────────────────────┤
│ Webhook Signature Validation  │ Timing-safe HMAC verification via       │
│                               │ crypto.timingSafeEqual.                 │
├───────────────────────────────┼─────────────────────────────────────────┤
│ Access Control (RBAC)         │ Configuration: ADMIN only.              │
│                               │ Issue Creation & Linking: RESPONDER+.   │
└───────────────────────────────┴─────────────────────────────────────────┘
```

---

## Troubleshooting & Error Reference

| Message / Error                      | Root Cause                                           | Solution                                                                                       |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Jira project "XXX" does not exist`  | Invalid Project Key entered in Service Mapping       | Verify project key in Jira (**Project Settings → Details**) and update in Service Settings.    |
| `Jira issue type "Bug" is invalid`   | Issue type not enabled for project template          | In Jira Scrum projects, change Incident Issue Type to `Task` or `Story` in Service Settings.   |
| `Component "YYY" does not exist`     | Component specified in mapping doesn't exist in Jira | Create component in Jira (**Project Settings → Components**) or leave Default Component blank. |
| `Jira issue "XXX" is already linked` | Issue key is attached to another item                | 1 Jira issue links to 1 OpsKnight item. Unlink from existing item first if moving.             |
| `401 Unauthorized` on Webhook        | Webhook secret mismatch                              | Verify `x-jira-webhook-secret` header in Jira matches Webhook Secret in OpsKnight settings.    |
| `Jira request failed (401)`          | Expired or revoked API token                         | Regenerate Atlassian API Token at `id.atlassian.com` and save in OpsKnight settings.           |

---

## API & Webhook Specifications

### Inbound Webhook Endpoint

```http
POST /api/jira/webhook
Headers:
  x-jira-webhook-secret: <secret>
  Content-Type: application/json

Payload:
{
  "webhookEvent": "jira:issue_updated",
  "issue": {
    "id": "10042",
    "key": "SCRUM-42",
    "fields": {
      "status": { "name": "In Progress" },
      "assignee": { "displayName": "Alice" }
    }
  }
}
```

### Response

```json
{
  "ok": true,
  "updated": 1
}
```
