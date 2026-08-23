# OpsKnight v1.4 documentation capability inventory

This maintainer-only inventory is the completeness gate for the v1.4 documentation work begun in PR #327 and finally reconciled in PR #342 after intermediate phase batches merged. It intentionally lives outside `docs/v1.4`, so docs-sync does not publish it as an end-user page.

## How to use this inventory

- **Complete** means the destination explains how to use and verify the capability and states material limits.
- **Revise** means a destination exists but still requires a source-verified rewrite.
- **Add** means the supported capability has no adequate destination yet.
- **Internal** means implementation detail may support public behavior but is not itself a public contract.
- **Unsupported** means an older document or index claimed behavior that v1.4 does not provide; the claim must be removed or called out as unavailable.
- A phase cannot close while any row assigned to it remains **Add** or **Revise**.

Evidence is based on v1.4 application routes, components, Prisma schema, deployment manifests, tests, and repeatable product workflows. Maintainers should add a PR link or test result to a row when verification needs more context than a source path.

## Accountability and verification

The documentation maintainer owns inventory state and link/navigation quality on #342. The product-area reviewer owns behavioral acceptance for the phase they approve; the release owner owns the final clean-install, upgrade, recovery, and docs-sync checks. Record reviewer names in the PR description rather than hard-coding people in this long-lived file.

| Phase area                          | Required reviewer                    | Verification record                                                                         |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Getting started and core response   | Product/incident-response maintainer | Clean Compose run plus routing/lifecycle acceptance evidence in the final delivery PR.      |
| Integrations and notifications      | Integration/provider owner           | Signed trigger/resolve fixtures and controlled outbound delivery evidence.                  |
| Deployment and maintenance          | Platform/database owner              | Render/dry-run, backup/restore, migration, readiness, and scheduler evidence.               |
| Administration and security         | Security/auth owner                  | Role matrix, OIDC/local login, session, encryption, audit, and recovery evidence.           |
| API and CLI                         | API maintainer                       | Copy-paste requests, 4xx/429 cases, scope checks, and recovery-CLI evidence.                |
| Architecture, mobile, accessibility | Frontend/platform owner              | Diagram source review, device/browser matrix, offline boundary, and keyboard/a11y evidence. |

`Complete` in the tables means the source-verified documentation destination is written. It does not replace the runtime and reviewer evidence required by the final gate. Attach the applicable CI and acceptance evidence to #342 before merge.

## Product workflows

