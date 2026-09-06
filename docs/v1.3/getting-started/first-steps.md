---
order: 2
title: First Steps
description: Create your first service, escalation policy, on-call schedule, and test incident
---

# First Steps

This guide walks you through setting up OpsKnight from scratch. By the end, you'll have a complete incident management workflow configured and tested.

<!-- placeholder:first-steps-overview -->
<!-- Add: Screenshot showing the OpsKnight dashboard after initial setup -->

---

## What We'll Build

In this guide, you'll create:

1. **An Admin User** — Your first login account
2. **A Team** — To organize your responders
3. **A Service** — Representing a system you monitor
4. **An Escalation Policy** — Defining who gets notified
5. **An On-Call Schedule** — Rotating on-call duties
6. **A Test Incident** — Verifying everything works

Each step builds on the previous, so follow them in order.

---

## Step 1: Create Admin User (First-Time Setup)

When you first access OpsKnight, you'll be automatically redirected to the setup page at `/setup`.

### On the Setup Page:

1. Enter your **Name** (e.g., "Jane Admin")
2. Enter your **Email** (e.g., jane@example.com)
3. Click **Create Admin Account**

<!-- placeholder:setup-page -->
<!-- Add: Screenshot of the /setup page with name and email fields -->

**Important**: A secure password will be generated for you and displayed **only once**. Copy it immediately and store it safely — you won't be able to see it again.

### After Setup:

1. You'll be redirected to the login page
2. Log in with your email and the generated password
3. Once logged in, you can change your password in **Profile** settings

<!-- placeholder:login-screen -->
<!-- Add: Screenshot of the OpsKnight login page -->

> **Note**: The `/setup` page is only accessible when no users exist in the system. After the first admin is created, this page becomes unavailable.

---

## Step 2: Invite Team Members

Before setting up schedules, you need team members to put on-call.

### Navigate to Users

1. Click **Settings** in the sidebar
2. Select **Users**

### Invite a User

1. Click **Invite User**
2. Enter their email address
3. Select a role:
   - **User** — Can view and acknowledge incidents
   - **Responder** — Can handle incidents and be on-call
   - **Admin** — Full system access
4. Click **Send Invitation**

<!-- placeholder:invite-user-modal -->
<!-- Add: Screenshot of the user invitation modal -->

The user receives an email with a link to set their password and activate their account.

> **Tip**: For testing, invite yourself with a different email to simulate a team member.

---

## Step 3: Create a Team

Teams organize users and can be targeted by escalation policies.

### Navigate to Teams

1. Click **Teams** in the sidebar

### Create Your Team

1. Click **Create Team**
2. Enter team details:
   - **Name**: `Platform Engineering`
   - **Description**: `Responsible for core infrastructure`
3. Click **Create**

### Add Members

1. Open your new team
2. Click **Add Members**
3. Select users and assign roles:
   - **Owner** — Can manage the team
   - **Admin** — Can add/remove members
   - **Member** — Standard team member

<!-- placeholder:team-creation -->
<!-- Add: Screenshot of team creation form with members list -->

**Why Teams Matter**:

- Escalation policies can notify entire teams
- Incidents can be assigned to teams
- Dashboards can filter by team

---

## Step 4: Create a Service

Services represent the systems you monitor — APIs, databases, applications, or infrastructure components.

### Navigate to Services

1. Click **Services** in the sidebar

### Create Your Service

1. Click **Create Service**
2. Fill in the details:
   - **Name**: `Payment API`
   - **Description**: `Handles all payment processing`
   - **Team**: Select `Platform Engineering`
