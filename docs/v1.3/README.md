---
title: OpsKnight documentation
description: Install, page people, run incidents, and connect tools for this version.
order: 1
---

# Documentation

OpsKnight is a self-hosted incident product: on-call, paging, incidents, status, and postmortems on your machines.

This tree is **v1.3**. Switch versions in the sidebar for older releases.

## Start here

- [Getting started](./getting-started) — 15 minutes to a test incident on Compose
- [Installation](./getting-started/installation) — Compose, Helm, Kustomize, from source. First boot needs `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`.
- [Troubleshooting](./troubleshooting) — Compose, database, auth, paging
- [Notifications](./administration/notifications) — How someone actually gets paged (no voice).
- [Incidents](./core-concepts/incidents)
- [Escalation policies](./core-concepts/escalation-policies)
- [On-call schedules](./core-concepts/schedules)
- [Slack ChatOps](./integrations/communication/slack-chatops) — war rooms in this version
- [PagerDuty Events API v2 ingest](./integrations/custom/pagerduty-emulation)
- [Status page](./core-concepts/status-page) — one public/private page per install
- [OIDC SSO](./security/oidc-setup)
- [Encryption](./security/encryption)
- [API](./api)
- [Mobile](./mobile/README) — mobile routes, PWA, push, and exact offline support
- [Accessibility](./accessibility/README) — keyboard, focus, screen-reader, motion, and testing boundaries

SSO is **OIDC**, not SAML. Microsoft Teams and Google Chat are **webhook formats**, not Slack-style rooms.
