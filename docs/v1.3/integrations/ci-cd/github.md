---
order: 1
title: GitHub
description: Receive GitHub Actions and deployment failure alerts in OpsKnight
---

# GitHub Integration

Receive alerts from GitHub Actions workflow failures, check failures, and deployment failures.

---

## Endpoint

```
POST /api/integrations/github?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **GitHub**
5. Copy the **Integration ID**
6. (Optional) Generate a **Signing Secret** for security

### Step 2: Configure GitHub Webhook

1. Go to your GitHub repository **Settings** → **Webhooks**
2. Click **Add webhook**
3. Configure:

| Field            | Value                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Payload URL**  | `https://YOUR_OPSKNIGHT_URL/api/integrations/github?integrationId=YOUR_INTEGRATION_ID` |
| **Content type** | `application/json`                                                                     |
| **Secret**       | Your signing secret (if using)                                                         |

4. Select **Let me select individual events**
5. Check the events you want:
   - **Workflow runs** — GitHub Actions failures
   - **Check runs** — Check failures
   - **Deployment statuses** — Deployment failures
6. Click **Add webhook**

---

## Security

> **Strict Security Enforcement**: If you generate a Signing Secret in OpsKnight, you **MUST** configure the same secret in GitHub webhook settings. OpsKnight will reject any requests without a valid signature if a secret exists.

GitHub signs webhooks using HMAC-SHA256 with the secret you provide.

---

## Supported Events

### Workflow Runs

Triggers when GitHub Actions workflows complete.

```json
{
  "action": "completed",
  "repository": {
    "name": "my-repo",
    "full_name": "myorg/my-repo",
    "html_url": "https://github.com/myorg/my-repo"
  },
  "workflow_run": {
    "id": 12345,
    "name": "CI Pipeline",
    "status": "completed",
    "conclusion": "failure",
    "html_url": "https://github.com/myorg/my-repo/actions/runs/12345"
  }
}
```

### Check Runs

Triggers when checks complete.

```json
{
  "action": "completed",
  "repository": {
    "name": "my-repo",
    "full_name": "myorg/my-repo"
  },
  "check_run": {
    "id": 67890,
    "name": "Build",
    "status": "completed",
    "conclusion": "failure",
    "html_url": "https://github.com/myorg/my-repo/runs/67890"
  }
}
```

### Deployment Statuses

Triggers when deployments fail.

```json
{
  "deployment": {
    "id": 11111,
    "environment": "production",
    "state": "failure"
  },
  "repository": {
    "name": "my-repo",
    "full_name": "myorg/my-repo"
  }
}
```

---

## Event Mapping

| GitHub Event                 | OpsKnight Action              |
| ---------------------------- | ----------------------------- |
| `conclusion: failure`        | Trigger incident              |
| `conclusion: timed_out`      | Trigger incident              |
| `conclusion: cancelled`      | Trigger incident              |
| `conclusion: success`        | Resolve incident              |
| `status: queued/in_progress` | Acknowledge (no new incident) |

### Pending State Handling

When workflows or checks are pending/in-progress:

- If an incident exists, it's acknowledged (retry is in progress)
- No new incident is created for pending states

---

## Severity Mapping

| Conclusion                          | OpsKnight Severity |
| ----------------------------------- | ------------------ |
| `failure`, `timed_out`, `cancelled` | critical           |
| Others                              | info               |

---

## Incident Title

Titles are generated based on event type:

- **Workflow failure**: `Workflow failed: {workflow_name}`
- **Check failure**: `Check failed: {check_name}`
- **Deployment failure**: `Deployment failure: {environment}`

Source is formatted as: `GitHub - {repository.full_name}`

---

## Deduplication

Dedup keys are generated as:

- **Workflow runs**: `github-{workflow_run.id}`
- **Check runs**: `github-{check_run.id}`
- **Deployments**: `github-deployment-{deployment.id}`

---

## GitLab Support

This integration also supports GitLab CI/CD webhooks:

```json
{
  "object_kind": "build",
  "build_status": "failed",
  "ref": "main",
  "project": {
    "name": "my-project",
    "path_with_namespace": "mygroup/my-project",
    "web_url": "https://gitlab.com/mygroup/my-project"
  },
  "commit": {
    "message": "Fix bug"
  }
}
```

---

## Testing

### Using GitHub UI

1. Go to repository **Settings** → **Webhooks**
2. Click on your webhook
3. Scroll to **Recent Deliveries**
4. Click **Redeliver** on a previous delivery
5. Or trigger a workflow failure manually

### Using cURL

Send a test payload directly:

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/github?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "completed",
    "repository": {
      "name": "test-repo",
      "full_name": "myorg/test-repo",
      "html_url": "https://github.com/myorg/test-repo"
    },
    "workflow_run": {
      "id": 999999,
      "name": "Test Workflow",
      "status": "completed",
      "conclusion": "failure",
      "html_url": "https://github.com/myorg/test-repo/actions/runs/999999"
    }
  }'
```

---

## Troubleshooting

### Webhooks Not Received

1. **Check webhook deliveries** in GitHub settings
2. **Verify URL** is correct and accessible
3. **Check for network/firewall** issues

### 401 Unauthorized Error

1. **Check signing secret** matches in both OpsKnight and GitHub
2. **Remove secret** from OpsKnight if not using signature verification

### No Incident for Failures

1. **Verify events** are selected in webhook configuration
2. **Check conclusion** is `failure`, `timed_out`, or `cancelled`
3. **Ensure workflow/check** has actually completed

### Incidents Not Resolving

1. Successful runs should automatically resolve incidents
2. **Verify webhook** receives success events

---

## Related Topics

- [Bitbucket Integration](./bitbucket) — Bitbucket Pipelines
- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
