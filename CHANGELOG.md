# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

External-secrets support is an **implementation candidate, not certified support**. PR #931 remains draft. Live legacy Kubernetes startup, CSI synchronization/bootstrap and failure recovery, AWS/Azure workload identity, rotation (including decryption of stored data), and OpenShift arbitrary-UID/SCC/file-readability results are explicit merge and release blockers. Source/rendering tests and local filesystem probes do not clear these gates.

### Added

- **Pre-paging noise controls** (Settings → Intelligence → Noise controls): maintenance windows (service/team/label/all scope, RRULE subset, suppress or downgrade, end now), suppression rules (matchers on source/summary/severity/resource/labels, expiry, owner, suggestions from alert quality), orchestration rules (ordered conditions → drop/suppress/set severity/urgency/label/reroute/attach runbook/add note), content dedup, per-service flapping keyed on content, storm grouping under a parent with a bounded hold (never HIGH), and heartbeat monitors (`/api/heartbeats/<token>`; a missing ping raises an incident through normal ingestion and the next ping resolves it). Per-service policy, default OFF, SHADOW before ON with a readiness gate; every decision recorded and reversible ("reverse and page"); a replay over recent history; KPIs (compression, pages avoided, false-group rate); metrics `opsknight_prepaging_*` and `opsknight_heartbeat_*`. The ingestion hook is deadline-bounded (5 ms) and fails open. Correlation rules gained `allowHighUrgency` (suggest only) and `linkType: PARENT_CHILD`. See `docs/v2.2.0/operate/intelligence/noise-controls.md`.
- **Intelligence engine robustness**: handlers that exceed their budget are really cancelled (their running statement is cancelled and a stuck backend terminated) and keep their concurrency slot until they let go, so the lane never runs more database work than configured; work that dies twice within a day is **quarantined** (shown under Failed work, replayable, never auto-retried or purged) and a per-kind breaker pauses one failing kind for five minutes while the rest continues; lost wake notifications are repaired every cycle in O(changes) by an `updatedAt` watermark; very large incidents bootstrap their alerts in 5,000-payload passes; retention runs one short transaction per table, drains alert fingerprints before parents, and shrinks its batch while a table struggles; one replica is elected to act on wake notifications; discovery and the repair sweeps use the database clock; publishing a policy re-indexes the scope's open incidents in the background. New metrics `opsknight_intelligence_lane_up`, `..._work_quarantined`, `..._kind_paused`, `..._timed_out_in_flight`, `..._wake_leader`, `..._retention_rows_deleted_total`, alerts `OpsKnightIntelligenceLaneGone`, `OpsKnightIntelligenceWorkQuarantined`, `OpsKnightIntelligenceKindPaused`, and `npm run prisma:indexes:repair-invalid` (also run at container start) to rebuild indexes left invalid by interrupted concurrent builds. See `docs/v2.2.0/operate/intelligence/production.md`, "Robustness and self-protection".
- **AI assistants (MCP)**: a native MCP server at `<App URL>/mcp` with per-person OAuth sign-in (PKCE, automatic registration or client metadata documents), serving revision 2026-07-28 and 2025-06-18 / 2025-11-25 clients statelessly. Includes `whoami`, `read_operation`, `execute_plan`, curated incident, on-call, service, automation, runbook, report and status-page tools, six prompts, structured tool errors with `requestId`, human-approved configuration changes (`operation_prepare`, `operation_get_approval`, `operation_commit_approved`) and runbook runs (`runbook_prepare_execution`, `runbook_get_approval`, `runbook_execute_approved`). The server reports the running release as its version. See `docs/v2.2.0/guides/mcp/`.
- **MCP device sign-in** (OAuth 2.0 device authorization grant, RFC 8628) for CLIs, SSH sessions and headless servers: `POST /oauth/mcp/device_authorization`, the `/oauth/mcp/device` verification page (explicit code confirmation, the same consent with a "started this sign-in yourself" warning, lockout after five wrong codes) and the `urn:ietf:params:oauth:grant-type:device_code` token grant with `slow_down` pacing and single-use issuance. Off by default (**Device sign-in** in the access policy; turning it on needs a recent sign-in) and limited to clients registered for the grant. Adds the `mcp.device.*` audit events and the `pending`, `denied` and `expired` OAuth metric outcomes.
- MCP operability: the `mcp.request.completed` log line, `X-Request-Id` on every MCP and OAuth response, OAuth endpoint metrics, capacity gauges, the `opsknight.mcp` alert and recording rules with a monitoring page, and the `MCP_FORCE_DISABLED` emergency stop.
- MCP certification in CI: tools/list contract snapshots, a route-drift check, published-SDK handshakes at the 2025 revisions, JSON-RPC fuzzing, a nightly client-metadata drift check and a k6 MCP load scenario (`npm run load:mcp`).
- MCP round 3: `oncall_my_shifts` lists your own current and upcoming on-call shifts across every schedule, with time zones, handoffs and your next change (new REST route `GET /api/v2/users/me/on-call-shifts`, 14 days by default, at most 30 days and 50 shifts). Assistants can also read a people directory (`listUsers`, `getUser`: id, name, role, status and teams only), integration health (`getIntegrationDiagnostics`) and, for Administrators and Auditors with sensitive reads on, the audit log without actor emails or IP addresses. REST `GET /api/v2/users` now includes each user's teams.
- MCP round 4: two new read tools and five guided prompts for end users. `oncall_catch_up` answers "what did I miss" (counts of incidents opened and resolved in the last N hours, the active ones most urgent first, the ones assigned to you; new REST route `GET /api/v2/users/me/catch-up`, 12 hours by default, 168 at most). `incident_find_similar` answers "has this happened before" with past resolved incidents ranked by title-word overlap, same service and priority, each with why it matched, its resolution kind, duration and last-note excerpt (new REST route `GET /api/v2/incidents/{id}/similar`). Both are leads, not proof, and both read only what the caller's role and scopes allow. New prompts: `catch_up`, `find_precedent`, `draft_status_update`, `request_shift_cover` and `getting_started`; the two that end in a change (status update, shift cover) only draft and then use the existing approval flow.
- MCP round 5: depth and curation. `oncall_catch_up` now defaults to what is yours (assigned, watched or owned by one of your teams; `scope=all` for everything you may read), takes an exact `since` or `hours` (at most 168), narrows by `serviceId`, `teamId` and `urgency`, and reports which incidents actually paged you from your own notification history (`pagedMe`); it stays strictly read-only, with no stored "last seen" marker. `incident_find_similar` now folds plurals, tenses and a small reviewed synonym table (so "db timed out" finds "database timeout"), uses descriptions as well as titles, searches each title word separately so a busy service or a very common word cannot crowd out older matches, and shows the note written at resolution (flagging a later one). New `oncall_now` (`GET /api/v2/schedules/on-call-now`) says who is on call now and next across your teams' schedules, with the real shift edges and any schedule nobody covers; names only. Ten tools are now curated with when-to-use descriptions: `oncall_now`, `schedule_list`, `service_list`, `team_list`, `incident_list_notes`, `incident_available_actions`, `schedule_list_overrides`, `postmortem_get`, `postmortem_list` and `incident_watch` (reviewed R1, direct). Snooze, suppress, unacknowledge and watcher removal stay approval-gated as reviewed; the long tail stays discoverable through `search_capabilities` to keep every session's tool list small. The `tools/list` schema budget grows to 17 KB and the MCP tool metric label limit to 64 (series estimates updated).
- MCP round 6: fewer calls, operator visibility and stronger assurance. `search_capabilities` results now carry `requiredArgs`, so a long-tail read takes two calls instead of three; `oncall_for_service` takes a `serviceName` and asks which service is meant instead of guessing. New `service_get_changes` answers "what changed on this service" from configuration edits (audit), runbook runs and incidents, and says plainly that OpsKnight has no deploy telemetry; a source the connection cannot read is marked unavailable while the others answer. A new administrator-only **Usage** tab shows calls, failures and the slowest 5% by tool, assistant or person for 24 hours, 7 days or 30 days, with search and an audited CSV/JSON export; the request log now records the assistant and person (ids only, never arguments or results) and its retention is an admin setting (7 to 365 days, default 30). New policy options: **Require a different reviewer** (default off; nobody approves their own change or runbook run, applied to requests already waiting; turning it off needs a recent sign-in) and an optional per-person request cap shared across a person's connections. The audit log now records the first issue of a connection's credentials and a dormant connection resuming. Two new alerts (dropped request-log rows, listen streams near the cap) with promtool tests, a Grafana dashboard, optional OpenTelemetry spans with bounded attributes, an MCP threat model and control matrix, a service-account design proposal (no code), and an SDK-client credential-lifecycle test against the built server.
- MCP docs: a generated tool reference, coverage by area, "What to ask", "Build an agent" and "Security and data" guides, an Other clients tab (Codex CLI, Gemini CLI, Windsurf) and a Check connection button on the Connect tab, and a doctor that runs without a checkout.
- Optional Secrets Store CSI mounts for integrated/split application workloads and migration Jobs, preserving existing Kubernetes Secret mappings. Includes Helm and Kustomize support, AWS/Azure SecretProviderClass examples, OpenShift application security profiles, rotation guidance, and rendering regression tests. Cluster driver/provider installation remains external; live cloud/OpenShift certification is required before production rollout.
- **Single sign-on setup in four guided steps** (Connect provider, Who can sign in, Roles & teams, Test & activate) with per-provider checklists, plain-language help, one-click "save and test", draft recovery after a reload, and a warning before the two-hour fresh sign-in window closes. Emergency recovery is required only for SSO Required.
- **Specific sign-in messages** instead of "Access denied", each with a reference ID tied to the server log and login audit; people are told why a session ended.
- **Administrator test diagnostics**: a failed test names the cause, shows the claims received (never tokens) and links to the fix; provider errors such as `access_denied` are explained.
- **Role rules v2**: case-insensitive values, nested and namespaced claim paths, highest-role or first-match precedence, a default role, and an option to refuse people no rule matches. Rule values are suggested from real sign-ins and a sandbox checks unsaved rules.
- **Group-to-team rules** for single sign-on, which only ever remove memberships they created.
- **Linking at scale**: bulk approval (before or after turning SSO on), automatic connection for verified company emails (Entra needs `xms_edov`; never for administrators), and access requests that notify administrators.
- Activation preview of whose role and teams change, who still needs approval, and approvals carried over or cancelled.
- A repeatable end-to-end SSO journey test with a local mock OpenID Connect provider (`playwright.sso-journey.config.ts`).