3. Leave **Escalation Policy** empty for now (we'll create one next)
4. Click **Create**

<!-- placeholder:service-creation -->
<!-- Add: Screenshot of the service creation form -->

**Why Services Matter**:

- Alerts route through services to reach the right people
- Services connect to escalation policies
- Analytics track metrics per service
- Status pages display service health

---

## Step 5: Create an Escalation Policy

Escalation policies define who gets notified when an incident occurs and how notifications escalate if no one responds.

### Navigate to Escalation Policies

1. Click **Policies** in the sidebar

### Create Your Policy

1. Click **Create Policy**
2. Enter basic info:
   - **Name**: `Payment API Escalation`
   - **Description**: `Primary → Secondary → Team Lead`

### Add Escalation Steps

**Step 1 — Primary On-Call**:

1. Click **Add Step**
2. Configure:
   - **Target Type**: `Schedule` (we'll create this next)
   - **Delay**: `0 minutes` (notify immediately)

**Step 2 — Secondary Backup**:

1. Click **Add Step**
2. Configure:
   - **Target Type**: `User`
   - **Target**: Select a backup person
   - **Delay**: `5 minutes` (if no ack after 5 min)

**Step 3 — Team Escalation**:

1. Click **Add Step**
2. Configure:
   - **Target Type**: `Team`
   - **Target**: `Platform Engineering`
   - **Delay**: `10 minutes`

3. Enable **Repeat** to loop back to Step 1 if no one acknowledges
4. Click **Create**

<!-- placeholder:escalation-policy -->
<!-- Add: Screenshot showing the escalation policy builder with multiple steps -->

### How Escalation Works

```
Incident Created
    ↓
Step 1: Notify Primary On-Call (from schedule)
    ↓ (wait 5 min if not acknowledged)
Step 2: Notify Backup User
    ↓ (wait 10 min if still not acknowledged)
Step 3: Notify Entire Team
    ↓ (if repeat enabled, go back to Step 1)
```

---

## Step 6: Create an On-Call Schedule

On-call schedules define who is responsible for responding during specific time periods.

### Navigate to Schedules

1. Click **Schedules** in the sidebar

### Create Your Schedule

1. Click **Create Schedule**
2. Enter details:
   - **Name**: `Payment API Primary On-Call`
   - **Timezone**: Select your team's timezone (e.g., `America/New_York`)
3. Click **Create**

### Add a Layer

Layers allow multiple rotation patterns (e.g., weekday vs. weekend coverage).

1. Click **Add Layer**
2. Configure:
   - **Name**: `Primary Rotation`
   - **Rotation Length**: `168 hours` (1 week per person)
   - **Start Time**: Select when the rotation begins

### Add Users to the Layer

1. Click **Add User**
2. Select team members in rotation order
3. Drag to reorder if needed

<!-- placeholder:schedule-calendar -->
<!-- Add: Screenshot of the schedule calendar view showing rotation timeline -->

**Schedule Concepts**:

- **Layers** — Different rotation patterns (primary, secondary, holiday)
- **Rotation Length** — How long each person is on-call (24h, 168h, etc.)
- **Overrides** — Temporary changes (vacation coverage, swaps)

---

## Step 7: Connect Policy to Service

Now link everything together.

### Update Your Service

1. Go to **Services** → **Payment API**
2. Click **Edit**
3. Set **Escalation Policy**: `Payment API Escalation`
4. Click **Save**

**The Chain is Complete**:

```
Payment API (Service)
    ↓
Payment API Escalation (Policy)
    ↓
Step 1: Payment API Primary On-Call (Schedule)
    ↓
Currently: Jane Admin (based on rotation)
```

---

## Step 8: Configure Notifications (Optional)

Before testing, set up at least one notification channel.

### Email (Simplest)

1. Go to **Settings** → **Notifications**
2. Configure SMTP or a provider (SendGrid, Resend, etc.)
3. Test with **Send Test Email**

### Slack (Recommended)

1. Go to **Settings** → **Integrations** → **Slack**
2. Click **Connect to Slack**
3. Authorize OpsKnight in your workspace
4. Select a default channel for notifications

See the [Notifications Guide](../administration/notifications) for detailed setup.

---

## Step 9: Create a Test Incident

Let's verify everything works by creating a manual incident.

### Create the Incident

1. Click **Incidents** in the sidebar
2. Click **Create Incident**
3. Fill in:
   - **Title**: `Test: Payment API High Latency`
   - **Description**: `This is a test incident to verify the workflow`
   - **Service**: `Payment API`
   - **Urgency**: `High`
4. Click **Create**

<!-- placeholder:create-incident -->
<!-- Add: Screenshot of the incident creation form -->

### What Should Happen

1. **Incident Created** — Appears in the incident list with status `OPEN`
2. **Notification Sent** — Current on-call person receives alert via configured channels
3. **Timeline Updated** — Shows "Incident triggered" event

### Verify the Flow

1. Open the incident to see the timeline
2. Check that notifications were sent (look for delivery status)
3. Click **Acknowledge** to stop escalation
4. Click **Resolve** to close the incident

<!-- placeholder:incident-detail -->
<!-- Add: Screenshot of incident detail page showing timeline and actions -->

---

## Step 10: Test via API (Optional)

For a more realistic test, send an alert via the Events API:

```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "payment-api",
    "event_action": "trigger",
    "dedup_key": "test-alert-001",
    "payload": {
      "summary": "High CPU usage on payment-api-prod-1",
      "severity": "critical",
      "source": "monitoring-system",
      "custom_details": {
        "cpu_percent": 95,
        "host": "payment-api-prod-1"
      }
    }
  }'
```

> **Note**: The `routing_key` should match an integration key configured for your service.

---

## Congratulations!

You've successfully set up OpsKnight with:

- A team of responders
- A monitored service
- An escalation policy with multiple steps
- An on-call rotation schedule
- A tested incident workflow

---

## What's Next?

Now that the basics are working, explore these areas:

### Connect Real Monitoring Tools

Route alerts from your actual infrastructure:

- [Datadog Integration](../integrations/apm-monitoring/datadog)
- [Prometheus Integration](../integrations/metrics-alerting/prometheus)
- [Generic Webhooks](../integrations/custom/webhooks)

### Set Up More Notification Channels

Reach responders through multiple channels:

- [SMS via Twilio](../administration/notifications#sms)
- [Push Notifications](../administration/notifications#push)
- [Slack Integration](../integrations/communication/slack)

### Configure SLAs

Track response time commitments:

- [SLA Configuration](../core-concepts/analytics#sla-tracking)

### Create a Status Page

Communicate with customers:

- [Status Page Setup](../core-concepts/status-page)

### Understand Core Concepts

Deepen your knowledge:

- [Incident Lifecycle](../core-concepts/incidents)
- [Schedule Deep Dive](../core-concepts/schedules)
- [Escalation Details](../core-concepts/escalation-policies)

---

## Quick Reference

| What                       | Where                    |
| -------------------------- | ------------------------ |
| Create/manage users        | Settings → Users         |
| Create/manage teams        | Teams                    |
| Create/manage services     | Services                 |
| Create escalation policies | Policies                 |
| Create on-call schedules   | Schedules                |
| View/manage incidents      | Incidents                |
| Configure notifications    | Settings → Notifications |
| Connect integrations       | Settings → Integrations  |
