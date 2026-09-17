---
order: 5
title: Microsoft Teams ChatOps
description: Triage, acknowledge, resolve, and manage incidents directly inside Microsoft Teams using interactive Adaptive Cards and Teams commands.
---

# Microsoft Teams ChatOps & Incident Response

When an incident triggers in OpsKnight, responders can triage, acknowledge, collaborate, and resolve issues directly inside Microsoft Teams without ever leaving the conversation.

OpsKnight delivers real-time **Adaptive Cards** to your configured Microsoft Teams channels, offering one-click remediation actions, live status updates, incident notes, and automatic video bridge provisioning.

---

## What You Get

| Capability                      | How It Works                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Interactive Adaptive Cards**  | Clean, responsive cards rendered natively by Microsoft Teams with urgency badges, timestamps, and service metadata.         |
| **One-Click Acknowledge**       | Instantly claim and acknowledge the incident directly from the Teams channel card.                                          |
| **One-Click Resolve**           | Mark the incident as resolved once remediation is complete, updating both OpsKnight and Teams.                              |
| **Incident Notes & Updates**    | Submit timeline updates and troubleshooting notes directly through an interactive card form.                                |
| **Online Meeting Video Bridge** | Spawn an instant Microsoft Teams video call with a dedicated join link embedded in the card.                                |
| **In-Place Card Updates**       | When the status changes in OpsKnight or Teams, the original card updates in-place, keeping channels clean and clutter-free. |
| **Idempotency & Concurrency**   | Built-in distributed locking prevents race conditions when multiple responders click actions simultaneously.                |

---

## Interactive Adaptive Card Structure

OpsKnight uses **Adaptive Cards v1.5** with native Microsoft Teams action bindings:

```
+-------------------------------------------------------------+
| [CRITICAL] INC-104: Payment Gateway Latency Spike           |
| Service: Checkout API | Urgency: HIGH | Status: TRIGGERED    |
| Triggered: 2 mins ago | Escalation: Tier 1 On-Call          |
+-------------------------------------------------------------+
| Description: Elevated HTTP 504 gateway timeouts on /v1/pay  |
| SLA: Ack remaining: 13m 24s                                  |
+-------------------------------------------------------------+
| [✓ Acknowledge]  [✕ Resolve]  [📹 Join Video Bridge]        |
| [📝 Add Note]    [↗ Open in OpsKnight]                      |
+-------------------------------------------------------------+
```

### Supported Actions

- **Acknowledge (`ack`)**: Transitions incident from `TRIGGERED` to `ACKNOWLEDGED`. The card updates immediately with the responder's name and changes color from red to amber.
- **Resolve (`resolve`)**: Transitions incident to `RESOLVED`. The card turns green, freezes the SLA clock, and disables destructive action buttons.
- **Video Bridge (`video_bridge`)**: Generates an ad-hoc Microsoft Teams Online Meeting via the Microsoft Graph API, returning a direct `https://teams.microsoft.com/l/meetup-join/...` join link.
- **Add Note (`add_note`)**: Opens an inline input box or dialog allowing responders to write troubleshooting updates that sync into the OpsKnight incident timeline.
- **Open in OpsKnight (`view_incident`)**: Deep-links directly to the incident workspace in the OpsKnight web application.

---

## How Responder Actions Work

### 1. In-Channel Interaction

A responder clicks **Acknowledge** on an incident card in Microsoft Teams.

### 2. Secure Bot Invocation

Microsoft Teams sends an HTTPS POST request containing an authenticated JWT token to:

```
POST https://<your-opsknight-host>/api/microsoft-teams/messages
```

### 3. Cryptographic Verification

OpsKnight verifies the inbound request against Microsoft Bot Framework OpenID configuration:

- Validates token signature against `https://api.botframework.com` public keys.
- Confirms the audience matches your configured **Client ID** (App ID).
- Normalizes and matches the `serviceUrl` to prevent spoofing.

### 4. Identity Resolution & Access Control

OpsKnight extracts the responder's Microsoft Entra Object ID (`aadObjectId`) and email from the activity payload:

- Maps the Teams user to an active OpsKnight responder account.
- Logs the action in the OpsKnight incident audit trail (e.g., `Acknowledged via Microsoft Teams by John Doe`).

### 5. In-Place Card Mutation

OpsKnight updates the incident record in PostgreSQL, then performs a Bot Framework `PUT /v3/conversations/{conversationId}/activities/{activityId}` to mutate the existing card. Responders in the channel immediately see the updated status without new message spam.

---

## Online Meeting Video Bridge Setup

When major incidents occur, jumping on a live audio/video bridge is critical. OpsKnight can automatically generate a Microsoft Teams meeting link for any incident:

1. Click **Join Video Bridge** (or **Create Video Bridge**) on the incident card.
2. OpsKnight uses Microsoft Graph API (`/users/{organizerId}/onlineMeetings`) to provision an online meeting.
3. The meeting link is saved to the incident record and posted back to the Teams card as a clickable button.
4. Responders click **Join Teams Meeting** to immediately enter the incident call.

> **Note**: For Online Meeting creation, ensure your tenant administrator has granted the Graph application permission `OnlineMeetings.ReadWrite.All` and configured the Teams Application Access Policy as documented in the [Microsoft Teams setup guide](./microsoft-teams).

---

## Troubleshooting & Best Practices

### Card Button Clicks Show "Unable to reach app"

- Verify that your OpsKnight host is publicly accessible via HTTPS.
- Check that the **Messaging endpoint** in Azure Bot Service is set to `https://<your-host>/api/microsoft-teams/messages`.
- Verify the **Client Secret** in OpsKnight settings is active and has not expired.

### Rate Limits & Backoff

Microsoft Teams enforces a rate limit of approximately 2 requests per second per conversation. OpsKnight includes an intelligent outbox with:

- Token-bucket rate limiting (2 req/s).
- Exponential backoff with full jitter (0.8–1.2x) on transient `429 Too Many Requests` responses.
- Idempotency fencing on `(incidentId, version, escalationStep)` so retries never duplicate messages.

### Multiple Responders Acting Simultaneously

OpsKnight uses deterministic advisory locks on `(incidentId, destinationId)`. If two engineers click **Acknowledge** at the same second:

- The first request commits and updates the incident state.
- The second request safely reconciles against the updated state and refreshes the card without raising an error.
