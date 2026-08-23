---
title: Status page
description: Publish service health, incidents, maintenance, uptime, subscriptions, feeds, and signed webhooks safely.
order: 9
---

# Status page

OpsKnight provides one workspace status page at `/status`. Administrators choose which services and incident data are shown, configure branding and access, publish announcements, manage subscribers, expose a status feed/API, and send signed outbound webhooks.

Only an application **Admin** can configure the status page and its integrations. Public or authenticated readers see the rendered page according to privacy settings.

## Before enabling the page

The status page is an external communication surface. Review it with operations, security, legal, and support owners before publishing.

- Decide whether the page is public or requires OpsKnight authentication.
- Classify which service, incident, team, assignee, region, custom-field, postmortem, and uptime data may leave the workspace.
- Configure a stable application URL and HTTPS.
- Test the page from a signed-out browser and from outside the internal network.
- Use synthetic incidents and subscribers; never test with customer secrets.

## Configure the page

Open **Settings → Status Page**. The editor is organized into General, Appearance, Services, Privacy & Data, Content, Announcements, Integrations, Subscribers, Custom CSS, and Advanced sections.

### General

Set the page name, organization name, enabled state, footer, contact email or URL, subdomain/custom-domain values, and basic metadata.

The default public path is:

```text
https://YOUR_OPSKNIGHT_HOST/status
```

Saving a subdomain or custom domain does not provision DNS, TLS, a load balancer, or reverse-proxy routing. Configure your infrastructure so the hostname reaches OpsKnight over HTTPS, then verify links in subscription emails and feeds use the intended public base URL.

### Appearance

Choose a built-in theme, logo/favicon, colors, typography, default/compact/wide layout, header style, and supported display effects. Use the live preview, then check real desktop and mobile rendering.

Custom CSS can override generated presentation and can break readability or accessibility. Keep a copy outside the form, test focus/contrast/responsive behavior, and remove the CSS first when diagnosing visual defects.

### Services

Select the services included on the page. For each selected service you can set a public display name, ordering, and whether it is visible. Inclusion is explicit: owning a service or creating a public incident does not automatically add the service.

Calculated public health derives from included services and their active incidents. Service detail and metrics can be hidden independently through privacy/content controls.

### Content and metrics

Choose whether to show services, incidents, metrics, subscription controls, recent incidents, uptime history, a region heatmap, change-log content, and published post-incident reviews. Configure excellent/good uptime color thresholds; the defaults are 99.9% and 99.0%.

Thresholds affect presentation, not historical incident records or contractual SLA configuration. Uptime values are calculated from incident history available within retention.

## Privacy and access

Use a preset as a starting point, then review every field. Editing an individual control changes the mode to Custom.

| Mode           | Intended use                                                           |
| -------------- | ---------------------------------------------------------------------- |
| **Public**     | Broad external visibility with detailed content enabled by the preset. |
| **Restricted** | Reduced operational detail.                                            |
| **Private**    | Minimal disclosure and authentication-oriented use.                    |
| **Custom**     | Explicit per-field choices.                                            |

Controls cover incident titles/descriptions/timestamps/urgency/assignees/affected services, service descriptions/regions/owners/SLA tier/team data, custom fields, uptime, recent history, maximum incident count, history days, allowed custom fields, and data-retention hiding.

### Require authentication

When **Require authentication** is enabled, `/status`, `/api/status`, and RSS access require an OpsKnight session in addition to any configured status-API token behavior. This is application authentication, not an independent public-status customer identity system.

Always verify in a private browser window. A privacy preset name alone is not an access-control test.

### Incident and postmortem visibility

An incident must be public, belong to an included service, fall within the applicable history/retention window, and pass the page's privacy controls before its details are eligible for display. A postmortem must also be published and marked public. See [Postmortems](postmortems.md).

Never place secrets or regulated personal data in incident fields that might be allowed onto the page.

## Announcements and maintenance

Announcements can communicate an informational update, warning, maintenance, incident-related notice, or other type exposed by the editor. Provide a title, message, start date, optional end date, active state, and affected services. You can request subscriber notification when creating it.

Use announcements for customer-facing communication; they do not replace the underlying incident record or schedule operational maintenance automatically.

For planned maintenance:

1. Select affected services.
2. Set explicit start and end times and include the timezone in the message.
3. State expected impact and a support contact.
4. Publish early and verify the public rendering.
5. Update or end the notice when the work finishes.

The public page shows a limited number of current/recent announcements. Keep the active set concise.

## Email subscriptions

When subscriptions are enabled, a reader submits an email address and receives a verification link. Only verified, non-unsubscribed records should be treated as active recipients. Readers can unsubscribe through their unique link.

### Configure delivery

1. Choose or configure the status-page email provider in the Subscribers section.
2. Enable the subscription control.
3. Subscribe a test mailbox.
4. Follow the verification link and confirm status.
5. Trigger a synthetic public incident update and confirm delivery.
6. Test unsubscribe and resubscribe.

Subscription requests are limited to 10 per IP per minute and 3 per status-page/email pair per minute. When no valid email provider is configured, the subscription record can be created but the verification email is not sent; inspect logs and provider configuration.

