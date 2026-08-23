# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added & Enhanced

- **Modern In-Process Avatar Ecosystem**: Migrated to local in-process `@dicebear/core` and `@dicebear/collection` rendering (eliminating external HTTP calls to `api.dicebear.com`); added professional vector styles (`bottts`, `shapes`, `initials`, `pixel-art`, `avataaars`, `lorelei`, `micah`, `identicon`) with gender-based selection, SVG XML entity sanitization, and strict CSP headers.
- **Admin-Controlled OIDC Account Linking**: Added explicit, reversible admin controls in user management to approve or revoke OIDC account linking, preventing account takeovers while allowing secure initial sign-in for invited team members.
- **Comprehensive Documentation & Operations Runbooks**: Published complete v1.3 capability inventory (`docs/V1_3_CAPABILITY_INVENTORY.md`), 15-minute golden path getting-started guide, production deployment runbooks for Docker, Kubernetes & Helm, database backup & disaster recovery procedures, and updated container registries to `ghcr.io/opsknight-labs/opsknight`.

### Security & Hardening

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

- **Mobile PWA & Accessibility (a11y)**: Restored trigger element focus on modal/dialog cleanup via `trapFocus`; added `role="switch"`, `aria-checked`, and Enter/Space keyboard handlers to `MobileThemeToggle` and `MobileBiometricToggle`; added `role="alertdialog"`, theme background tokens, and focus trapping to confirmation dialogs; added `role="listbox"` and `aria-expanded` to analytics date range picker; added `aria-label` and `aria-pressed` to schedule layer restriction day buttons; cleaned up chord keydown event listeners on timeout.
- **Observability & Health Checks**: Cleared `setTimeout` timer handles in health check database probe; evaluated memory pressure against V8 maximum heap limit (`v8.getHeapStatistics().heap_size_limit`); added background scheduler state check; eliminated N+1 database queries in SLA breach monitor by pre-fetching active warning events.
- **ChatOps & Postmortem Lifecycle**: Atomically reserved Slack pin records in transaction before note creation to eliminate duplicate notes; guarded Jira sync against out-of-order stale webhooks using event timestamps; included incident notes and sorted chronological timeline events in postmortem drafts.
- **Notification Routing & Multi-Channel Delivery**: Eliminated mock-mode false positive successes in Email and Push dispatchers so fallback channels (SMS, WhatsApp) activate when primary providers are unconfigured; wrapped channel dispatchers in throwing callbacks inside `CircuitBreaker.execute` to ensure circuit breakers trip during third-party provider outages; validated `whatsappContentSid` before marking WhatsApp available; attributed recipient names in timeline events; evaluated `startHour === endHour` as 24-hour round-the-clock coverage.
- **Distributed Cron & Job Queue**: Ensured standby replicas schedule their next check with randomized jitter when failing to acquire leader locks, enabling High Availability leader failover; updated job queue maintenance to prune failed jobs based on `failedAt`.
- **Client SSE Reconnection**: Standardized exponential backoff with full jitter ($\pm 20\%$) across all client SSE streaming hooks (`useEventStream`, `useNotificationStream`, `useRealtime`) to eliminate thundering herd reconnection storms.
- **Analytics, SLA Metrics & PDF Export**: Accurately calculated MTBF for zero- and single-incident datasets across observation window bounds; aligned trend series generation with user timezone calendar boundaries; added negative interval guards to historical SQL aggregates; fixed multi-service uptime calculations for resolved incidents using `updatedAt`; rebuilt PDF export with accurate UTF-8 byte lengths, valid `xref` offsets, and pagination.
- **On-Call Scheduling & Rotations**: Synchronized active user filtering between on-call roster UI and escalation alerting engine; fixed calendar date range calculation using schedule timezones; re-indexed layer user positions upon user removal.
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