### Changed

- MCP sessions: access tokens last five minutes and refresh with a 30-second reuse grace for a lost response; grants slide by the policy idle period and end after 90 days. Grants pin a revocation version that moves only on security events, so role and team changes apply live without signing anyone out. Approval review and commit windows are set in the access policy (240 and 30 minutes by default).
- Roles set by an administrator are never overwritten by single sign-on; use **Let role rules manage this role** to hand one back. Existing role rules keep their case-sensitive, first-match behaviour.
- Incomplete Entra group claims fail safe: they never raise a role, lower only SSO roles above the default role, and leave administrator-set and SCIM roles alone. A rule never demotes the last active administrator. Both alert administrators.
- Pending linking approvals survive activating a configuration for the same issuer and client.
- Changing only session limits, the button label, profile fields or team rules keeps the administrator test.
- SCIM opens a real connection by default, uses in-app confirmations, describes activity in sentences and flags offboarding that leaves on-call gaps. Profile fields managed by the directory are read-only.
- The sign-in page reflects SSO being turned on immediately; deployment address problems are shown to administrators as a specific fix.

### Deprecated

- MCP: reads through `call_operation` are deprecated; use `read_operation`. Removal is planned in v2.3.0, and the runtime warning names that release.

### Fixed

- The administrator who turned on SSO appeared as "not linked to the current provider".
- The SSO button's accessible name now matches its visible text.

