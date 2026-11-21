---
title: Connect Squire to metrics, logs, traces and code
description: Add read-only observability connections so the Squire assistant can query metrics, logs, traces, error events and change diffs during AI answers.
type: how-to
product_area: intelligence
audience: [administrator, operator]
reader:
  status: SOURCE_VERIFIED
  task: Add, scope, test and remove a read-only observability connection for Squire.
verification:
  level: test
  verified_at: 2026-11-08
  evidence:
    [
      src/lib/intelligence/connectors,
      src/lib/intelligence/squire/tools-observability.ts,
      tests/unit/intelligence-connectors.test.ts,
      tests/integration/intelligence/observability-connectors.test.ts,
      tests/integration/intelligence/connection-actions.test.ts,
      tests/components/settings/ObservabilityConnectionForms.test.tsx,
    ]
---

# Connect Squire to metrics, logs, traces and code

When AI is on, Squire can query your observability tools while it answers, for example "did checkout
errors rise after the 14:02 deploy?" or "show me the error logs around this incident". Connections are
**read-only**, **off until you enable them**, and limited to the teams you choose. Without any connection,
Squire keeps answering from OpsKnight data only.

You need the **Manage intelligence** permission. Connections are used only in AI answers. Basic mode
never contacts them.

## Supported backends

| Type          | Squire can read                                            | Credential                                            | Extra settings                                                                                                                                |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Prometheus    | metrics (PromQL)                                           | optional bearer token, or user name and password      | none                                                                                                                                          |
| Grafana Loki  | logs (LogQL)                                               | optional bearer token, or user/tenant and token       | none                                                                                                                                          |
| Grafana Tempo | traces (by id, or TraceQL search)                          | optional bearer token, or user name and password      | none                                                                                                                                          |
| Grafana       | metrics and logs via a data source                         | service account token (Viewer)                        | data source UID, optional org ID                                                                                                              |
| Datadog       | metrics, logs, traces                                      | API key and application key                           | base URL for your Datadog site                                                                                                                |
| Elasticsearch | logs (Lucene query string)                                 | API key, or user name and password                    | index pattern (default `logs-*`)                                                                                                              |
| CloudWatch    | metrics (Metrics Insights), logs                           | access key ID and secret access key                   | region; log group for log search                                                                                                              |
| Sentry        | error issues                                               | auth token (`event:read`, `project:read`)             | organization slug, optional project                                                                                                           |
| GitHub        | commit, pull request, compare diffs                        | fine-grained token, read-only Contents and PRs        | API URL for GitHub Enterprise                                                                                                                 |
| GitLab        | commit and merge request diffs                             | access token with `read_api`                          | base URL for self-managed GitLab                                                                                                              |
| Azure DevOps  | commit and PR diffs, recent commits and PRs, pipeline runs | PAT with read-only Code and Build                     | organization or collection URL (`https://dev.azure.com/<org>` or Azure DevOps Server `https://<host>/<collection>`), optional default project |
| Argo CD       | application sync, health, deploy history, resource health  | API token for a role allowed `applications, get`      | API server URL                                                                                                                                |
| base14 Scout  | metrics, logs, traces, APM KPIs, service topology          | API key client ID and client secret (Scout Read role) | organization slug; base URL blank (discovered) or a `*.base14.io` override                                                                    |

Use the narrowest read-only credential each vendor offers. OpsKnight only ever sends GET requests, or a
read-only search POST where the vendor's API requires one (Datadog log search, Elasticsearch `_search`,
and every CloudWatch call, which is signed with AWS Signature Version 4).

### Azure DevOps, Argo CD and base14 Scout

- **Azure DevOps** sends the PAT as Basic auth with an empty user name and uses API version 6.0, served by
  both Azure DevOps Services and Azure DevOps Server. Change links of the form
  `<base URL>/<project>/_git/<repo>/commit/<sha>` or `/pullrequest/<id>` are read by `get_change_diff` (file
  list and change type; Azure DevOps has no unified patch in its API).
- **Argo CD** is read only. Deploys reach change correlation through the existing Argo CD notification
  webhook (`/api/integrations/argocd`); the connection adds live status for Squire.
- **base14 Scout** uses OAuth2 client credentials: OpsKnight exchanges the client ID and secret at
  `https://id.base14.io/realms/<org>/protocol/openid-connect/token`, keeps the access token in server
  memory only until shortly before it expires, and looks up the organization's Scout API URL from
  `https://api.base14.io/v1/discovery/services/<org>`. Only HTTPS `base14.io` hosts are ever contacted,
  so a private-network address cannot be allowed. Scout's per-endpoint window limits are applied before
  the request: logs read the newest hour in 15-minute chunks, metrics and topology the newest hour,
  traces up to 24 hours, never more than 30 days back. Queries are `key=value` filters, for example
  `service=checkout metric=http.server.duration attr_http.method=GET` or
  `service=checkout severity=ERROR payment declined` (free text matches the log body); attribute keys
  must use the `attr_`, `resource_attr_`, `log_attr_` or `span_attr_` prefix of the signal.