| Capability                                         | Audience                     | Evidence                                               | State    | Documentation destination                              | Depth                    | Phase |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------ | -------- | ------------------------------------------------------ | ------------------------ | ----- |
| Compose evaluation path                            | Evaluator                    | `docker-compose.yml`; getting-started flow             | Complete | `v1.4/getting-started/README.md`                       | Golden path              | 1     |
| First-week configuration                           | New admin                    | Application setup routes                               | Complete | `v1.4/getting-started/first-steps.md`                  | Guide                    | 1     |
| Dashboard command center                           | Responder                    | `src/app/(app)/page.tsx`; dashboard components         | Complete | `v1.4/core-concepts/dashboard.md`                      | Guide and limits         | 2     |
| Desktop navigation and global search               | Signed-in user               | `Sidebar`, `SidebarSearch`, `/api/search`               | Complete | `v1.4/core-concepts/navigation-search-notifications.md` | Task guide and limits    | 2     |
| Personal in-app notification inbox                 | Signed-in user               | `TopbarNotifications`; notification routes/stream      | Complete | `v1.4/core-concepts/navigation-search-notifications.md` | Task guide and limits    | 2, 3  |
| Incident create, triage, bulk actions, lifecycle   | Responder                    | incident routes, actions, components, `Incident` model | Complete | `v1.4/core-concepts/incidents.md`                      | Full guide               | 2     |
| Incident notes, tags, watchers, timeline           | Responder                    | incident detail components and models                  | Complete | `v1.4/core-concepts/incidents.md#add-response-context` | Section                  | 2     |
| Incident custom fields                             | Admin, responder             | settings custom-fields route; `IncidentCustomFields`   | Complete | `v1.4/core-concepts/incidents.md`; admin guide         | Section plus admin setup | 2, 5  |
| Incident templates                                 | Responder, admin             | templates route and actions                            | Complete | `v1.4/core-concepts/incident-templates.md`             | Guide                    | 2     |
| Service directory, ownership, health, SLA          | Admin, responder             | service routes/components; `Service` model             | Complete | `v1.4/core-concepts/services.md`                       | Full guide               | 2     |
| Teams, membership, roles, notification preference  | Admin, manager               | team routes/components; `TeamMember` model             | Complete | `v1.4/core-concepts/teams.md`                          | Full guide               | 2     |
| Users, invitations, roles, status, profile         | Admin, user                  | user/settings routes; `User` model                     | Complete | `v1.4/core-concepts/users.md`                          | Full guide               | 2, 5  |
| On-call schedules, layers, rotations, overrides    | On-call manager              | schedule routes/actions/models                         | Complete | `v1.4/core-concepts/schedules.md`                      | Full guide               | 2     |
| Escalation policies: user, team, schedule targets  | On-call manager              | policy routes/actions; `EscalationRule`                | Complete | `v1.4/core-concepts/escalation-policies.md`            | Full guide               | 2     |
| Urgency, priority, event severity mapping          | Integration owner, responder | inbound adapters; incident schema                      | Complete | `v1.4/core-concepts/urgency-mapping.md`                | Reference                | 2, 3  |
| Analytics filters, SLA metrics, CSV export         | Manager                      | analytics page/export route; SLA libraries             | Complete | `v1.4/core-concepts/analytics.md`                      | Guide and limits         | 2     |
| Custom reports and dashboards                      | Manager                      | reports routes and dashboard API/model                 | Complete | `v1.4/core-concepts/reports-dashboards.md`             | Guide and limits         | 2     |
| Postmortem authoring and publication               | Responder, manager           | postmortem routes/actions/model                        | Complete | `v1.4/core-concepts/postmortems.md`                    | Guide and limits         | 2     |
| Action-item board and Jira sync                    | Responder, manager           | action-items route/actions/models                      | Complete | `v1.4/core-concepts/action-items.md`                   | Guide                    | 2     |
| Event log and Events test console                  | Integration owner            | event routes and page                                  | Complete | `v1.4/core-concepts/event-logs.md`                     | Guide and limits         | 2     |
| Public status page configuration                   | Admin, communicator          | status-page settings/routes/models                     | Complete | `v1.4/core-concepts/status-page.md`                    | Full guide               | 2     |
| Status services, incidents, announcements, metrics | Communicator                 | status-page components and APIs                        | Complete | `v1.4/core-concepts/status-page.md`                    | Task sections            | 2     |
| Status subscribers and outbound webhooks           | Admin, communicator          | subscriber/webhook routes and libraries                | Complete | `v1.4/core-concepts/status-page.md`                    | Setup and operations     | 2     |

## Integrations and notifications