### Removed

- The unused legacy SSO settings form and its always-failing direct-write action.

## [2.1.2] - 2026-10-27

OpsKnight 2.1.2 hardens the multi-tag OCI image promotion pipeline in the release workflow and completes patch alignment across deployment definitions.

### Fixed

- **Multi-tag OCI release promotion:** Batched and deduplicated `docker buildx imagetools create` tag promotion invocations to prevent BuildKit container daemon aborts when creating multiple release aliases (`latest`, `2`, `2.1`, `2.1.2`).
- **Release pipeline resilience:** Hardened release verification steps to inspect and confirm all promoted tags against the certified release digest.

### Changed

- **Deployment configurations:** Synchronized application and agent deployment manifests (Compose, Swarm, Kubernetes Kustomize, and Helm charts) to 2.1.2.

## [2.1.1] - 2026-10-27

OpsKnight 2.1.1 is a release packaging and reliability patch addressing release workflow buffer limits, API contract discovery synchronization, and Helm deployment clarifications.

### Fixed

- **Release packaging and SBOM verification:** Resolved `ENOBUFS` failure during multi-architecture release image validation by configuring buffered inspection for large multi-platform SPDX SBOMs and ensuring the root OCI index digest is promoted across release tags.
- **Public API route contract reconciliation:** Synchronized documentation runtime test expectations with the complete set of 48 discovered public API routes (including SCIM 2.0 and notification webhook endpoints).
- **Documentation and integration drift:** Normalized YAML and JSON generation across the 2.1.0 integration catalog, route contracts, and generated reference documents.

### Changed

- **Helm packaging & deployment metadata:** Updated OpsKnight and OpsKnight Agent Helm charts to 2.1.1, clarifying local repository installation practices and database migration prerequisites.

## [2.1.0] - 2026-10-26

OpsKnight 2.1 is an enterprise release introducing Service Automation with Runbook integration, unattended-write authorization, verified automatic recovery resolution, PostgreSQL 16 disaster recovery tooling, and enterprise SSO and SCIM 2.0 lifecycle management.

### Added

- **Service Automation ↔ Runbook integration:** LIVE automation decisions capture an immutable, checksum-verified response context of declared fields only. Runbook triggers accept `automation.<key>` conditions, bindings can map context fields to inputs and choose targets through an administrator-approved value → Agent/pool table, and alert-created incidents only reach bindings that opt in with **Run on monitoring incidents**. Unavailable context fails closed with a `RUNBOOK_SKIPPED` timeline event.
- **Unattended-write authorization:** AUTOMATIC write steps run without approval only after an administrator authorizes the exact pinned version and every write action has verification. `NON_IDEMPOTENT` steps always require approval. Changing the pinned version, strategy or mode revokes the authorization.
- **Verified recovery resolution:** Optional per-binding resolution when every write action of a successful run is verified, applied through the incident lifecycle (`AUTO_RESOLVED`, resolution kind `AUTOMATION`) with escalation cancelled. Outcomes are recorded as `NOT_REQUESTED`, `PENDING`, `RESOLVED`, `NOT_VERIFIED`, `ALREADY_CLOSED` or `BLOCKED`.
- **Unified response timeline:** Incident detail → Response activity shows routing, paging, remediation, verification and recovery in order, plus an Incident context card, with existing auditor and sensitive-source redaction. See `docs/automation/runbook-integration.md`.

### Changed

- Existing AUTOMATIC runbook bindings are not backfilled with unattended-write authorization: their write steps wait for responder approval until an administrator authorizes the pinned version. Agent selectors can no longer reference automation context; use the approved target table. Paging remains independent of remediation.

### Runbook engine remediation

