---
title: GitLab CI/CD Integration Guide
description: Ingest GitLab pipeline failures and auto-resolve on branch success in OpsKnight.
version: v1.3
---

# GitLab CI/CD Integration Guide

OpsKnight natively integrates with **GitLab.com and self-hosted GitLab CE/EE** via Webhooks.

---

## 🎯 Key Capabilities

- **Pipeline Failure Alerting**: Triggers `HIGH` or `CRITICAL` incidents when CI/CD pipelines fail on monitored branches (e.g. `main`, `production`, `release/*`).
- **Automatic Recovery**: When a subsequent pipeline run succeeds on the same branch, the active incident is automatically resolved.
- **Merge Request Context**: Preserves commit author, commit message, commit SHA link, and merge request URLs in custom incident details.
- **Secret Token Security**: Authenticates incoming payloads using the `x-gitlab-token` secret header.

---

## 🚀 Setup Instructions

### 1. In OpsKnight
1. Go to **Services** $\to$ select target service $\to$ **Integrations** tab.
2. Click **Add Integration** $\to$ choose **GitLab**.
3. Copy the **Webhook URL** and **Integration Key / Secret Token**.

```
https://your-opsknight.com/api/integrations/gitlab?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

### 2. In GitLab
1. Open your GitLab Project $\to$ **Settings** $\to$ **Webhooks**.
2. Click **Add new webhook**.
3. **URL**: Paste your OpsKnight Webhook URL.
4. **Secret token**: Paste your OpsKnight Integration Key or configured `signatureSecret`.
5. **Trigger Events**:
   - Check ☑️ **Pipeline events**
   - Optionally check ☑️ **Job events**
6. **SSL verification**: Keep ☑️ **Enable SSL verification** checked.
7. Click **Add webhook**.

---

## 🔍 Payload Processing & Deduplication

- **Deduplication Key**: Generated per project and branch/ref (e.g. `gitlab-myorg-myrepo-main`). This guarantees that multiple pipeline retries on the same branch resolve the existing incident instead of creating noisy duplicate alerts.
- **Status Lifecycle**:
  - `failed` $\to$ Triggers incident
  - `success` $\to$ Auto-resolves active incident
  - `canceled` / `running` / `pending` $\to$ Acknowledges / updates timeline