| Capability                                        | Audience           | Evidence                                                                         | State       | Documentation destination                                               | Depth                                  | Phase |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------- | -------------------------------------- | ----- |
| Events API integration key and generic payload    | Integration owner  | `/api/events`; service integration UI                                            | Complete    | `v1.4/api/events.md`; custom webhooks guide                             | Contract and guide                     | 3, 6  |
| AWS CloudWatch                                    | Integration owner  | integration registry and adapter                                                 | Complete    | `v1.4/integrations/cloud/aws-cloudwatch.md`                             | Runbook                                | 3     |
| Azure Monitor                                     | Integration owner  | integration registry and adapter                                                 | Complete    | `v1.4/integrations/cloud/azure-monitor.md`                              | Runbook                                | 3     |
| Google Cloud Monitoring                           | Integration owner  | integration registry and adapter                                                 | Complete    | `v1.4/integrations/cloud/google-cloud-monitoring.md`                    | Runbook                                | 3     |
| Datadog, Grafana, Prometheus                      | Integration owner  | registry and inbound adapters                                                    | Complete    | matching `integrations` guides                                          | Runbooks                               | 3     |
| New Relic, Dynatrace, AppDynamics                 | Integration owner  | registry and inbound adapters                                                    | Complete    | matching APM guides                                                     | Runbooks                               | 3     |
| Elastic, Honeycomb, Splunk Observability, Sentry  | Integration owner  | registry and inbound adapters                                                    | Complete    | matching APM/log guides                                                 | Runbooks                               | 3     |
| Nagios, Icinga, Zabbix                            | Integration owner  | registry and inbound adapters                                                    | Complete    | matching metrics guides                                                 | Runbooks                               | 3     |
| GitHub Actions, GitLab, Bitbucket, Vercel         | Delivery engineer  | registry and inbound adapters                                                    | Complete    | matching CI/CD guides                                                   | Runbooks                               | 3     |
| Native GitHub `deployment_status` ingest          | Delivery engineer  | v1.4 expects state inside `deployment`; GitHub sends `deployment_status.state`   | Unsupported | GitHub deployment payload boundary                                      | Explicit boundary                      | 3     |
| Native Bitbucket HMAC and success auto-resolution | Delivery engineer  | Bitbucket uses prefixed `X-Hub-Signature`; adapter ignores `commit_status.state` | Unsupported | Bitbucket security and recovery boundaries                              | Explicit boundary and alternatives     | 3     |
| UptimeRobot, Pingdom, Better Uptime, Uptime Kuma  | Integration owner  | registry and inbound adapters                                                    | Complete    | matching uptime guides                                                  | Runbooks                               | 3     |
| PagerDuty Events API v2 compatibility             | Migration owner    | registry and adapter                                                             | Complete    | `v1.4/integrations/custom/pagerduty-emulation.md`                       | Compatibility runbook                  | 3     |
| Splunk On-Call payload                            | Migration owner    | registry and adapter                                                             | Complete    | `v1.4/integrations/logs-events/splunk-oncall.md`                        | Runbook                                | 3     |
| Splunk Observability `CLEAR` auto-resolution      | Integration owner  | action normalizer does not recognize `CLEAR`/`Cleared`                           | Unsupported | Splunk Observability clear-event boundary                               | Explicit boundary and bridge option    | 3     |
| Direct standard GCP numeric incident timestamps   | Integration owner  | v1.4 schema accepts `started_at`/`ended_at` only as strings                      | Unsupported | Google Cloud Monitoring transformation boundary                         | Explicit boundary and bridge option    | 3     |
| Jira workspace and service mapping                | Admin, responder   | Jira settings, service mapping, actions                                          | Complete    | `v1.4/integrations/issue-tracking/jira.md`                              | Full guide                             | 3     |
| Slack incoming notifications                      | Admin              | Slack settings and provider                                                      | Complete    | `v1.4/integrations/communication/slack.md`                              | Full guide                             | 3     |
| Slack OAuth and ChatOps war rooms                 | Admin, responder   | OAuth routes, ChatOps libraries/components                                       | Complete    | Slack OAuth and ChatOps guides                                          | Full guides                            | 3     |
| Email notification provider                       | Admin              | notification provider settings and mail libraries                                | Complete    | `v1.4/administration/notifications.md#configure-email`                  | Setup/runbook                          | 3     |
| SMS notification providers (Twilio and AWS SNS)   | Admin              | provider settings and notification libraries                                     | Complete    | `v1.4/administration/notifications.md#configure-sms`                    | Setup/runbook                          | 3     |
| WhatsApp notification provider                    | Admin              | provider settings and notification libraries                                     | Complete    | `v1.4/administration/notifications.md#configure-whatsapp`               | Setup/runbook                          | 3     |
| Web push and device registration                  | Admin, mobile user | push settings, service worker, `UserDevice`                                      | Complete    | `v1.4/administration/notifications.md#configure-web-push`; mobile guide | Setup and troubleshooting              | 3, 7  |
| Generic inbound and outbound webhook systems      | Integration owner  | integration handler, service webhook settings/library, status webhook library    | Complete    | `v1.4/integrations/custom/webhooks.md`                                  | Contract and security                  | 3     |
| Notification history and retry visibility         | Admin              | settings/history and notification records                                        | Complete    | `v1.4/administration/notifications.md#notification-history`             | Operations and explicit no-retry limit | 3     |
| GitHub/Linear/Asana issue sync                    | API consumer       | no v1.4 implementation                                                           | Unsupported | Remove legacy claims; Jira limitation note                              | Limitation                             | 3     |