- Restricted service Runbook data to authorized Runbooks views, replaced the full catalog payload with metadata and authorized selected-version fetches, and made deep readiness checks explicit.
- Automatic rules now save paused and activate separately with fresh policy evidence and explicit match-all trigger confirmation. Agent partitions fail readiness while preserving liveness; secret-dependent preflight checks report uncertainty. Watchdog reconciliation reuses the lock connection for minimum-pool deployments.

- Fixed pinned-version/input drift during rule creation, bounded service rule readiness with cursor pagination, and coordinated watchdog recovery with idempotent jobs.
- Historical version comparison supports older versions; invalid selectors return inline errors and disable saving. Worker health now discloses expected redundancy, and rule cards group secondary controls under Manage rule.

- Independent service automation rules with a guided paused-first setup, typed selectors, explicit automatic version pins, configuration validation, signed Agent policy checks, and single-use execution previews.
- Rule history and origin links, credential-masked version comparison, truthful configured/historical counts, and scoped inventory failure handling.
- Separate Agent startup/liveness/readiness probes, bounded reconnect, single-flight heartbeats, durable identity handling and node-affine Swarm state.
- Shared durable worker health and a scheduler reconciliation watchdog, with Prometheus worker/queue/uncertain-outcome/spool alerts.
- Verified release manifests and immutable image selection; setup no longer advertises missing artifacts or puts enrollment tokens in copied commands.
- Additive heartbeat/policy-check migrations and a rule-model migration preserving historical IDs. Independent duplicate rules prevent blindly recreating the old uniqueness constraint during rollback.
- Updated 2.1 operator guides and opt-in real HTTPS Compose/Kind deployment tests. Local candidate evidence is separate from published release, native-host and production capacity certification.

## [2.0.0] - 2026-10-02

OpsKnight 2.0 is a major release of the self-hosted incident-response platform. It introduces a scalable runtime architecture, a durable notification pipeline, expanded identity and ChatOps controls, production deployment options, and a fully rebuilt source-verified documentation set.

### New headline capabilities

- **Split production runtime:** Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector can scale independently. The integrated runtime remains supported.
- **Notification delivery control plane:** Durable logical intents, provider attempts, traffic classes, admission/defer behavior, retry and terminal states, callback reconciliation, provider capacity controls, and an administrator Operations view. Delivery evidence distinguishes deferred, retrying, accepted, delivered, permanent-failure, and superseded work.
- **Microsoft Teams ChatOps:** Entra application and Azure Bot integration, Teams app packaging and tenant installation, service-to-channel destinations, Adaptive Cards, interactive incident actions, identity linking, war rooms, participant synchronization, and meeting collaboration. A service can target up to three Teams destinations.
- **Twilio voice paging:** `VOICE` is a triggered-incident paging channel with responder acknowledgement input, signed callbacks, and reconciliation of uncertain provider outcomes. Acknowledge and resolve lifecycle updates do not initiate additional voice calls.
- **Incident response policy engine:** Versioned classification, incident SLA, and support-hours policies at workspace and service scope, with immutable published versions, preview, history, diff, restore, and API access.
- **SCIM 2.0 provisioning:** Users, Groups, discovery endpoints, provisioning/deprovisioning, team membership, PATCH operations, and in-product bearer-token generation, rotation, and revocation.
- **Auditor access and sessions:** A read-oriented `AUDITOR` role, centralized resource authorization, OIDC claim mapping, and a canonical signed-in-session registry with browser, OS, device, authentication type, activity, expiry, and revoke controls.
- **Privacy and compliance operations:** Privacy/DSAR request processing, export and erasure evidence, retention holds, controlled encryption migrations, technical control evaluation, framework mappings, evidence ledgers, drift monitoring, and verifiable evidence-package exports. Framework mapping does not confer external certification.
- **Docker Swarm:** Integrated and split stacks, Raft secrets, direct-database migration lifecycle, health checks, topology switching, and rollback tooling.
- **Deployment planning and load certification:** Workload shapes and multi-topology load/correctness tests cover ingestion, incident lifecycle, escalation, notification fanout, realtime delivery, status fanout, and recovery.
- **ManageEngine ingestion:** A new native inbound parser joins the existing integration catalog. The release certifies 28 current inbound contracts in total; it does not add 28 new integrations.

### Major rebuilds of existing capabilities

- **Incident response:** Centralized lifecycle commands, durable side effects, persistent idempotency, stale-worker fencing, a global create modal, templates, stronger validation, rebuilt incident detail, action items, and interactive 5-Whys postmortems.
- **Schedules and escalation:** Redesigned schedule setup/detail, DST-safe rotations, overrides and handoff behavior, user/team/schedule escalation targets, priority/urgency/support-hours conditions, durable recovery, and stale-work protection.
- **Slack and Jira:** More reliable Slack war rooms, identity and capability controls, up to three Slack destinations per service, provider-neutral collaboration, and stronger bidirectional Jira lifecycle reconciliation.
- **Quiet Hours:** Personal timezone-aware suppression for low-urgency notifications; medium- and high-urgency operational paging bypasses Quiet Hours.
- **Status Page V3:** One supported status page with themes, announcements, subscriber verification/unsubscribe, API tokens, webhooks, privacy controls, uptime history/export, rebuild-safe snapshots, and hardened routing. Multiple status pages are not a supported 2.0 capability.
- **Dashboards and reports:** Templates, configurable widgets, persisted layout, private/team/organization visibility, filtered share links, PDF export, live refresh, and fullscreen NOC/TV presentation mode.
- **Responder-grade mobile PWA:** Rebuilt mobile navigation and operational workflows, per-device push registration and reconciliation, repair flows, offline/cached-state boundaries, update handling, and hardened fresh-install iOS Web Push recovery. This is an installable PWA, not a native App Store application.
- **OIDC and SSO policy:** Entra, Google, Okta, Auth0, and generic provider flows with PKCE/nonce, JIT provisioning, explicit account linking, claim-to-role mapping, provider lifecycle hardening, maximum lifetime, update interval, idle timeout, and reauthentication controls.
- **Application bootstrap and routing:** Short-lived first-admin bootstrap capability, UI-managed Application URL, canonical-host enforcement, reverse-proxy awareness, and explicit HTTP 421 protection.
- **Health and operations:** Expanded Health Center diagnostics, Prometheus metrics, system logs, backup/restore, worker/readiness visibility, and PgBouncer-aware connection ownership.

