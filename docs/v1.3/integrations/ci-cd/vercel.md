---
title: Vercel Deployments Integration Guide
description: Monitor Vercel build and runtime deployment failures in OpsKnight with automatic recovery.
version: v1.3
---

# Vercel Deployments Integration Guide

OpsKnight natively integrates with **Vercel** via Webhooks to monitor frontend build failures, runtime errors, and deployment health.

---

## 🎯 Key Capabilities

- **Production vs Preview Isolation**: Production errors create high-priority incidents (`critical`); preview errors are scoped with unique deployment IDs to prevent clobbering other PRs.
- **Auto-Resolve on Deploy Success**: When a failed production deployment is followed by a successful deployment, OpsKnight automatically resolves the incident.
- **HMAC Signature Verification**: Validates the `x-vercel-signature` SHA-1 HMAC against your configured webhook secret.

---

## 🚀 Setup Instructions

### 1. In OpsKnight
1. Go to **Services** $\to$ select target service $\to$ **Integrations** tab.
2. Click **Add Integration** $\to$ choose **Vercel**.
3. Copy your **Webhook URL** and **Integration Key**.

```
https://your-opsknight.com/api/integrations/vercel?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

### 2. In Vercel
1. In your Vercel Dashboard, go to your Team/Project **Settings** $\to$ **Webhooks**.
2. Click **Create Webhook**.
3. **Endpoint URL**: Paste your OpsKnight Webhook URL.
4. **Events**: Select:
   - `deployment.created`
   - `deployment.succeeded`
   - `deployment.error`
   - `deployment.canceled`
5. (Optional) Set a **Secret** and save the same secret in OpsKnight as `signatureSecret`.
6. Click **Create**.

---

## 🔍 Event Mapping

| Vercel Event | OpsKnight Action | Severity |
| :--- | :--- | :--- |
| `deployment.error` | `trigger` | `critical` (Production) / `error` (Preview) |
| `deployment.succeeded` | `resolve` | `info` |
| `deployment.canceled` | `acknowledge` | `warning` |
| `deployment.created` | `acknowledge` | `info` |