## Deployment, operations, administration, and security

| Capability                                   | Audience                    | Evidence                                          | State       | Documentation destination                        | Depth                | Phase |
| -------------------------------------------- | --------------------------- | ------------------------------------------------- | ----------- | ------------------------------------------------ | -------------------- | ----- |
| Docker Compose production configuration      | Platform engineer           | Compose/env files, entrypoint, and health routes  | Complete    | `v1.4/deployment/docker.md`; configuration guide | Runbook              | 4     |
| Helm deployment                              | Platform engineer           | Helm chart and values                             | Complete    | `v1.4/deployment/helm.md`                        | Runbook/reference    | 4     |
| Kustomize deployment                         | Platform engineer           | `k8s/kustomization.yaml` and manifests            | Complete    | `v1.4/deployment/kustomize.md`                   | Runbook/reference    | 4     |
| Database migration and startup behavior      | Platform engineer           | Prisma scripts and container entrypoint           | Complete    | `v1.4/deployment/database-migrations.md`         | Runbook              | 4     |
| Backup and restore                           | Operator                    | PostgreSQL deployment model                       | Complete    | `v1.4/deployment/backup-restore.md`              | Recovery runbook     | 4     |
| Upgrade and rollback                         | Operator                    | image/chart/manifests/migrations                  | Complete    | `v1.4/deployment/upgrade-rollback.md`            | Runbook              | 4     |
| Health checks and observability              | Operator                    | health route, logging and Sentry configuration    | Complete    | `v1.4/deployment/monitoring.md`                  | Operations           | 4     |
| Administrator operational health center      | Admin, operator             | database capacity, scheduler/jobs, paging, delivery, SLA performance, configuration, version | Complete | `v1.4/administration/health-center.md` | Status, limits, response | 4, 5 |
| Retention, cleanup, scheduled jobs           | Operator                    | scheduler, retention library, settings, DB models | Complete    | `v1.4/deployment/maintenance.md`                 | Operations           | 4     |
| Workspace settings and system configuration  | Admin                       | settings routes and configuration code            | Complete    | `v1.4/administration/system-settings.md`         | Reference/tasks      | 5     |
| Authentication, sessions, password reset     | Admin, security reviewer    | auth routes/libraries                             | Complete    | `v1.4/administration/authentication.md`          | Full guide           | 5     |
| First-time OIDC link approval and revocation | Admin, existing user        | user OIDC actions, menu control, auth callbacks   | Complete    | authentication and users guides                  | Security/task guide  | 5     |
| Native MFA, passkey login, SAML, magic links | Security reviewer, user     | no matching v1.4 authentication provider/flow     | Unsupported | authentication capability boundary               | Explicit boundary    | 5     |
| USER, RESPONDER, ADMIN authorization         | Admin, security reviewer    | `src/lib/rbac`; role enum                         | Complete    | `v1.4/security/authorization.md`; users guide    | Matrix and tasks     | 5     |
| Team OWNER, ADMIN, MEMBER roles              | Team admin                  | team actions and enum                             | Complete    | `v1.4/security/authorization.md`; teams guide    | Matrix and tasks     | 5     |
| API keys and scopes                          | Admin, API consumer         | API-key settings/routes/models                    | Complete    | API authentication guide                         | Contract             | 5, 6  |
| Audit log                                    | Admin, security reviewer    | audit page/model/writers                          | Complete    | `v1.4/administration/audit-logs.md`              | Operations/reference | 5     |
| System logs                                  | Admin, operator             | system-logs page and logger                       | Complete    | `v1.4/administration/system-logs.md`             | Troubleshooting      | 5     |
| Secrets, encryption, HTTPS, proxies          | Security reviewer, operator | configuration/security libraries                  | Complete    | security and deployment guides                   | Hardening            | 5     |