### Explicit 2.0 boundaries

- Service Objectives/SLO UI is deferred; its route redirects and it is not advertised as a released feature.
- OpsKnight 2.0 supports one status page, not multiple status pages.
- Postmortem analysis is user-driven; the release does not claim AI correlation or AI-generated postmortems.
- OpsKnight remains self-hosted and does not introduce a hosted OpsKnight Cloud service.
- Mobile delivery is an installable PWA, not native iOS or Android store applications.
- Voice is triggered-incident paging, not a call on every later incident state change.
- The 28 inbound integration contracts are the current total contract set, not 28 newly added integrations.
- **Documentation:** The 2.0 task-oriented documentation is backed by implementation discovery, semantic contracts, runtime evidence, API smoke tests, legacy-knowledge mapping, and rendered-site validation.
- **License:** OpsKnight 2.0.0 is the first stable release distributed under `AGPL-3.0-only`. OpsKnight 1.4.0 and earlier retain their historical licenses.

### Upgrade from 1.4

This is a major-version migration. Before upgrading:

1. Back up PostgreSQL and prove that the backup restores.
2. Preserve `ENCRYPTION_KEY` and `NEXTAUTH_SECRET`; do not generate replacements.
3. Configure the externally reachable Application URL before testing redirects, webhooks, OIDC, ChatOps, or push.
4. Run schema migrations through a direct PostgreSQL connection, not PgBouncer.
5. Choose integrated or split topology and validate the database connection budget.
6. Re-test inbound integrations and every configured delivery provider.
7. Record the rollback boundary and complete rollback before accepting incompatible 2.0 writes.

Read [Migrate from v1](docs/v2.0.0/start/migrate-from-v1.md), [database migrations](docs/v2.0.0/operate/upgrades/database-migrations.md), and [rollback](docs/v2.0.0/operate/upgrades/rollback.md) before the maintenance window.

### Added & Enhanced

- **Webhook Ingestion Reliability & Auto-Recovery**:
  - **GitLab CI/CD**: Scoped pipeline deduplication keys to project + ref + buildName so succeeding runs properly auto-resolve failing runs.
  - **Zabbix Integration**: Fixed signature provider configuration from `gitlab` to `generic` HMAC; prioritized trigger ID, problem ID, and `r_event_id` over dynamic event IDs to ensure recovery webhooks deterministically match open incidents.
  - **Sentry, Prometheus & AWS CloudWatch Schemas**: Tolerated nullable fields (`assignedTo: null`, `AlarmDescription: null`), unhandled action verbs (`triggered`, `reopened`), and flexible timestamp encodings in Zod validation schemas.
  - **Datadog Deduplication**: Stripped standard status prefixes (`[Triggered]`, `[Recovered]`, `[OK]`, `[Warn]`) before fallback title hashing to ensure alert recovery matches.
  - **Integration Key Comparison**: Pre-hashed integration keys with SHA-256 before `crypto.timingSafeEqual` to eliminate secret length timing leaks.

### Security & Hardening

- **Authentication & Session Security**:
  - **Administrative Reset Links**: Automatically invoked `revokeUserSessions(userId)` upon generating administrative reset links to immediately terminate compromised sessions.
  - **IP Rate Limiting**: Extracted and sanitized leftmost client IP from `X-Forwarded-For` across password reset and admin reset link endpoints to prevent rate-limit evasion.
  - **OIDC Synchronization**: Bumped `tokenVersion` on user role updates during OIDC group mapping sync.
  - **Setup Hardening**: Wrapped post-creation `logAudit` in defensive error handling during admin bootstrap to eliminate permanent instance lockouts.
  - **RBAC**: Restricted team `OWNER` role assignments in `addUserToTeam` exclusively to administrators.
- **Web Push Subscription Isolation & API Caching**:
  - Automatically purged conflicting subscriptions on shared browser endpoints during push registration; enforced `NetworkOnly` Service Worker caching across all root and nested authenticated API endpoints to eliminate stale cache leakage.

### Fixed

