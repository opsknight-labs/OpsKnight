---
order: 4
title: System Settings
description: Safely manage workspace-wide application URL, OIDC, retention, encryption, and performance settings
---

# System Settings

**Settings → System** is an administrator-only workspace control surface. Its settings affect authentication callbacks, links in messages and webhooks, retention, credential storage, and performance investigation. Make one high-impact change at a time and verify the affected flow before making the next.

## Application URL

The application URL is used in email links, webhook payloads, RSS, public status-page links, and the displayed OIDC callback URL. The effective value has this precedence:

1. The database value set in **Settings → System → Application URL**.
2. `NEXT_PUBLIC_APP_URL` in the deployment environment.
3. `http://localhost:3000` as a development fallback.

Set an externally reachable, canonical `https://` URL in production. A database value can be cleared to return to the environment fallback. The settings form accepts `http` or `https`, but production deployments should use HTTPS.

Before changing the URL, update reverse-proxy/ingress routes and the OIDC provider's allowed redirect URI. After saving, test a notification link, an RSS/status link, an inbound/outbound webhook URL as applicable, and a fresh OIDC sign-in in a private browser window.

## OIDC and encryption

The System page exposes the OIDC configuration and displays a callback URL derived from the effective application URL. OIDC client secrets require a valid `ENCRYPTION_KEY`; in production the page warns when that key is missing.

Do not rotate the application URL, OIDC configuration, and encryption key in one change window. Each has a separate failure mode and rollback decision. Follow [Authentication](./authentication), [OIDC SSO setup](../security/oidc-setup), and [Encryption](../security/encryption) for their complete procedures.

## Retention

Retention controls are system-wide and destructive when cleanup executes. The System page opens the retention workflow, but its policy, preview, and recovery boundaries are documented separately in [Data retention](./data-retention). Take a tested database backup before reducing a window.

## Administrator Health Center

The System page links to **Administrator Health Center**, an Admin-only on-demand summary of database connectivity and capacity, migrations, scheduler and job health, paging configuration and backlog, notification and integration failures, SLA-query performance, current-process runtime, public URL consistency, encryption configuration, and release availability. The former Performance Monitoring route redirects here so administrators have one operational destination.

Unknown evidence is not reported as healthy. The Health Center complements the incident timeline and external infrastructure, database, backup, and provider monitoring; see the [Health Center guide](./health-center.md) for thresholds and boundaries.

## Safe change procedure

1. Record the current value, deployment version, and a rollback owner.
2. Confirm a second active administrator has access.
3. Take or verify a database backup for destructive or credential-related work.
4. Change one setting and save it.
5. Test the directly affected path using a normal user session or external recipient where relevant.
6. Review application logs, notification history, and audit records.
7. Document the result and rollback plan before proceeding to another setting.

The browser settings endpoints are internal UI implementation details, not published API-key automation contracts.

## Related topics

- [Authentication](./authentication)
- [Encryption](../security/encryption)
- [Data retention](./data-retention)
- [Configuration reference](../getting-started/configuration)
- [Maintenance](../deployment/maintenance)
- [Administrator Health Center](./health-center)
