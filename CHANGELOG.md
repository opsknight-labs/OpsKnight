# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security & Hardening

- **Authentication & Sessions**: Added OIDC nonce state validation and strict email verification check on invited user linking to prevent account takeovers; enforced `tokenVersion` check in JWT fallback path for immediate session revocation; wrapped bootstrap admin initialization in an atomic transaction; protected last admin from demotion/deletion.
- **CSV Injection Mitigation**: Implemented strict sanitization (`buildCsv` / `sanitizeCsvCell`) across uptime exports and analytics reports against CSV formula injection (CWE-1236).
- **Status Page Protection**: Replaced automatic GET-based unsubscribe mutation with an explicit confirmation form; added SVG script sanitization and strict CSP headers on logo routes; prevented private incident leaks across status page feeds and subscriber broadcasts.
- **Custom Fields Validation**: Added strict type validation and regex parsing for all custom field types (`NUMBER`, `BOOLEAN`, `DATE`, `SELECT`, `EMAIL`, `URL`) and enforced `assertCanModifyIncident` RBAC.
- **Template IDOR**: Enforced author and admin role checks before deleting incident templates.

### Fixed

- **Mobile PWA & UI Controls**: Resolved swipe conflicts between `MobileSwipeNavigator` and modal/sheet controls; fixed iOS Safari background rubber-band scrolling; added fallback WebAuthn biometric credential resolution; disabled push flags on 410/404 Gone endpoints.
- **Postmortems & Timelines**: Preserved `publishedAt` on updates; deduplicated synthetic incident lifecycle markers; fixed timezone offset drift on datetime-local inputs; auto-completed Action Items on Jira ticket resolution.
- **Real-Time Streaming**: Scoped notification streams by user ID; prevented memory leaks in `WidgetProvider` by hoisting callbacks.
- **Audit Logs & Export**: Added audit logging for API keys, notification providers, VAPID rotation, and data retention policies; added safety query limit to team audit logs.

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