- **SLA Analytics Math & Precision**:
  - **Zero-Item Datasets**: Returned `null` instead of `0` for MTTA and MTTR when zero incidents are acknowledged/resolved, preventing false "100% improvement" insight alerts.
  - **Timezone Alignment**: Aligned `trendSeries` calendar points and historical rollup query ranges with user timezone days so negative UTC offset timezones (`America/New_York`) do not drop edge days.
  - **Business Hours Robustness**: Added `try/catch` fallback to `DEFAULT_BUSINESS_HOURS_TIMEZONE` in `isIncidentAfterHours` to prevent unhandled `RangeError` on invalid timezone strings.
  - **Metric Merging**: Added `Number.isFinite` guards in `reconstructMet` and `calculateMtbfMs` to eliminate `NaN` propagation.
- **On-Call Scheduling DST Anchoring & Block Merging**:
  - Calendar-anchored sub-daily shift rotations (12h, 8h, 6h) in the schedule timezone to eliminate wall-clock drift across Daylight Saving Time transitions; merged contiguous schedule blocks for the same responder across rotation and override boundaries; filtered deactivated users in shift window aggregations and added null-safe fallbacks for deleted override users.
- **Web Push Delivery Resilience & PWA Hardening**:
  - Safely normalized action payloads to prevent `JSON.parse` crashes during dispatch; made device token purges and HTTP 410/404 cleanup idempotent (`deleteMany`) to prevent concurrent worker exceptions.
  - Handled `pointercancel` in `MobileSwipeNavigator` to abort tab transitions during native vertical scrolling; isolated modal and bottom sheet backdrops with `data-swipe-ignore`; enforced 16px minimum font size on mobile inputs to eliminate iOS Safari viewport auto-zoom displacement.

## [1.4.0] - 2026-08-23

### Added & Enhanced

- **Administrator Health Center**: Consolidated supported database, migration, scheduler, worker, escalation, notification-provider, integration, public URL, encryption, version, and upgrade signals in one administrative view; retired the standalone performance dashboard and removed misleading process-memory and operator-attestation backup signals.
- **Release-Quality Contract**: Added automated clean-install, previous-release upgrade, migration-failure, backup/restore, incident lifecycle, escalation delivery, Helm/Kustomize rendering, documentation coverage, and tagged AMD64/ARM64 release checks.
- **Deployment Reliability**: Added fail-closed migration startup with bounded recovery and multi-architecture stable container publishing; retained fast AMD64-only builds for the continuously updated test image.
- **Modern In-Process Avatar Ecosystem**: Migrated to local in-process `@dicebear/core` and `@dicebear/collection` rendering (eliminating external HTTP calls to `api.dicebear.com`); added professional vector styles (`bottts`, `shapes`, `initials`, `pixel-art`, `avataaars`, `lorelei`, `micah`, `identicon`) with gender-based selection, SVG XML entity sanitization, and strict CSP headers.
- **Admin-Controlled OIDC Account Linking**: Added explicit, reversible admin controls in user management to approve or revoke OIDC account linking, preventing account takeovers while allowing secure initial sign-in for invited team members.
- **Comprehensive Documentation & Operations Runbooks**: Published complete v1.3 capability inventory (`docs/V1_3_CAPABILITY_INVENTORY.md`), 15-minute golden path getting-started guide, production deployment runbooks for Docker, Kubernetes & Helm, database backup & disaster recovery procedures, and updated container registries to `ghcr.io/opsknight-labs/opsknight`.

### Security & Hardening

