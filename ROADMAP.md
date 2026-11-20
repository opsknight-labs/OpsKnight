# OpsKnight roadmap

> **Current stable release:** OpsKnight 2.2.0

This roadmap communicates direction, not a delivery date or support commitment. Released behavior is defined by the [versioned documentation](https://opsknight.com/docs/latest/) and published release notes.

## OpsKnight 2.0 — completed milestone

- [x] End-to-end incident lifecycle, ownership, timelines, templates, action items, and postmortems
- [x] On-call schedules, overrides, escalation policies, and service SLA policies
- [x] Durable email, push, SMS, WhatsApp, and Twilio voice delivery
- [x] Slack and Microsoft Teams ChatOps, Jira synchronization, and status pages
- [x] OIDC, SCIM, RBAC, API keys, session management, audit, privacy, and compliance controls
- [x] Analytics, reports, mobile PWA, backup/restore, metrics, and Health Center operations
- [x] Integrated and split runtime deployment through Compose, Swarm, Helm, and Kustomize
- [x] Source-verified 2.0 documentation, runtime journeys, public API checks, and release certification

## OpsKnight 2.1 — completed milestone

- [x] Richer enterprise REST API v2 — complete automation, runbook-rule, approval and lifecycle operations with revision-safe authoring, generated OpenAPI spec, and updated TypeScript and Python SDKs
- [x] Interactive runbooks and automated remediation — visual step builder, draft authoring and publication, version comparison, execution previews, and service-bound trigger rules
- [x] Streamlined OIDC setup — guided provider configuration, claim-to-role mapping preview, and diagnostic test-login flow
- [x] Emergency access — break-glass admin recovery path, bootstrap-code regeneration, and session-override controls for lockout scenarios

## OpsKnight 2.2 — completed milestone

- [x] Official MCP (Model Context Protocol) server — expose OpsKnight operations as MCP tools, resources, and prompts so AI assistants (Claude, Cursor, VS Code Copilot, and other MCP-compatible clients) can query incidents, manage on-call, preview and execute runbooks, draft postmortems, and update status pages through natural conversation
- [x] Response automation — per-service automation rules that route, page or start runbooks for matching alerts

## OpsKnight 2.3 — planned milestone

No delivery date is committed.

- [ ] Alert correlation and assisted incident learning (AIOps)
- [ ] Organisation-wide workflow builder — configurable triggers (incident declared, severity changed, SLA breached, postmortem published) running chains of steps across Slack, Jira, paging and status pages

Have a suggestion? [Open a feature request](https://github.com/opsknight-labs/OpsKnight/issues/new?template=feature_request.yml).
