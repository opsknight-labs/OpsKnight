---
order: 6
title: CI/CD & DevOps
description: Continuous integration, pipeline alerts, and deployment monitoring.
---

# CI/CD & DevOps Integrations

Detect failed deployments and pipeline issues before they impact users.

## Available Integrations

<!-- integrations-list:start -->

- [GitHub Actions](./github) — Correlate workflow and check failures with later recovery.
- [GitLab CI/CD](./gitlab) — Process pipelines, jobs, merge requests, deployments, issues, incidents, and alerts.
- [Bitbucket Pipelines](./bitbucket) — Receive build failures with an explicit native recovery boundary.
- [Vercel Deployments](./vercel) — Monitor production deployments, build errors, and preview deployment failures.

<!-- integrations-list:end -->

---

## Capabilities Comparison

| Platform           | Event Triggers                          | Recovery behavior                                               | Signature verification                               |
| :----------------- | :-------------------------------------- | :-------------------------------------------------------------- | :--------------------------------------------------- |
| **GitHub Actions** | Workflow runs and check runs            | Yes, when repository/name/branch correlation matches            | SHA-256 HMAC (`X-Hub-Signature-256`)                 |
| **GitLab CI/CD**   | Pipelines, jobs, MRs, deployments, more | Event-specific; see the exact key/action matrix                 | Secret token (`X-Gitlab-Token`)                      |
| **Bitbucket**      | Build-status events                     | Native success payload does not auto-resolve in v1.3            | Integration key; native Bitbucket HMAC is mismatched |
| **Vercel**         | `deployment.error`, `deployment.failed` | Yes only when a recovery event has the same derived project key | SHA-1 HMAC (`x-vercel-signature`)                    |
