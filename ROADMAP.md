# OpsKnight roadmap

> **Current stable release:** OpsKnight 2.0.0

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

## OpsKnight 2.1 — planned milestone

No delivery date is committed. Items will be scoped and scheduled before they become a release gate.

- [ ] Richer enterprise REST API v2 — complete automation, runbook-rule, approval and lifecycle operations with revision-safe authoring, generated OpenAPI spec, and updated TypeScript and Python SDKs
- [ ] Runbook improvements — draft authoring and publication workflows, version comparison, archive/restore, duplication, dependency-safe deletion, and service-bound rule administration
- [ ] Streamlined OIDC setup — guided provider configuration, claim-to-role mapping preview, and diagnostic test-login flow
- [ ] Emergency access — break-glass admin recovery path, bootstrap-code regeneration, and session-override controls for lockout scenarios
- [ ] In-product webhook payload simulation and delivery verification
- [ ] Additional status-page isolation and custom-domain options

## OpsKnight 2.2 — planned milestone

- [ ] Official MCP (Model Context Protocol) server — expose OpsKnight operations as MCP tools, resources, and prompts so AI assistants (Claude, Cursor, VS Code Copilot, and other MCP-compatible clients) can query incidents, manage on-call, preview and execute runbooks, draft postmortems, and update status pages through natural conversation
- [ ] Alert correlation and assisted incident learning
- [ ] Configurable workflow triggers and response automation

## Further out

These items are under consideration and not yet scoped.

- [ ] Real-time event streaming (WebSocket / SSE) for external consumers
- [ ] Multi-tenant workspace isolation
- [ ] Plugin and extension framework

Have a suggestion? [Open a feature request](https://github.com/opsknight-labs/OpsKnight/issues/new?template=feature_request.yml).