## Published automation contracts

| Capability                                       | Audience               | Evidence                                           | State       | Documentation destination   | Depth               | Phase |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------- | ----------- | --------------------------- | ------------------- | ----- |
| Events API trigger, acknowledge, resolve         | API consumer           | `/api/events`; schemas/tests                       | Complete    | `v1.4/api/events.md`        | Published contract  | 6     |
| Incidents API published operations               | API consumer           | published incident routes/tests                    | Complete    | `v1.4/api/incidents.md`     | Published contract  | 6     |
| PostgreSQL-backed API rate limiting              | API consumer, operator | rate-limit library/schema                          | Complete    | `v1.4/api/rate-limiting.md` | Contract/operations | 6     |
| CLI commands and configuration                   | Operator               | `scripts/OpsKnight.mjs`; package scripts           | Complete    | `v1.4/api/cli.md`           | Command reference   | 6     |
| Services, schedules, teams, users REST reference | API consumer           | internal routes are not a declared public contract | Unsupported | API index exclusion         | Explicit boundary   | 6     |
| Published language SDKs                          | Developer              | no versioned installable SDK packages              | Unsupported | API index exclusion         | Explicit boundary   | 6     |

## Architecture, mobile, and accessibility

| Capability                                           | Audience              | Evidence                                     | State       | Documentation destination                      | Depth                | Phase |
| ---------------------------------------------------- | --------------------- | -------------------------------------------- | ----------- | ---------------------------------------------- | -------------------- | ----- |
| Runtime and data-flow architecture                   | Operator, contributor | Next.js app, PostgreSQL, job/queue libraries | Complete    | `v1.4/core-concepts/technical-architecture.md` | Architecture         | 7     |
| Architecture diagrams                                | Operator, contributor | current deployment implementation            | Complete    | `v1.4/architecture/diagrams.md`                | Diagrams             | 7     |
| Capacity planning and horizontal scaling             | Platform engineer     | runtime topology, queue guards, route limits | Complete    | `v1.4/core-concepts/scalability.md`            | Test and operations  | 4, 7  |
| Responsive/mobile routes                             | Mobile user           | `src/app/(mobile)/m`; mobile components      | Complete    | `v1.4/mobile/README.md`                        | Task guide           | 7     |
| PWA installation and service worker                  | Mobile user, admin    | manifest and service-worker code             | Complete    | `v1.4/deployment/mobile-pwa.md`                | Setup/limits         | 7     |
| Selected offline action queue                        | Mobile responder      | service worker and offline queue             | Complete    | `v1.4/mobile/README.md`                        | Exact support matrix | 7     |
| Keyboard shortcuts                                   | Keyboard user         | shortcuts page and event handlers            | Complete    | `v1.4/accessibility/shortcuts.md`              | Reference            | 7     |
| Accessibility behavior                               | All users             | semantic UI and interaction tests            | Complete    | `v1.4/accessibility/README.md`                 | Support matrix       | 7     |
| Redis-backed architecture                            | Operator              | no Redis runtime dependency in v1.4          | Unsupported | Remove architecture claims                     | Limitation           | 7     |
| Postmortem API, approvals, custom templates, exports | API consumer, manager | no matching v1.4 implementation              | Unsupported | postmortem limitation section                  | Explicit boundary    | 2, 7  |
| Analytics API, PDF/JSON export, scheduled reports    | Manager, API consumer | no matching v1.4 implementation              | Unsupported | analytics limitation section                   | Explicit boundary    | 2, 7  |

## Final completeness gate

- [x] Every **Revise** row is source-verified and marked **Complete**.
- [x] Every **Add** row has a published destination and is marked **Complete**.
- [x] Every **Unsupported** claim is absent from feature instructions and appears only where a boundary prevents user confusion.
- [x] Every destination has valid frontmatter and is linked from an appropriate section index.
- [x] `node scripts/check-docs-links.cjs` passes.
- [x] Commands, payloads, permissions, defaults, limits, and failure modes have been verified.
- [x] The PR description records tests and evidence for every phase batch.
- [x] This PR leaves the website untouched; docs-sync remains the required publication path after merge.
