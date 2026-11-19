---
title: Integration tasks
description: Create, test, and troubleshoot inbound alert integrations, and where the copied integration URLs get their hostname.
type: concept
product_area: integrations
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-11-19
  evidence:
    - src/app/api/integrations/
    - src/lib/app-url.ts
    - src/lib/integrations/ingest-url.ts
    - src/app/(app)/services/[id]/page.tsx
    - tests/lib/integration-ingest-url.test.ts
---

# Integration tasks

Start with the provider page in the [integration catalog](../../../v2.1.0/integrations/README.md).
After saving the integration, [send a test event](../../../v2.1.0/guides/integrations/send-test-event.md)
and verify service mapping, deduplication, urgency, and recovery behavior. If the request is
rejected, use [integration troubleshooting](../../../v2.1.0/troubleshooting/integrations/README.md).

## Where the copied URL comes from

On a service's **Integrations** tab, the webhook URL you copy for a provider, the Events API
endpoint and the cURL sample all start with OpsKnight's **Application URL**, resolved in this
order:

1. **Settings → System → App URL**, when an administrator has saved one.
2. `NEXT_PUBLIC_APP_URL`.
3. `NEXTAUTH_URL`.
4. `http://localhost:3000`.

A trailing slash on the saved value is ignored, so the copied URL never contains `//api`.
Events API v2 integrations always post to `<Application URL>/api/events`; other providers post to
`<Application URL>/api/integrations/<provider>?integrationId=…&integrationKey=…`.

> **Changed in 2.2.0.** In 2.1.0 the service page built these URLs from `NEXT_PUBLIC_APP_URL`
> (or `NEXTAUTH_URL`) only, so they could disagree with **Settings → System → App URL**. If you
> copied an integration URL in 2.1.0 and the two values differ, check the hostname configured in
> the provider. It still works only while that host is an allowed application host (see
> [Application URL and host routing](../../../v2.1.0/operate/deploy/application-url-and-host-routing.md)).