- **Bootstrap, OIDC & Readiness Hardening**: Serialized first-administrator creation with conflict retry, prevented disabled users from being reactivated through OIDC linking, and replaced internal scheduler errors in public readiness responses with a safe status message.
- **Dependency Security Baseline**: Updated Next.js, Auth.js, Nodemailer, and vulnerable transitive packages to patched releases identified by the release security scan.
- **Admin-Only Event Logs & Audit Log Access**: Enforced `assertAdmin()` on the Event Logs page (`/events`) and Audit Log page (`/audit`); restricted Event Logs and Audit Log sidebar navigation links strictly to users with the `ADMIN` role (`requiresRole: ['ADMIN']`); removed restricted administrative links (Audit Logs, Notification Providers, Performance Monitoring) from the settings overview, navigation, and search for standard users and responders.
- **Web Push Subscription Isolation & API Caching**: Automatically purge conflicting subscriptions on shared browser endpoints during push registration; enforced `NetworkOnly` Service Worker caching across all root and nested authenticated API endpoints to eliminate 24-hour stale cache leakage.
- **API Security, IDOR Mitigation & Role Validation**: Added `assertCanViewIncident(id)` on incident telemetry context; converted session role checks to database-verified `assertAdmin()` on SLA definitions, public logs, and retention endpoints; added positive integer boundary validation (`1–3650`) for data retention policies; enforced team-scoped access on Slack test notifications and widget feeds.
- **Structured Logging Redaction**: Enhanced logger sanitization before stdout/stderr and ingestion endpoints to redact authorization headers, bearer tokens, Slack bot tokens, AWS keys, phone numbers, and webhook secrets; added circular reference protection via `WeakSet`.
- **Database Concurrency & Transaction Atomicity**: Wrapped policy step creation and re-indexing in atomic `prisma.$transaction`; enforced last active administrator checks across multi-user bulk batches; deduplicated custom field insertions to eliminate unique constraint collisions (`P2002`).
- **Alert Ingestion & Webhook Reliability**: Added defensive object coercion across all 24 ingestion transformers; added escalation fallback to service team members and administrators when escalation policies resolve to zero active responders.
- **Incident State Transitions & Concurrency**: Cleared stale `resolvedAt` timestamps when transitioning out of `RESOLVED` to prevent MTTR/SLA metric distortion; applied atomic state guards (`status: 'OPEN'` / `status: 'SNOOZED'`) to Slack interactive action buttons and auto-unsnooze background workers to eliminate TOCTOU race conditions; added typed event logging on bulk actions.
- **Authentication & Sessions**: Added OIDC nonce state validation and strict email verification check on invited user linking; enforced `tokenVersion` check in JWT fallback path for immediate session revocation on role changes or password resets; wrapped bootstrap admin initialization in an atomic transaction; protected last active administrator from demotion/deletion; prevented responders from demoting team owners.
- **CSV Formula Injection Mitigation (CWE-1236)**: Implemented strict sanitization (`buildCsv` / `sanitizeCsvCell`) prepending quotes to formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`, `|`, `%`) across uptime reports and analytics exports.
- **Status Page & Subscriber Protection**: Replaced automatic GET-based unsubscribe mutation with an explicit confirmation form to block anti-spam scanner unsubscriptions; added SVG script/event-handler sanitization and strict CSP on logo endpoints; enforced private incident visibility filtering (`visibility !== 'PUBLIC'`) across status page notifications, webhooks, and RSS feeds.
- **Custom Fields Validation & RBAC**: Added strict type validation and regex parsing for custom field types (`NUMBER`, `BOOLEAN`, `DATE`, `SELECT`, `EMAIL`, `URL`) and enforced `assertCanModifyIncident` RBAC.
- **Template IDOR Mitigation**: Enforced author and admin role checks before deleting incident templates.

### Fixed

- **On-Call Scheduling DST Anchoring & Block Merging**: Calendar-anchored sub-daily shift rotations (12h, 8h, 6h) in the schedule timezone to eliminate wall-clock drift across Daylight Saving Time transitions; merged contiguous schedule blocks for the same responder across rotation and override boundaries; filtered deactivated users in shift window aggregations and added null-safe fallbacks for deleted override users.
- **Web Push Delivery Resilience**: Safely normalized action payloads to prevent `JSON.parse` crashes during dispatch; made device token purges and HTTP 410/404 cleanup idempotent (`deleteMany`) to prevent concurrent worker exceptions.
- **Mobile PWA & Touch Gesture Isolation**: Handled `pointercancel` in `MobileSwipeNavigator` to abort tab transitions during native vertical scrolling; isolated modal and bottom sheet backdrops with `data-swipe-ignore`; enforced 16px minimum font size on mobile inputs to eliminate iOS Safari viewport auto-zoom displacement.
- **Paging Reliability**: Restored orphaned escalation processing through a single atomic claim, preserved policy delays without immediately paging a fallback team, and eliminated duplicate service notifications on genuine escalation fallback.
- **Mobile PWA & Accessibility (a11y)**: Restored trigger element focus on modal/dialog cleanup via `trapFocus`; added `role="switch"`, `aria-checked`, and Enter/Space keyboard handlers to `MobileThemeToggle` and `MobileBiometricToggle`; added `role="alertdialog"`, theme background tokens, and focus trapping to confirmation dialogs; added `role="listbox"` and `aria-expanded` to analytics date range picker; added `aria-label` and `aria-pressed` to schedule layer restriction day buttons; cleaned up chord keydown event listeners on timeout.
- **Observability & Health Checks**: Cleared `setTimeout` timer handles in health check database probe; evaluated memory pressure against V8 maximum heap limit (`v8.getHeapStatistics().heap_size_limit`); added background scheduler state check; eliminated N+1 database queries in SLA breach monitor by pre-fetching active warning events.
- **ChatOps & Postmortem Lifecycle**: Atomically reserved Slack pin records in transaction before note creation to eliminate duplicate notes; guarded Jira sync against out-of-order stale webhooks using event timestamps; included incident notes and sorted chronological timeline events in postmortem drafts.
- **Notification Routing & Multi-Channel Delivery**: Eliminated mock-mode false positive successes in Email and Push dispatchers so fallback channels (SMS, WhatsApp) activate when primary providers are unconfigured; wrapped channel dispatchers in throwing callbacks inside `CircuitBreaker.execute` to ensure circuit breakers trip during third-party provider outages; validated `whatsappContentSid` before marking WhatsApp available; attributed recipient names in timeline events; evaluated `startHour === endHour` as 24-hour round-the-clock coverage.
- **Distributed Cron & Job Queue**: Ensured standby replicas schedule their next check with randomized jitter when failing to acquire leader locks, enabling High Availability leader failover; updated job queue maintenance to prune failed jobs based on `failedAt`.
- **Client SSE Reconnection**: Standardized exponential backoff with full jitter ($\pm 20\%$) across all client SSE streaming hooks (`useEventStream`, `useNotificationStream`, `useRealtime`) to eliminate thundering herd reconnection storms.
- **Analytics, SLA Metrics & PDF Export**: Accurately calculated MTBF for zero- and single-incident datasets across observation window bounds; aligned trend series generation with user timezone calendar boundaries; added negative interval guards to historical SQL aggregates; fixed multi-service uptime calculations for resolved incidents using `updatedAt`; rebuilt PDF export with accurate UTF-8 byte lengths, valid `xref` offsets, and pagination.
- **Mobile PWA, Web Push & Touch UX**: Resolved swipe conflicts between `MobileSwipeNavigator` and modal/sheet controls; fixed iOS Safari background rubber-band scrolling via `.mobile-content` container lock; added fallback WebAuthn biometric credential resolution; automatically disabled push notifications on 410/404 Gone device endpoints.
- **Postmortems & Timelines**: Preserved `publishedAt` timestamp on edits and cleared on `DRAFT`; deduplicated synthetic lifecycle markers when database events exist; fixed timezone offset drift on datetime-local inputs; auto-completed Action Items on Jira ticket resolution.
- **Audit Logs & Export**: Added structured audit logging for API key creation/revocation, notification provider updates, VAPID rotation, retention policies, and manual data purges; added safety query limit (`take: 100`) to team audit logs.

## [1.3.1] - 2026-08-18

### Added

- **6 New Native Observability & APM Integrations**:
  - **Zabbix** — native webhook media type support for Problem/Recovery/Update alerts with 6-level severity mapping and `EVENT.ID` recovery deduplication
  - **PagerDuty Events API v2** — ingest adapter for `trigger`, `acknowledge`, and `resolve` with routing key resolution. Not a PagerDuty product.
  - **GitLab CI/CD** — automated pipeline failure alerting and branch-level auto-resolution on successful rerun
  - **Vercel Deployments** — production error triggering, deployment state tracking, and auto-resolution on successful deployment
  - **Nagios Core & XI** — macro parsing with scheduled downtime (`DOWNTIMESTART`), flapping, and service state transitions
  - **Icinga 2** — full host/service state transitions and acknowledgment handling
- **Forensic Ingestion Security & Authentication**:
  - Mandatory integration key verification and timing-safe HMAC checks (`crypto.timingSafeEqual`) across all 24 webhook routes
  - Collision-proof 32-character SHA-256 deduplication hashing replacing legacy 100-character string slicing
  - Outbound webhook timestamp binding (`X-OpsKnight-Timestamp` in HMAC) to eliminate replay attack vectors
- **Core Resilience & Runtime Hardening**:
  - Webhook circuit breaker with `halfOpenRequestInFlight` concurrency locking to eliminate thundering herd spikes during service recovery
  - Rolling 5-minute deduplication window for notification queue processing
  - Sequential notification fallback chain (`push -> sms -> whatsapp -> email`) with High/Critical multi-channel escalation
  - Next.js navigation error propagation (`isRedirectError`, `isNotFoundError`) in server action wrappers
  - Fallback RBAC permission safely assigns unauthenticated sessions to `VIEWER` with `authenticated: false`
- **Official Organization Migration**:
  - Migrated repository and container packages to `ghcr.io/opsknight-labs/opsknight` with public anonymous pull support

## [1.2.0] - 2026-08-16

### Added

- **Slack ChatOps incident war rooms** — a dedicated Slack channel per qualifying
  incident, with on-call responders auto-invited, an incident command card, and
  an optional Jitsi/Zoom/Google Meet bridge
- **One-click actions** in Slack: Acknowledge, Assign to Me and Resolve
- **Slash commands** — `/incident ack | resolve | note | who | postmortem | help`
- **📌 emoji pin sync** — react to any message in a war room to capture it as an
  incident note; pinning is idempotent
- **Slack app manifest generator** — copy a complete manifest configuring every
  scope, the events subscription, interactivity and the slash command in one step
- Signing secret is entered in the UI and stored encrypted, no environment
  variable required
- Setup documentation for Slack ChatOps, including scope reference and
  troubleshooting

### Fixed

- **On-call resolution paged the entire schedule on Node 20.** `hour12: false`
  resolves to the h24 hour cycle on Node 20's ICU, reporting midnight as hour
  "24" and shifting start-of-day a full day early in zero-offset zones. No block
  covered "now", so the roster fallback paged everyone instead of the person on
  call
- Slack request signatures are now verified and **fail closed**; previously a
  missing secret caused every unsigned request to be trusted
- Server-side request forgery via `response_url`, which was fetched unvalidated
- "Assign to Me" could assign an incident to an arbitrary user when Slack user
  resolution failed
- The Acknowledge button did not stop the escalation chain
- Slack button actions did not send notifications the equivalent web actions did
- Incident timeline showed raw Slack IDs (`<@U0673U4TWAJ>`) instead of names
- War-room API required only authentication, not permission on the incident
- Manual **Create War-Room** and **Archive** were blocked by settings that govern
  automatic behaviour
- Slack rate limits (429) crashed some code paths and were swallowed on others
- Archived war rooms no longer read as active, and no longer receive updates
- Emoji reaction sync requested the scopes it needs (`reactions:read`,
  `channels:history`, `groups:history`)

### Changed

- Watchtower removed from the production compose file; image rollout is now a
  deliberate action
- `engines` pins Node 20 to match the production image
- Pinned messages are saved as an incident note only, without a duplicate
  timeline event

### Added

- Initial GitHub Issue Templates (Bug Report, Feature Request, Config)
- Community Health files (CODE_OF_CONDUCT, CONTRIBUTING, etc.)

### Changed

- Updated repository description to match brand guidelines.
- Updated README to reflect Beta status.

---
