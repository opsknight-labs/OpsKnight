---
title: OpsKnight documentation
description: Install, page people, run incidents, and connect tools for this version.
order: 1
---

# Documentation

OpsKnight is a transparent, self-hosted incident-operations platform. It connects alert ingestion, on-call routing, response coordination, customer communication, and learning on infrastructure you control.

This tree is **v1.5**. Switch versions in the sidebar for older releases.

## Start here

- [Getting started](./getting-started) — 15 minutes to a test incident on Compose
- [Services](./core-concepts/services) — Redesigned service workspace, SLA metrics, escalation, and alert integrations
- [Navigation, search, and alerts](./core-concepts/navigation-search-notifications) — Find records and use the in-app inbox
- [Installation](./getting-started/installation) — Compose, Helm, Kustomize, from source. First boot needs `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`.
- [Troubleshooting](./troubleshooting) — Compose, database, auth, paging
- [Notifications](./administration/notifications) — How someone actually gets paged (no voice), including user-controlled Quiet Hours.
- [Prometheus metrics](./deployment/prometheus) — Secure scraping, Helm/Compose/Kustomize setup, PromQL, recording rules, and alerts.
- [Incidents](./core-concepts/incidents)
- [Escalation policies](./core-concepts/escalation-policies)
- [On-call schedules](./core-concepts/schedules)
- [Teams](./core-concepts/teams)
- [Slack ChatOps](./integrations/communication/slack-chatops) — war rooms in this version
- [PagerDuty Events API v2 ingest](./integrations/custom/pagerduty-emulation)
- [Status page](./core-concepts/status-page) — one public/private page per install
- [OIDC SSO](./security/oidc-setup)
- [Encryption](./security/encryption)
- [API](./api)
- [Mobile](./mobile/README) — mobile routes, PWA, push, and exact offline support
- [Accessibility](./accessibility/README) — keyboard, focus, screen-reader, motion, and testing boundaries
- [Enterprise robustness audit](./enterprise-robustness-audit) — validated findings, remediation evidence, and certification gates

SSO is **OIDC**, not SAML. v1.5 has no native MFA, passkey login, or email magic-link flow; enforce MFA at the OIDC provider or access proxy. Microsoft Teams and Google Chat are **webhook formats**, not Slack-style rooms.