Admins can search and filter subscribers and inspect verification/unsubscribe state. Treat the subscriber list as personal data and apply retention/privacy policy.

## Status JSON API and RSS

The status surface includes:

```text
GET /api/status
GET /api/status/rss
```

`/api/status` returns overall status, included services, recent incidents, 30-day uptime data, retention bounds, and update time. RSS returns public incident updates for the configured services.

These endpoints are documented here as part of status-page operation; they are not part of the versioned public automation index alongside Events and Incidents APIs.

### Protect the status API

In **Advanced → Status API Access**, an Admin can require a status API token and enable a configurable request limit (default 120 requests per 60 seconds).

Create a named token and copy it once. Send it preferably as:

```http
Authorization: Bearer STATUS_PAGE_TOKEN
```

A `token` query parameter is accepted but can leak through URLs, browser history, proxy logs, and analytics. Prefer the header. Revoked tokens stop working and token use updates `lastUsedAt`.

If rate limiting is enabled, a rejected request returns `429` and may include `Retry-After`.

## Uptime exports

Admins can enable monthly uptime exports and download CSV or a simple PDF for the latest month from the Advanced section. The endpoint also accepts a `month=YYYY-MM` query when used by an authenticated Admin.

Exports include selected visible services and calculated monthly uptime. They require the page to be enabled, at least one visible service, the export toggle, and Admin authentication. Retention limits can affect historical accuracy; retain authoritative SLA reports separately when required.

## Outbound status-page webhooks

In **Integrations**, add an HTTPS endpoint and select events. The configured UI offers incident created, updated, resolved, status changed, and maintenance scheduled.

Verified v1.4 incident writers emit `incident.created`, `incident.updated`, and `incident.resolved`. Do not depend on `status.changed` or `maintenance.scheduled` until a repeatable test confirms the specific workflow emits them. Acknowledgement paths can emit an internal `incident.acknowledged` event, but that value is not selectable in the current webhook editor.

Payload envelope:

```json
{
  "event": "incident.updated",
  "timestamp": "2026-08-21T12:00:00.000Z",
  "data": {}
}
```

Delivery uses `POST` with:

```text
Content-Type: application/json
X-Webhook-Event: incident.updated
X-Webhook-Signature: sha256=HEX_HMAC
User-Agent: OpsKnight-StatusPage/1.0
```

Verify `X-Webhook-Signature` by computing HMAC-SHA256 over the exact raw request body with the webhook secret and comparing in constant time. Reject an unexpected event before processing. Endpoints must pass OpsKnight's outbound-network safety validation.

Delivery times out after 10 seconds and retries eligible network, timeout, `429`, and `5xx` failures up to three attempts. Use an idempotency strategy based on event and incident data; delivery is not an exactly-once contract. The settings page can send a test event.

## RSS and auto-refresh

The RSS URL is `/api/status/rss` and is advertised in page metadata. Status API token/rate-limit and page authentication controls also apply to the feed.

The public page can auto-refresh at the configured interval. Readers may still have cached network intermediaries, so incident communication should not depend on refresh alone.

## Launch checklist

- [ ] HTTPS public URL and base URL are correct.
- [ ] Page access matches Public/Restricted/Private intent when signed out.
- [ ] Only approved services and fields are visible.
- [ ] A public test incident appears, updates, resolves, and disappears according to retention.
- [ ] A private incident and hidden custom field do not appear.
- [ ] Mobile layout, focus order, contrast, logo, metadata, and contact links work.
- [ ] Verification, subscriber notification, unsubscribe, and resubscribe work.
- [ ] JSON, RSS, API token, revocation, and rate limiting work as configured.
- [ ] Webhook HMAC validation, retry/idempotency, and test delivery work.
- [ ] CSV/PDF uptime exports work if enabled.
- [ ] Support and incident commanders know who owns public updates.

## Troubleshooting

### The page says it is disabled

Enable it in settings and save. If no configuration exists, `/status` attempts to create a default page; a migration error means the database schema is not current. Use the deployment's supported migration process rather than an ad-hoc production schema push.

### A service or incident is missing

Check service selection and `showOnPage`, incident visibility, privacy controls, incident-history and retention limits, page enabled state, and whether the record belongs to an included service.

### A custom domain does not resolve

Confirm DNS, certificate, proxy/load-balancer host routing, application base URL, and trusted proxy headers. Saving the hostname in OpsKnight does not provision infrastructure.

### Subscribers receive nothing

Check verification state, unsubscribe state, selected status email provider, sender/domain verification, logs, public incident eligibility, and whether notification was requested for the change.

### Status API returns 401 or 429

For `401`, check page authentication, token requirement, exact Bearer value, and revocation. For `429`, honor `Retry-After` and inspect the configured window and token/IP identity.

### Webhook delivery fails

Confirm a selectable verified event, endpoint HTTPS/network reachability, SSRF-safe destination, response time under 10 seconds, HMAC over the raw body, and handling of retries.

## Related topics

- [Services](services.md)
- [Incident management](incidents.md)
- [Postmortems](postmortems.md)
- [Analytics](analytics.md)
- [Troubleshooting](../troubleshooting.md)
