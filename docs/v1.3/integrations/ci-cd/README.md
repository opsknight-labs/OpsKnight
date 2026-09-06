---
order: 6
title: CI/CD & DevOps
description: Continuous integration, pipeline alerts, and deployment monitoring.
---

# CI/CD & DevOps Integrations

Detect failed deployments and pipeline issues before they impact users.

## Available Integrations

<!-- integrations-list:start -->

- [GitHub Actions](./ci-cd/github) — Receive GitHub Actions workflow run failures and repository security alerts.
- [GitLab CI/CD](./ci-cd/gitlab) — Track GitLab pipeline errors and auto-resolve upon successful subsequent builds.
- [Bitbucket Pipelines](./ci-cd/bitbucket) — Receive Bitbucket Pipeline failure alerts in OpsKnight.
- [Vercel Deployments](./ci-cd/vercel) — Monitor production deployments, build errors, and preview deployment failures.
<!-- integrations-list:end -->

---

## Capabilities Comparison

| Platform | Event Triggers | Auto-Resolve Supported | Signature Verification |
| :--- | :--- | :---: | :---: |
| **GitHub Actions** | `workflow_run.completed` (`failure`) | Yes | SHA-256 HMAC (`X-Hub-Signature-256`) |
| **GitLab CI/CD** | `Pipeline Hook` (`failed`) | Yes | Secret Token (`X-Gitlab-Token`) |
| **Bitbucket** | `repo:commit_status_updated` | Yes | Token Header / HMAC |
| **Vercel** | `deployment.error`, `deployment.canceled` | Yes | SHA-1 HMAC (`x-vercel-signature`) |
