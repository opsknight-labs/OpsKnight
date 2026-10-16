# OpsKnight REST API v2 — Complete Enterprise Feature Coverage Plan

Objective: Close the remaining REST API gaps so customers can automate every supported OpsKnight workflow programmatically, with the same security, behavior, reliability, and operational safeguards as the web UI.

This plan is based on the implementation in [OpsKnight PR #883](https://github.com/opsknight-labs/OpsKnight/pull/883?utm_source=chatgpt.com), including its capability catalog and implementation tracker, plus the separate `feat/service-automation` branch.

## 1. Target architecture

The most important decision is that OpsKnight must have one business-logic layer shared by the UI, REST API, and future CLI/MCP integrations.

### Non-negotiable engineering principles

1. Reuse existing domain logic. Do not copy server-action implementations into REST handlers. Extract reusable commands where needed and make both callers use them.
2. Authorization must be enforced at every boundary. API scope + actor role + resource ownership/access + workflow-specific restrictions.
3. Every mutation needs a deliberate contract. Validation, concurrency, idempotency, audit, rollback behavior, HTTP responses, and operational side effects must be defined.
4. No silent partial success. If notification fanout, provider setup, provisioning, or publication is asynchronous, return the actual persisted state and expose the eventual outcome.
5. No Redis requirement. Retain the PostgreSQL-backed architecture and certify database load, connection pressure, worker concurrency, and multiple replicas.
6. No feature-specific operational settings hidden in `.env`. User-configurable automation, notification, provider, and workflow policies should live in the authenticated administrative UI and be exposed through carefully permissioned API operations. Keep infrastructure bootstrap secrets in deployment configuration.
7. Preserve product boundaries. The status-page limit remains one page; SCIM stays a dedicated protocol; the runbook-agent execution protocol is not turned into a public REST interface.
8. Feature parity means equivalent outcomes, not identical endpoints. UI and API should produce the same business state, audit history, notifications, and safety decisions.

### Common REST v2 contract

Each proposed endpoint below is a target design, not a claim that the endpoint exists today.

| Concern           | Contract                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| Authentication    | Personal API keys or service-account tokens, with explicit scopes                      |
| Authorization     | Role, scope, resource and sensitive-operation checks                                   |
| Pagination        | Bounded cursor pagination with stable ordering                                         |
| Validation        | Strict schemas; reject unsupported fields rather than ignoring them                    |
| Concurrency       | Strong `ETag` and `If-Match` for shared configuration changes                          |
| Replay safety     | Required `Idempotency-Key` for side-effecting operations                               |
| Asynchronous work | `202 Accepted`, persisted job ID, status and outcome                                   |
| Errors            | Structured problem responses with appropriate 400/403/404/409/412/422/428/429 statuses |
| Observability     | Stable operation IDs, request correlation, latency, audit and queue metrics            |
| Compatibility     | Additive v2 changes where possible; explicit migrations for breaking behavior          |

Sensitive responses must use `Cache-Control: no-store`, and one-time credentials must never be persisted in a replay cache merely to make an issuance endpoint idempotent.

## 2. Service Automation API — Complete the routing engine

Priority P0 · Integrate service-automation branch first

### Existing implementation

The separate [`feat/service-automation`](https://github.com/opsknight-labs/OpsKnight/tree/feat/service-automation?utm_source=chatgpt.com) branch already contains an automation contract, evaluator, draft/version management, simulation, discovery, audit, and administrative settings.

Relevant modules include:

- `src/lib/automation/versioning.ts`
- `src/lib/automation/testing.ts`
- `src/lib/automation/evaluator/`
- `src/lib/automation/settings.ts`
- `src/lib/automation/discovery.ts`
- `src/app/(app)/services/[id]/automation/actions.ts`

This means we should expose the existing automation engine rather than build a second routing engine for API consumers.

### A. API endpoints to implement

All paths below are relative to `/api/v2`.

| Method    | Endpoint                                         | Function                                                      |
| --------- | ------------------------------------------------ | ------------------------------------------------------------- |
| GET       | `/services/{id}/automation`                      | Read effective configuration, active version, mode and health |
| GET       | `/services/{id}/automation/draft`                | Retrieve editable draft                                       |
| PUT       | `/services/{id}/automation/draft`                | Save the complete draft with revision protection              |
| POST      | `/services/{id}/automation/validate`             | Validate references, conditions, mappings and dependencies    |
| POST      | `/services/{id}/automation/simulate`             | Run a sample alert through the actual evaluator               |
| POST      | `/services/{id}/automation/publish`              | Atomically publish a validated version                        |
| PATCH     | `/services/{id}/automation/mode`                 | Switch between DISABLED, SHADOW and ACTIVE                    |
| GET       | `/services/{id}/automation/versions`             | List immutable versions and audit history                     |
| GET       | `/services/{id}/automation/versions/{versionId}` | Inspect a particular version                                  |
| POST      | `/services/{id}/automation/restore`              | Create a new draft from an older version                      |
| GET       | `/services/{id}/automation/decisions`            | Paginated routing decisions and explanations                  |
| GET       | `/services/{id}/automation/observations`         | Safe field-discovery and unmapped-value observations          |
| GET/PATCH | `/settings/automation`                           | Read/update global administrative automation settings         |

The API must preserve the domain model: a single versioned service automation configuration containing field definitions, ENRICH rules, and ROUTE rules. It must not replace that model with a separate generic rules table.

### B. Exact execution semantics

| Stage     | Required behavior                                  |
| --------- | -------------------------------------------------- |
| Normalize | Apply canonical provider/event normalization       |
| Extract   | Resolve configured fields, types and aliases       |
| Enrich    | Evaluate all matching enrichment rules             |
| Route     | Apply the first matching routing rule              |
| Incident  | Persist the decided context and escalation outcome |
| Explain   | Record a safe trace explaining the decision        |

The API must support the three existing field states: `MISSING`, `UNMAPPED`, and `RECOGNIZED`. `UNKNOWN` condition outcomes must remain non-matching rather than being silently treated as false or true in a way that changes evaluation rules.

Simulation must use the production evaluator. No simplified API-only version.

For a simulation request:

```
{
  "draft": true,
  "source": "DATADOG",
  "sample": {
    "environment": "production",
    "account": "customer-a",
    "severity": "critical"
  }
}
```

The response should contain the recognized context, matched enrichment rules, selected route, escalation policy, proposed priority, warnings, and a redacted explanation trace.

It must not create an incident, send notifications, modify service routing, or call providers.

### C. Versioning, publishing and lifecycle

Implement a strict workflow:

Edit draft

Validate + simulate + dependency check

Publish immutable version

Activate or shadow-test

Requirements:

- Publishing must be revision-fenced with a concrete `If-Match`.
- Validate every referenced escalation policy, provider destination, and required field.
- Prevent deleting escalation policies referenced by immutable or active automation versions without following the existing dependency policy.
- Preserve deterministic rule ordering and distinguish default routing from `NO_ESCALATION`.
- Use transactional incident decision persistence with the existing event/outbox pipeline.
- A global kill switch must be manageable in the admin UI and API, with a clear effect on new evaluations.
- API operations must not bypass the current per-service mode or deployment-wide guard.
- Historical versions must remain auditable and readable after later edits.
- Rollback should create an auditable new active revision rather than mutate history.

### D. Security and performance

Propose dedicated scopes such as `automation:read`, `automation:write`, `automation:simulate`, and `automation:publish`, mapped to existing service-management capabilities. Publishing and global configuration should remain more privileged than reading or simulation.

Never include raw customer secrets or unrestricted provider payloads in stored observations or traces. Enforce the engine's existing field, rule, depth, and byte limits.

Acceptance tests: Golden-fixture parity, missing/unmapped types, rule ordering, shadow-mode purity, concurrent publishing, policy deletion races, global kill switch, multi-replica cache invalidation, and production ingestion performance with automation enabled.

Completion criterion: Any service automation workflow supported by the UI can be safely performed and diagnosed through REST v2.

## 3. Runbooks API — Full authoring, execution and agent administration

Priority P0 · Highest security sensitivity

### Existing implementation

PR #883 already provides runbook creation, drafts, publishing, execution preview/start, cancellation, and execution reads.

The remaining capabilities are present elsewhere in the product:

- `src/lib/runbooks/bindings.ts` — service rules and binding lifecycle
- `src/lib/runbooks/policy-checks.ts` — target-policy checks
- `src/lib/runbooks/orchestrator.ts` — execution and approval commands
- `src/lib/runbooks/secrets.ts` — secrets and grants
- `src/app/(app)/runbooks/actions.ts` — enrollment, pools, settings, lifecycle
- `src/app/(app)/runbooks/executions/actions.ts` — approval, rerun and cancellation

### A. Complete runbook metadata and lifecycle

| Method | Endpoint                                   | Function                                      |
| ------ | ------------------------------------------ | --------------------------------------------- |
| PATCH  | `/runbooks/{id}`                           | Rename, describe or change permitted metadata |
| POST   | `/runbooks/{id}/archive`                   | Archive with dependency checks                |
| POST   | `/runbooks/{id}/restore`                   | Restore safely                                |
| GET    | `/runbooks/{id}/delete-check`              | Show references preventing deletion           |
| DELETE | `/runbooks/{id}`                           | Delete only after lifecycle checks            |
| POST   | `/runbooks/{id}/duplicate`                 | Create a separate runbook                     |
| GET    | `/runbooks/{id}/versions/{versionId}/diff` | Inspect redacted differences                  |

The API must preserve the current rules for immutable published versions, pinned service rules, active executions, outstanding suggestions, and referenced secrets.

### B. Service runbook rules

This is different from alert-routing service automation. Do not merge the two concepts into one ambiguous REST resource.

| Method    | Endpoint                                              | Function                           |
| --------- | ----------------------------------------------------- | ---------------------------------- |
| GET/POST  | `/services/{id}/runbook-rules`                        | List/create service bindings       |
| GET/PATCH | `/services/{id}/runbook-rules/{ruleId}`               | Inspect/update rule configuration  |
| POST      | `/services/{id}/runbook-rules/{ruleId}/validate`      | Readiness and reference checks     |
| POST      | `/services/{id}/runbook-rules/{ruleId}/policy-checks` | Request agent policy checks        |
| GET       | `/services/{id}/runbook-rules/{ruleId}/policy-checks` | Read results and blockers          |
| POST      | `/services/{id}/runbook-rules/{ruleId}/activate`      | Activate reviewed configuration    |
| POST      | `/services/{id}/runbook-rules/{ruleId}/pause`         | Stop new rule-triggered executions |
| POST      | `/services/{id}/runbook-rules/{ruleId}/duplicate`     | Duplicate safely                   |
| DELETE    | `/services/{id}/runbook-rules/{ruleId}`               | Detach with dependency safeguards  |
| PUT       | `/services/{id}/runbook-rules/{ruleId}/triggers`      | Replace trigger configuration      |

Required guarantees:

- Validate runbook version, service, input values, agent/pool targets, labels and execution capabilities.
- Preserve PINNED versus LATEST_PUBLISHED behavior.
- Enforce configuration revision checks for every edit and activation.
- Activation requires a current, valid readiness result and applicable policy evidence.
- A disabled or detached rule cannot become executable through REST.
- Manual execution through a bound service rule must use saved, reviewed inputs.
- Deletion, archival, or target revocation must not create a check-then-act race.

### C. Execution approvals and interventions

Proposed endpoints:

`GET /runbooks/executions/{id}/steps`

`POST /runbooks/executions/{id}/steps/{stepId}/approve`

`POST /runbooks/executions/{id}/steps/{stepId}/reject`

`POST /runbooks/executions/{id}/reruns/preview`

`POST /runbooks/executions/{id}/rerun`

`GET /runbooks/executions/{id}/evidence`

`GET /runbooks/executions/{id}/events`

For approvals, enforce the same decision policy as the UI, including any restrictions on who may approve, step state, timeout, digest, and actor authority. Introduce separation of duties for high-risk operations only as an explicit product policy, not as a silent behavior change.

A stale approval must be rejected. Approval must never authorize a different plan from the one the operator reviewed.

Reruns must not blindly replay destructive work. Require fresh validation, a new execution identity, and clear linkage to the earlier execution.

### D. Agent fleet administration

| Method       | Endpoint                                       | Function                                             |
| ------------ | ---------------------------------------------- | ---------------------------------------------------- |
| GET          | `/runbooks/agents`                             | List agents, status, capabilities and health         |
| GET          | `/runbooks/agents/{id}`                        | Agent details and safe diagnostics                   |
| POST         | `/runbooks/agent-enrollments`                  | Create one-time enrollment                           |
| GET          | `/runbooks/agent-enrollments/{id}`             | Enrollment status, without re-disclosing secret      |
| POST         | `/runbooks/agents/{id}/revoke`                 | Revoke agent identity                                |
| GET/POST     | `/runbooks/agent-pools`                        | Manage pools                                         |
| PATCH/DELETE | `/runbooks/agent-pools/{id}`                   | Update or remove a pool safely                       |
| PUT/DELETE   | `/runbooks/agent-pools/{id}/members/{agentId}` | Manage membership                                    |
| GET          | `/runbooks/agents/{id}/policy-status`          | Capability and policy-readiness view                 |
| GET/PATCH    | `/settings/runbooks`                           | Safe operational settings already configurable in UI |

Critical rules:

- Enrollment secrets are shown once and never replayed.
- Do not expose agent private keys, raw execution-signing credentials, or agent session tokens.
- Never reuse an ordinary REST API key as an agent credential.
- Agent enrollment and revocation require dedicated admin scopes.
- Agent claims, work acknowledgements, heartbeats, and execution result submission remain under the authenticated `/api/runbook-agent/v1` protocol.
- Revoking an agent must affect future assignment and trigger the existing reconciliation behavior for in-flight work.
- Agent pool deletion must report its service rules and pending executions.

### E. Secret lifecycle

Implement:

`GET/POST /runbooks/secrets`

`POST /runbooks/secrets/{id}/rotate`

`GET /runbooks/secrets/{id}/grants`

`POST /runbooks/secrets/{id}/grants`

`DELETE /runbooks/secrets/{id}/grants/{grantId}`

`GET /runbooks/secrets/{id}/usage`

A successful create/rotation may accept secret material for server-side encryption, but no subsequent GET response may return plaintext. Show reference, fingerprint or safe metadata, rotation time, grants, and usage only.

Secret grants must respect agent scope, service target, execution policy, and safe rotation ordering. A revoked grant must prevent new unauthorized secret use even when API requests race with execution scheduling.

### F. Runbook certification

Test end to end on:

- Docker agent on a local client host
- Kind Kubernetes cluster with an enrolled agent
- Remote OpsKnight control plane over HTTPS
- One and multiple server replicas
- Agent disconnection, retry, revocation and reconnect
- Pool scaling and target changes
- Secret rotation during execution
- Approval expiry and competing approvals
- Database outage and recovery
- Execution cancellation before, during and after dispatch

Completion criterion: REST can administer the runbook control plane safely, while the private agent protocol remains separate and secure.

## 4. Integrations API — Complete connector lifecycle

Priority P0 · High customer value

### Existing implementation

OpsKnight already has provider-specific ingestion handlers in `src/lib/integrations/`, service integration UI, and shared notification/provider controls.

REST v2 currently mainly supports listing, reading, renaming and enable/disable.

### A. Proposed endpoints

| Method    | Endpoint                                | Function                                                |
| --------- | --------------------------------------- | ------------------------------------------------------- |
| GET       | `/integrations/types`                   | List supported provider types and configuration schemas |
| POST      | `/services/{id}/integrations`           | Create a provider integration                           |
| GET/PATCH | `/integrations/{id}`                    | Read safe metadata and update configuration             |
| POST      | `/integrations/{id}/validate`           | Validate configuration without activation               |
| POST      | `/integrations/{id}/test`               | Run a bounded provider-specific diagnostic              |
| POST      | `/integrations/{id}/credentials/rotate` | Rotate inbound secrets or supported credentials         |
| GET       | `/integrations/{id}/credentials`        | Safe key versions and expiration metadata               |
| POST      | `/integrations/{id}/enable`             | Enable only after required checks                       |
| POST      | `/integrations/{id}/disable`            | Stop accepting new work according to policy             |
| GET       | `/integrations/{id}/usage`              | Services, sources and dependent workflows               |
| GET       | `/integrations/{id}/delivery-health`    | Failures, rejection reasons and diagnostics             |
| DELETE    | `/integrations/{id}`                    | Safe removal with dependency handling                   |

### B. Provider-specific configuration

Do not implement one unrestricted `config: Record<string, unknown>` write API for every provider.

Instead, define an allow-listed configuration adapter for each supported class:

- Inbound alert/webhook providers: Endpoint identity, authentication/signature strategy, event mapping, secret rotation.
- Outbound webhooks: URL validation, SSRF protection, destination policy, delivery signing, retries and diagnostics.
- Slack / Microsoft Teams: Existing workspace connection, destinations, permissions and OAuth ownership.
- Jira and other workflow providers: Instance/account connection, permission validation, mapping and lifecycle synchronization.

OAuth authorization must remain an explicit browser/provider consent process. REST can start a controlled setup session and report its status, but cannot issue provider consent or reveal OAuth tokens merely because the caller has an admin API scope.

### C. Credential rotation

Design supported rotations as:

1. Create a replacement credential version.
2. Provide it once, when applicable.
3. Mark old and new versions valid during an explicitly bounded overlap period if the provider supports that.
4. Verify traffic or authentication using the replacement.
5. Revoke the old version.
6. Reconcile errors and record a complete audit trail.

All stages need explicit rollback/error behavior. Never invalidate a working integration merely because a remote provider's credential test timed out.

### D. Failure and deletion safety

Before deletion, return a dependency report identifying affected services, automation rules, provider destinations, and linked response workflows.

A provider timeout must not produce an ambiguous “connected successfully” result. Diagnostics should distinguish authentication, connectivity, rate limiting, unsupported permissions, provider rejection and temporary failure.

Provider tests must be opt-in and constrained so they do not unintentionally create production incidents, send customer-facing messages, or produce excessive cost.

Completion criterion: A customer can provision, validate, rotate, diagnose, disable and safely remove integrations through REST without losing existing alerts or bypassing provider security.

## 5. Schedules API — Complete rotation administration

Priority P1

### Existing implementation

PR #883 provides schedule CRUD, on-call reads, override creation, and participant add/move/remove.

The existing `src/app/(app)/schedules/actions.ts` already includes layer creation, editing, precedence changes, deletion and override deletion. `src/lib/schedules/mutations.ts` contains reusable participant and override commands.

### A. Remaining endpoints

| Method    | Endpoint                                 | Function                                               |
| --------- | ---------------------------------------- | ------------------------------------------------------ |
| GET/POST  | `/schedules/{id}/layers`                 | List/create rotation layers                            |
| GET/PATCH | `/schedules/{id}/layers/{layerId}`       | Read/update timing, restrictions and rotation settings |
| DELETE    | `/schedules/{id}/layers/{layerId}`       | Remove a layer safely                                  |
| PUT       | `/schedules/{id}/layers/order`           | Reorder precedence atomically                          |
| DELETE    | `/schedules/{id}/overrides/{overrideId}` | Cancel an override                                     |
| GET       | `/schedules/{id}/coverage`               | Compute coverage in a requested period                 |
| POST      | `/schedules/{id}/coverage/preview`       | Preview a proposed change without saving it            |
| GET       | `/schedules/{id}/changes`                | Audit relevant changes                                 |
| GET       | `/schedules/{id}/dependencies`           | Show referencing escalation policies                   |

### B. Rotation behavior

Cover the complete schedule configuration supported by the current UI:

- Rotation start and handoff rules
- Rotation intervals and participant order
- Time-zone and daylight-saving behavior
- Restrictions, coverage windows and layer precedence
- Override collision/conflict handling
- Active responder eligibility
- Escalation-policy references

For example, a preview request should answer who will be on call for a proposed time window, where coverage gaps occur, and what changes if a rotation layer is reordered.

Use the current scheduling calculation engine. Do not separately calculate who is on call inside a REST handler.

### C. Critical correctness rules

- DST transition days with 23 or 25 local hours must be covered.
- Two administrators editing the same layer cannot silently overwrite one another.
- A deleted or deactivated user must not remain silently eligible for future paging.
- Cancelling an override must restore the proper computed schedule, rather than storing an obsolete on-call result.
- Moving layers must be one atomic reorder, not multiple independently visible updates.
- Explain and protect changes that leave critical escalation policies without valid responders, according to existing product rules.

### D. Acceptance tests

Run schedule comparisons across time zones, DST boundaries, concurrent overrides, participant membership changes, multiple layers, inactive users, and escalation-policy resolution.

Completion criterion: REST and UI return identical on-call outcomes for every supported schedule configuration and time window.

## 6. Identity API — User and team administration

This is one of the most sensitive areas because OpsKnight supports local authentication, SSO, SCIM provisioning, user invitations, RBAC, and service accounts.

### Existing implementation

Relevant code includes:

- `src/app/(app)/users/actions.ts`
- `src/app/(app)/teams/actions.ts`
- `src/lib/users/admin-invariants.ts`
- `src/lib/teams/membership-commands.ts`
- `src/lib/auth-control/`
- `src/lib/scim.ts`

The current REST v2 directory is primarily read-only for users; team CRUD exists, but membership administration is incomplete.

### A. User lifecycle endpoints

| Method | Endpoint                         | Function                                      |
| ------ | -------------------------------- | --------------------------------------------- |
| POST   | `/users/invitations`             | Invite a user                                 |
| GET    | `/users/invitations`             | List invitations and status                   |
| POST   | `/users/invitations/{id}/resend` | Resend safely                                 |
| POST   | `/users/invitations/{id}/revoke` | Revoke outstanding invitation                 |
| PATCH  | `/users/{id}/role`               | Change a manually managed user's role         |
| POST   | `/users/{id}/deactivate`         | Deactivate and revoke relevant access         |
| POST   | `/users/{id}/reactivate`         | Reactivate according to identity policy       |
| GET    | `/users/{id}/dependencies`       | Report ownership and operational dependencies |
| GET    | `/users/{id}/sessions`           | Authorized session metadata                   |
| POST   | `/users/{id}/sessions/revoke`    | Revoke permitted sessions                     |
| GET    | `/users/{id}/identity`           | Read safe identity ownership metadata         |

### B. Team membership endpoints

| Method   | Endpoint                       | Function                            |
| -------- | ------------------------------ | ----------------------------------- |
| GET/POST | `/teams/{id}/members`          | List/add members                    |
| PATCH    | `/teams/{id}/members/{userId}` | Update membership role              |
| DELETE   | `/teams/{id}/members/{userId}` | Remove member                       |
| POST     | `/teams/{id}/lead`             | Designate/change team lead          |
| GET      | `/teams/{id}/dependencies`     | Show services and policy references |
| PUT      | `/teams/{id}/services`         | Assign managed services             |
| GET      | `/teams/{id}/activity`         | View audit history                  |

Do not assume membership roles and global application roles are interchangeable. Reuse the existing role definitions and team ownership checks.

### C. Identity safety rules

1\. Last-administrator protection

The API cannot demote, deactivate or delete the last eligible administrator. Perform the check transactionally, with concurrency protection against two simultaneous changes.

2\. SSO/SCIM ownership

A SCIM-managed identity should not be silently taken over by manual REST administration.

Define explicit outcomes such as:

- Locally managed: normal administrative workflow allowed.
- SCIM-managed: managed-field changes rejected with an explanation directing the operator to the identity provider.
- SSO-linked: protected identity attributes and linking behavior remain governed by the existing SSO control plane.
- Emergency/break-glass identity: excluded from ordinary bulk administration unless the dedicated security workflow authorizes the operation.

3\. Invitation security

Invitation tokens must be time-bounded, single-use, and securely stored. Never return an existing invitation secret in later list responses.

4\. Role changes

A role demotion or deactivation must trigger relevant session/token invalidation, on-call eligibility changes, and operational dependency reconciliation.

5\. Service accounts

Do not rebuild the service-account API already delivered by PR #883. Preserve its distinct machine-identity model and audit all changes that affect those identities.

### D. Bulk operations

Bulk invitations and role updates would be useful, but require explicit partial-result semantics.

For example, if 100 users are supplied and 3 cannot be changed because of SCIM ownership or administrator invariants, the API must give a detailed per-user result, not claim that all 100 succeeded.

Use an asynchronous job only where the supported workflow genuinely needs one.

Completion criterion: Administrative user/team workflows have API parity without weakening local authentication, SSO, SCIM or recovery security.

## 7. Notifications API — Configuration, testing and diagnostics

### Existing implementation

OpsKnight has a substantial notification control plane:

- `src/lib/notification-control-plane.ts`
- `src/lib/notification-capacity/`
- `src/lib/notification-operations.ts`
- `src/lib/provider-test-service.ts`
- `src/app/api/settings/notifications/route.ts`
- `src/app/api/admin/notifications/providers/[key]/test/route.ts`

REST v2 currently exposes notification history and failed-delivery retry, but not the full configuration and operations layer.

### A. Proposed endpoints

| Method    | Endpoint                                | Function                                  |
| --------- | --------------------------------------- | ----------------------------------------- |
| GET/PATCH | `/services/{id}/notification-settings`  | Service-specific notification settings    |
| GET/PATCH | `/users/me/notification-preferences`    | Self-service channel preferences          |
| GET/PATCH | `/settings/notifications`               | Administrative notification configuration |
| GET       | `/notifications/providers`              | Configured providers and availability     |
| GET       | `/notifications/providers/{key}/health` | Provider diagnostics                      |
| POST      | `/notifications/providers/{key}/test`   | Controlled test send                      |
| GET       | `/notifications/operations`             | Filtered operational delivery history     |
| GET       | `/notifications/{id}`                   | Delivery detail with permitted redactions |
| GET       | `/notifications/{id}/attempts`          | Attempt history                           |
| GET       | `/notifications/{id}/feedback`          | Provider acceptance/failure feedback      |
| GET/PATCH | `/settings/notifications/capacity`      | Runtime capacity settings                 |
| GET       | `/notifications/capacity/health`        | Saturation, queues and throttling         |
| POST      | `/notifications/operations/{id}/retry`  | Authorized recovery action                |

### B. Notification policy configuration

Expose the existing delivery policy and channel configuration. Where supported by OpsKnight's policy engine, clients should be able to configure different delivery behavior by priority, escalation step, or service.

For example, a customer may want a critical incident to escalate through several channels, while a lower-priority event uses Slack only.

However, do not add a simplified P1/P2 shortcut that bypasses escalation-policy conditions, quiet hours, channel eligibility, or notification-intent logic. Model such behavior through the canonical response and notification policy contracts.

### C. Delivery status and reliability

Every message needs a clear lifecycle.

| State      | Meaning                                                    |
| ---------- | ---------------------------------------------------------- |
| QUEUED     | Durable notification intent exists                         |
| SENDING    | Worker/provider attempt in progress                        |
| ACCEPTED   | Provider accepted the request                              |
| DELIVERED  | Delivery confirmed when the provider supports confirmation |
| FAILED     | Terminal or currently exhausted failure                    |
| UNKNOWN    | Provider outcome cannot be established reliably            |
| SUPPRESSED | A deliberate policy prevented sending                      |

Use the actual state vocabulary supported by each provider and control-plane model; the table above describes the target semantics, not a mandatory database enum migration.

Do not treat a successful HTTP call to Twilio, Slack or Microsoft Teams as proof that the recipient received the notification.

### D. Safety controls

- Bound retries and total delivery cost.
- Prevent an API retry from bypassing the canonical notification-intent or deduplication safeguards.
- Preserve high-priority traffic isolation under lower-priority load.
- Respect user consent and channel preferences.
- Require additional authorization for sending provider tests to arbitrary recipients.
- Redact recipient details, message bodies and provider credentials according to role.
- Use durable reconciliation when a provider's final outcome is unknown.
- Expose meaningful retryability and remediation information.

### E. Operational settings

Configuration should be manageable from the admin UI and REST. Distinguish live product policies from infrastructure configuration.

For example, an administrator should be able to adjust an approved notification capacity policy through the control plane. An API caller must not be allowed to mutate infrastructure credentials or bypass hard safety limits.

Completion criterion: Customers can configure notifications and investigate failed or delayed delivery through REST without compromising paging safety.

## 8. Status Pages API — Complete public communication administration

### Existing implementation

OpsKnight already has:

- A status-page administrative control plane
- Service visibility/configuration
- Privacy settings
- Branding
- Subscriber management
- Domain handling
- Announcements
- Publication/reconciliation mechanisms

Relevant paths include `src/lib/status-pages/`, `src/app/api/settings/status-pages/`, and `src/app/api/status-page/`.

The existing `MAX_STATUS_PAGES = 1` boundary must remain intact.

### A. Service components and presentation

OpsKnight currently presents status-page services using service membership and configuration. Do not introduce a separate component database model just to imitate another vendor unless the product needs distinct component identities.

| Method    | Endpoint                                  | Function                                       |
| --------- | ----------------------------------------- | ---------------------------------------------- |
| GET/PUT   | `/status-pages/{id}/services`             | List/set visible services                      |
| PATCH     | `/status-pages/{id}/services/{serviceId}` | Update supported service presentation settings |
| GET/PATCH | `/status-pages/{id}/appearance`           | Branding/theme configuration                   |
| GET/PATCH | `/status-pages/{id}/privacy`              | Public-data exposure rules                     |
| GET/PATCH | `/status-pages/{id}/content`              | Display and historical content controls        |
| GET/PATCH | `/status-pages/{id}/settings`             | Other supported settings                       |
| GET       | `/status-pages/{id}/preview`              | Preview prospective output                     |
| POST      | `/status-pages/{id}/publish`              | Publish configuration                          |
| GET       | `/status-pages/{id}/publication`          | Live/pending/failed publication status         |

### B. Subscribers

| Method | Endpoint                                        | Function                             |
| ------ | ----------------------------------------------- | ------------------------------------ |
| GET    | `/status-pages/{id}/subscribers`                | Authorized paginated listing         |
| GET    | `/status-pages/{id}/subscribers/{subscriberId}` | Safe subscriber details              |
| DELETE | `/status-pages/{id}/subscribers/{subscriberId}` | Administrative removal               |
| GET    | `/status-pages/{id}/subscriber-stats`           | Aggregate counts                     |
| GET    | `/status-pages/{id}/subscription-settings`      | Supported subscription configuration |

Public subscriber registration and unsubscribe flows should remain separate, consent-aware endpoints using the existing verification mechanisms.

### C. Domains and branding

Proposed:

`GET/POST /status-pages/{id}/domains`

`POST /status-pages/{id}/domains/{domainId}/verify`

`DELETE /status-pages/{id}/domains/{domainId}`

`POST /status-pages/{id}/branding-assets`

`DELETE /status-pages/{id}/branding-assets/{assetId}`

For custom domains, require proof of domain ownership, validate routing configuration, and reconcile activation asynchronously where necessary. Never let callers claim arbitrary hostnames and immediately route public traffic.

For branding uploads, enforce actual MIME validation, file-size limits, safe image processing, and authorized object storage.

### D. Privacy, publication and fanout

These are particularly important:

- Public preview must apply the exact publication privacy policy.
- Subscribers' addresses and webhook destinations must not leak through broad read scopes.
- Privacy setting changes must invalidate stale public projections where required.
- Successful database persistence is not equivalent to successful public publication.
- Announcement changes must not trigger duplicate subscriber sends.
- Subscription exports, if supported, need explicit privacy authorization, retention and audit.
- One-page capacity must be enforced across UI and REST, including concurrent create attempts.

Completion criterion: Every supported status-page setting and administrative workflow can be managed through REST, with correct public output and no privacy leakage.

## 9. Reporting, dashboards, SLOs and postmortems

This area needs a careful split because some capabilities are already fully part of the product, while others are still evolving.

### A. Reporting and export jobs

REST v2 already has a metrics reporting endpoint.

Add versioned reporting operations:

| Method           | Endpoint                         | Function                            |
| ---------------- | -------------------------------- | ----------------------------------- |
| GET              | `/reports/catalog`               | Available reports and dimensions    |
| POST             | `/reports/query`                 | Validated, bounded analytical query |
| GET/POST         | `/reports/saved`                 | List/create saved reports           |
| GET/PATCH/DELETE | `/reports/saved/{id}`            | Manage a saved definition           |
| POST             | `/reports/exports`               | Create an export job                |
| GET              | `/reports/exports/{id}`          | Job state, filters and metadata     |
| GET              | `/reports/exports/{id}/download` | Authorized result access            |
| POST             | `/reports/exports/{id}/cancel`   | Cancel pending processing           |

Heavy reporting must be asynchronous when it could exhaust HTTP worker or database resources.

Implement export quotas, bounded date ranges, retention, cleanup, and authorization at both job creation and download time.

A generated file must never become publicly accessible merely because someone learns its object-storage URL.

### B. Dashboards

Existing dashboard endpoints and UI logic are under `src/app/api/dashboards/`, `src/app/(app)/reports/executive/`, and `src/lib/reports/widget-registry.ts`.

Expose their supported model through v2:

`GET/POST /dashboards`

`GET/PATCH/DELETE /dashboards/{id}`

`POST /dashboards/{id}/duplicate`

`GET /dashboards/{id}/widgets`

`PUT /dashboards/{id}/widgets`

`GET /dashboards/{id}/data`

`POST /dashboards/{id}/export`

Requirements:

- Only supported widget types can be created.
- Widget filters and report dimensions must be validated.
- Dashboard visibility must not grant access to incident data beyond the caller's rights.
- Preserve dashboard layout and stable widget identity.
- Use the existing metrics engine and caching rather than adding ad hoc large SQL queries in REST handlers.
- Avoid synchronous generation of expensive exports.

### C. SLO management

OpsKnight has an existing SLO backend in `src/lib/slo/` and older `/api/v1/service-objectives` endpoints. The current service-objectives UI is not a complete supported management workflow.

I would not blindly copy the older API into public REST v2 and claim SLO feature parity.

First, complete and certify the product contract for service objectives:

- Supported metrics and their definitions
- SLO window calculations
- Targets and comparators
- Versioning and historical changes
- Evaluation frequency and failure handling
- Service ownership and authorization
- Rollup precision and query performance

Once that boundary is approved, expose:

| Method    | Endpoint                             |
| --------- | ------------------------------------ |
| GET/POST  | `/service-objectives`                |
| GET/PATCH | `/service-objectives/{id}`           |
| POST      | `/service-objectives/{id}/evaluate`  |
| GET       | `/service-objectives/{id}/history`   |
| GET       | `/service-objectives/{id}/versions`  |
| GET       | `/service-objectives/{id}/snapshots` |
| POST      | `/service-objectives/{id}/archive`   |

Evaluation should be reproducible from the authoritative measurement data and stored version.

### D. Advanced postmortems

Basic postmortem CRUD already exists. The UI has structured functionality beyond that REST contract.

Complete the following:

| Method       | Endpoint                                  | Function                        |
| ------------ | ----------------------------------------- | ------------------------------- |
| GET/PATCH    | `/postmortems/{id}/impact`                | Structured impact metrics       |
| GET/POST     | `/postmortems/{id}/factors`               | Contributing factors            |
| GET/POST     | `/postmortems/{id}/five-whys`             | Structured root-cause analysis  |
| GET/POST     | `/postmortems/{id}/action-items`          | Corrective actions              |
| PATCH/DELETE | `/postmortems/{id}/action-items/{itemId}` | Manage action lifecycle         |
| GET/POST     | `/postmortems/{id}/contributors`          | Collaborators and roles         |
| POST         | `/postmortems/{id}/publish`               | Explicit publication transition |
| GET          | `/postmortems/{id}/versions`              | Change history                  |

Reuse the existing `src/app/(app)/postmortems/actions.ts` data model and workflows.

Never allow the API to write an `impact` field and silently discard it, which was an issue explicitly guarded against in the existing v2 contract.

Ensure postmortem and action-item access follows incident visibility, and public publication cannot reveal private incident details.

### E. Audit exports

Add a separately privileged audit export workflow with:

- Bounded filtering
- Immutable evidence generation
- Export-job retention
- Integrity verification where supported
- Authorized result access
- Audit trail of who requested and downloaded evidence

Existing compliance export machinery should be reused where appropriate, rather than creating a weaker parallel path.

Completion criterion: Every approved and supported reporting/dashboard/postmortem workflow is reproducible through REST; unfinished SLO capabilities remain clearly marked until completed.

## 10. Cross-cutting platform work required before calling the API enterprise-grade

Adding endpoints alone will not make the implementation a 10/10. These shared components need certification across all eight areas.

### A. Authorization architecture

Create a declarative authorization matrix for each operation.

Illustrative target policy; final grants must be reviewed against OpsKnight's existing RBAC rules.

| Capability                        | Admin                | Responder                     | Auditor                   | User               |
| --------------------------------- | -------------------- | ----------------------------- | ------------------------- | ------------------ |
| Read permitted service automation | Yes                  | Policy-dependent              | Read-only                 | Scoped if approved |
| Publish automation                | Yes                  | No by default                 | No                        | No                 |
| Execute approved runbook          | Yes                  | Yes                           | No                        | No                 |
| Manage runbook agents/secrets     | Explicit admin scope | No by default                 | No                        | No                 |
| Manage integrations               | Explicit admin scope | No by default                 | No                        | No                 |
| Edit schedule rotation            | Admin                | Authorized owner if supported | No                        | No                 |
| Manage users and roles            | Admin                | No                            | No                        | No                 |
| Read notification diagnostics     | Yes                  | Permitted data                | Redacted                  | Own data only      |
| Manage status-page privacy        | Admin                | No by default                 | No                        | No                 |
| Export sensitive reporting data   | Scoped privilege     | Scoped privilege              | Approved export privilege | No by default      |

For each operation, build tests for insufficient scopes, inactive identities, inaccessible resources, wrong parent IDs, cross-team objects, stale membership, expired tokens, and attempts to manipulate nested resource identifiers.

Broad scopes such as `admin:manage` must never silently bypass explicit infrastructure privileges.

### B. Shared domain commands

When refactoring server actions, use a consistent pattern:

```
type DomainCommandContext = {
  actor: AuthorizationActor;
  tx: Prisma.TransactionClient;
  source: "UI" | "API";
  apiClientId?: string;
};

async function updateResource(
  context: DomainCommandContext,
  input: ValidatedInput
) {
  // Validate authorization and business invariants.
  // Update authoritative state.
  // Persist required audit and outbox records.
  // Return a safe business result.
}
```

Avoid making UI actions call the public API over HTTP. UI and REST should call the same server-side command.

### C. Consistency and idempotency

Not every operation should use the same retry strategy.

| Operation type          | Recommended behavior                         |
| ----------------------- | -------------------------------------------- |
| Read                    | Safe to retry                                |
| Simple metadata update  | Revision-conditional                         |
| Side-effecting mutation | Durable idempotency key                      |
| Relative reorder        | Revision + idempotency                       |
| Publish/activate        | Revision + dependency recheck + idempotency  |
| Provider test           | Explicit confirmation and bounded send       |
| Secret issuance         | Never replay a previously issued secret      |
| Export generation       | Durable job with deduplication               |
| Destructive deletion    | Dependency check and atomic state transition |

Treat concurrency failures, already-completed operations, and retriable infrastructure failures differently. A repeated cancellation request should not generate duplicate jobs or duplicate audit records.

### D. Performance and high availability

Keep the current PostgreSQL architecture.

For each API family, verify:

- Query plans and indexes for its largest expected datasets
- Maximum response sizes and cursor pagination
- Transaction durations and lock ordering
- Database connection-pool use across multiple app replicas
- Bounded work queue size and concurrency
- Cache invalidation on configuration changes
- Worker restarts and job reclamation
- Retry storms, rate-limit floods and provider outages
- Storage growth for logs, automation traces, exports and execution evidence
- Graceful API degradation when optional providers are unavailable

Test with 1, 2 and 4 application replicas. Measure throughput, p50/p95/p99 latency, database CPU, active connections, lock waits, errors, queue lag and recovery times.

Capacity claims should be published only with the hardware, data set, topology, load profile and results that produced them.

### E. API Explorer and SDK improvements

The Developer & API Access workspace should become the operational interface for the whole v2 API.

It should support:

- Searching endpoints by domain and operation
- Showing required role, scopes and resource permissions
- Providing verified request/response examples
- Showing required headers, including ETags and idempotency keys
- Discovering IDs from permitted resources
- Safely testing read operations
- Explicit confirmation for side-effecting or destructive operations
- Previewing errors and common remediation steps
- Showing supported, restricted and unsupported capabilities
- Offering generated TypeScript and Python clients

The Explorer must not expose a privileged credential in browser-visible examples or persist customer secrets inside local test history.

Regenerate `sdk/openapi-v2.json`, both client packages, operation samples and capability documentation for each shipped endpoint.

A critical goal: OpenAPI is a truthful description of actual runtime behavior, including permission failures, retry contracts, pagination and asynchronous outcomes.

## 11. Recommended PR breakdown and execution order

I recommend keeping PR #883 as the established foundation rather than turning it into a massive all-domain PR.

Proposed implementation sequence, not a delivery schedule.

| PR     | Scope                                                                             | Dependencies                                      | Priority        |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------- | --------------- |
| API-13 | Capability inventory, route security contracts, reusable domain-command standards | #883 baseline                                     | P0              |
| API-14 | Service automation API: drafts, simulation, publish, modes, traces                | Merge/certify automation branch                   | P0              |
| API-15 | Runbook service rules, policies, approvals and lifecycle                          | Domain-command extraction                         | P0              |
| API-16 | Runbook agents, pools, enrollment, secrets and grants                             | Dedicated scopes/security review                  | P0              |
| API-17 | Integration provisioning, testing, rotation, safe deletion                        | Provider-specific adapters                        | P0              |
| API-18 | Schedule layers, precedence, override cancellation and coverage                   | Shared schedule command extraction                | P1              |
| API-19 | User/team membership, invitations, role and account lifecycle                     | SCIM/SSO safety invariants                        | P1              |
| API-20 | Notification preferences, operations, provider health and capacity                | Control-plane command adapters                    | P1              |
| API-21 | Status-page service configuration, privacy, domains, subscribers                  | Publication and privacy policies                  | P1              |
| API-22 | Dashboards, reports, exports and structured postmortems                           | Reporting/query and background-job infrastructure | P1              |
| API-23 | SLO API and related UI parity, after product contract approval                    | SLO model certification                           | P2              |
| API-24 | Final API Explorer, SDK distribution, documentation and certification             | All approved API families                         | P0 release gate |

These can be split further when a PR spans sensitive domain migrations and API exposure. For example, runbook agent enrollment and secret management should have separate reviews if their security changes become substantial.

### Suggested milestone sequence

Milestone A — Platform and critical automation

API-13 through API-17. Complete the most operationally valuable missing control-plane functions: automation, runbooks and integrations.

Milestone B — Daily operational administration

API-18 through API-20. Complete schedules, identity/team management and notifications.

Milestone C — Customer communication and analytics

API-21 through API-23. Complete status pages, dashboards, reporting, postmortems and the approved SLO model.

Milestone D — Enterprise certification

API-24. Full contract, authorization, load, resilience, SDK and documentation validation.

## 12. Enterprise certification — Definition of done

Every individual PR must pass its focused certification before merge. Once all intended API functionality is implemented, certify the combined system.

Final release gates

0/8

Full approved API capability matrix

Every supported UI workflow is mapped to an operation or an explicitly documented protocol/security exception.

Security and authorization

Role, scope, object visibility, cross-service and negative tests; no unresolved critical/high findings accepted for the release.

UI/API business parity

Equivalent inputs result in equivalent domain state, audit, side effects and policy enforcement.

Idempotency and concurrency

Duplicate keys, distinct-key races, optimistic conflicts and rollback behavior are tested against PostgreSQL.

End-to-end operations

Real Docker/Kind agent runs, provider test boundaries, status publication, schedule calculation and identity safety flows.

Load and recovery

Measured capacity and graceful behavior with 1/2/4 replicas, DB pressure, restart/failover and downstream outages.

Developer experience

Verified OpenAPI, generated clients, stable errors, accurate Explorer, usage examples and compatibility guidance.

Release and upgrade safety

Migrations, earlier API compatibility, existing tokens, deployment modes, rollback and dependency advisories reviewed.

Use this as a review checklist. The boxes are not live certification results.

### Required test suites

| Test layer      | What it proves                                                                    |
| --------------- | --------------------------------------------------------------------------------- |
| Unit            | Validation, state machines, field rules and policy decisions                      |
| Contract        | OpenAPI paths, schemas, scopes, headers, SDK compatibility                        |
| Integration     | PostgreSQL transactions, concurrency, dependencies and audit                      |
| Security        | BOLA, IDOR, privilege escalation, cross-team isolation, secret handling           |
| UI/API parity   | Same outcome through both interfaces                                              |
| End-to-end      | Actual agents, provider test workflows, status publication, identity operations   |
| Fault injection | DB restart, worker termination, timeout, stale cache and partial external failure |
| Load            | Measured capacity, connection pressure and latency under realistic mixes          |
| Upgrade         | Existing deployments, tokens, configurations and supported versions               |

### Performance acceptance

Rather than invent universal requests-per-second targets, establish a benchmark profile for representative deployments and certify against it.

At minimum, cover three workload classes: ordinary list/read traffic, concurrent administrative mutations, and mixed incident ingestion plus notification/runbook background work.

Define explicit latency and error budgets for each class before running certification, and publish measured results. Unbounded reporting or exports must never monopolize the connections needed for urgent incident processing.

## 13. Scope boundaries — What should deliberately remain separate

Complete feature parity does not mean exposing every internal action through public REST.

| Workflow                                        | Decision                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| SCIM provisioning                               | Keep the dedicated SCIM v2 protocol                                    |
| SSO consent, callbacks and identity linking     | Keep protected identity workflows                                      |
| Break-glass access and encryption-key internals | Use dedicated security control planes                                  |
| Runbook-agent claims and result submission      | Keep private authenticated agent protocol                              |
| Raw provider OAuth access tokens                | Never expose as general REST resources                                 |
| Internal maintenance/worker queues              | Expose safe administration and diagnostics, not arbitrary job mutation |
| Status-page creation beyond the product limit   | Remain unsupported                                                     |
| Features not yet approved in the UI/product     | Do not claim parity prematurely                                        |

This is important: a product can have complete, enterprise-grade public API coverage without exposing unsafe internal functions.

## 14. Recommended starting point

I would execute the work in the following order:

First, stabilize and merge PR #883 after its required checks and reviews pass. Its 84 operations, shared commands, idempotency controls and SDK infrastructure are the foundation.

Second, integrate and certify the separate service-automation branch. Then expose its existing draft, publish, simulation, mode and trace workflows.

Third, finish runbook service rules, approvals, agents, pools, enrollment and secrets. This is the most security-sensitive remaining work and should not be rushed.

Fourth, implement integration provisioning/rotation before moving to schedules, identity and notifications.

Finally, complete status pages, dashboards, reporting and approved SLO workflows; run comprehensive performance, high-availability and failure-recovery certification.

### Final target

The project should only be marked enterprise API-complete when:

- Every approved, supported product workflow has a correct public API or explicit protocol exception.
- No duplicate business logic has been introduced.
- No new authorization bypasses or secret exposure paths exist.
- The SDKs and Explorer correctly represent every supported operation.
- Real PostgreSQL, Docker, Kubernetes, multi-replica, performance and recovery testing has passed.
- Upgrade compatibility and production operating limits are documented with evidence.

This is the path from the current 84-operation REST v2 foundation to a genuinely complete OpsKnight API. The objective is not maximizing endpoint count—it is making the entire supported product safely automatable, predictable, and maintainable.