---
title: OpsKnight documentation
description: Install, page people, run incidents, and connect tools for this version.
order: 1
---

# Documentation

OpsKnight is a self-hosted incident product: on-call, paging, incidents, status, and postmortems on your machines.

This tree is **v1**. Latest docs: switch to v1.3 in the sidebar. Slack war rooms are documented from v1.2.

## Start here

- [Installation](./getting-started/installation) — Compose or Helm. First boot needs `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`.
- [Notifications](./administration/notifications) — How someone actually gets paged (no voice).
- [Incidents](./core-concepts/incidents)
- [Escalation policies](./core-concepts/escalation-policies)
- [On-call schedules](./core-concepts/schedules)
- [Slack notifications](./integrations/communication/slack)
- [Status page](./core-concepts/status-page)
- [OIDC SSO](./security/oidc-setup)
- [Encryption](./security/encryption)
- [API](./api)

SSO is **OIDC**, not SAML. Microsoft Teams and Google Chat are **webhook formats**, not Slack-style rooms.