## Add a connection

1. Go to **Settings → Intelligence → Assistant → Connections** and open **Add a connection**.
2. Choose the type, give it a name and enter the base URL (leave it blank for Datadog US1, Sentry SaaS,
   github.com and gitlab.com).
3. Enter the credential. It is encrypted with the application encryption key, never shown again, never
   logged and never written to the audit log (the audit entry only records that it was replaced).
4. Optionally choose the **teams** allowed to use it. None selected means everyone who can use the
   assistant. People who can read every service (administrators) can always use enabled connections.
5. Set a **timeout** (1 to 30 seconds, default 10).
6. Save, then press **Test connection**. The test runs one harmless read (for example Prometheus build
   info, the GitHub rate limit, CloudWatch `ListMetrics`) and reports only a fixed result: connected,
   rejected credentials, unreachable, timed out, too large or not allowed.
7. Turn on **Enabled** when the test passes.

### Private-network addresses

By default the base URL must be HTTPS and resolve to public addresses, checked when you save and again
on every request, with redirects refused. To reach an internal host (for example a Prometheus inside
your VPC), tick **Allow a private-network address**. Only that exact origin is ever contacted. Cloud
metadata and link-local addresses (such as `169.254.169.254`) are always refused, with or without
consent. To move a connection to a different address or type you must enter its credential again, so a
stored secret can never be redirected to another host.

## What Squire does with it

Squire is offered a tool only when you have at least one enabled connection that can answer it:

| Tool                      | Answers                                                                                                         | Data class |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| `query_metrics`           | per-series min, max, mean, last value, the biggest jump and a few samples (up to 8 series)                      | Internal   |
| `search_logs`             | the newest 15 matching lines with timestamps                                                                    | Personal   |
| `get_traces`              | up to 3 span trees, slowest paths first, errors marked                                                          | Internal   |
| `get_error_events`        | up to 10 Sentry issues with event and user counts                                                               | Internal   |
| `get_change_diff`         | changed files, additions and deletions and a truncated patch for a recorded change                              | Internal   |
| `get_repo_activity`       | the 10 newest commits and pull requests on an Azure DevOps repository branch                                    | Internal   |
| `get_azure_pipeline_runs` | the 10 newest Azure Pipelines runs; for the newest failure its failed jobs and tasks and the last 40 log lines  | Personal   |
| `get_deployment_status`   | Argo CD applications, or one application's sync, health, last operation, deploy history and unhealthy resources | Internal   |
| `get_apm_kpis`            | base14 Scout errors, error %, throughput and latency percentiles for a service                                  | Internal   |
| `get_service_topology`    | base14 Scout service map or one service's dependencies (up to 50 edges), or the service list                    | Internal   |

- **Bounded windows.** By default the window is one hour around the incident's start, or the last hour.
  It is never longer than 24 hours and never extends into the future.
- **Bounded responses.** A response larger than 2 MB is refused unread, and every result is summarised
  before the model sees it.
- **Redaction.** Credential-shaped text is removed from every result. Internal results also lose email
  addresses and phone numbers. Log lines can contain customer data, so log search is classed as Personal
  and is only used with a provider allowed to receive Personal data.
- **Re-checked on use.** The connection is checked again each time a tool runs, so disabling it or
  removing a team takes effect immediately, including for citations in saved conversations.
- **Diffs follow your changes.** `get_change_diff` reads the commit, pull request, compare view or merge
  request linked from a recorded change (`ChangeEvent.url`). It uses the GitHub or GitLab connection whose
  host matches that link (or the Azure DevOps connection whose base URL the link starts with), and only for changes you can see.

## Remove a connection

Open the connection and press **Remove**, then confirm. Squire stops using it immediately and the stored
credential is deleted. Every add, edit and removal is in the audit log as
`intelligence.connector.created`, `intelligence.connector.updated` or `intelligence.connector.deleted`.

## Troubleshooting

| Test result                  | What to check                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| This address is not allowed  | The URL is not HTTPS, resolves to a private address without consent, or is a metadata address.      |
| Could not reach the endpoint | DNS, firewall and egress from the OpsKnight servers to that host.                                   |
| Rejected the credentials     | The token is wrong, expired or lacks read scope.                                                    |
| Did not answer in time       | Raise the timeout, or check the backend's health.                                                   |
| Missing a required setting   | CloudWatch needs a region and access keys; Grafana needs a data source UID; Sentry an organization. |
