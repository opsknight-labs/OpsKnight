---
title: Service automation reference
description: Exact field, condition, action, version, readiness, privacy, and failure contracts for service automation.
type: reference
product_area: services
audience: [administrator, responder, operator, developer]
verification:
  level: source
  verified_at: 2026-10-30
  evidence:
    - src/lib/automation/contract.ts
    - src/lib/automation/compiler.ts
    - src/lib/automation/context/extract.ts
    - src/lib/automation/context/normalize.ts
    - src/lib/automation/evaluator/operators.ts
    - src/lib/automation/runtime.ts
    - src/lib/automation/settings-command.ts
    - src/lib/automation/readiness.ts
    - src/lib/automation/authoring.ts
    - src/lib/api-v2/request-body.ts
    - src/app/api/v2/services/[id]/automation/draft/route.ts
    - src/app/(app)/services/[id]/automation/actions.ts
    - src/lib/automation/jobs.ts
    - src/lib/automation/history.ts
    - src/lib/automation/observation-history.ts
    - src/app/api/v2/services/[id]/automation
    - src/app/api/v2/settings/automation/route.ts
    - src/app/api/services/[id]/automation/route.ts
    - src/components/automation/AutomationTest.tsx
    - src/lib/automation/golden.ts
    - src/lib/authorization.ts
    - src/lib/metrics/operational/registry.ts
    - src/app/api/v2/services/[id]/automation/candidate/route.ts
    - src/app/api/v2/services/[id]/automation/candidates/activate/route.ts
    - tests/integration/automation-certification.test.ts
    - tests/integration/automation-readiness-policy.test.ts
---

# Service automation reference

For the operator workflow, see [Configure and roll out service automation](../guides/services/service-automation).
For a complete snapshot and scripted lifecycle, see the
[API authoring walkthrough](../guides/services/service-automation-api).
For the execution model, see [Service automation](../concepts/service-automation).

## Snapshot and field definitions

An authoring snapshot contains `schemaVersion: 1`, `fields`, and `rules`. These
objects use strict schemas: unknown properties are rejected. Field and rule
identities must be unique. Custom field keys match `^[a-z][a-z0-9_]{0,63}$` and
cannot duplicate built-ins or use sensitive/reserved names.

Built-ins are `priority` (P1–P5), `urgency`, `severity`, `integration`, and `source`.
Custom fields use `STRING`, `ENUM`, `NUMBER`, or `BOOLEAN`:

- Text and choice values are trimmed; case-insensitive fields normalize text to
  lowercase. Enum recognition returns the declared canonical choice.
- Aliases apply to text and choice fields. Enum alias targets must be declared
  canonical values. Conflicting normalized aliases/choices are invalid.
- Numbers accept finite numeric values and numeric strings; booleans are not numbers.
- Booleans accept true/false and case-insensitive strings `true`/`false`.
- Null, absent, and blank strings are Missing. A scalar incompatible with the
  configured type or enum choices is Unmapped.
- Objects, arrays, over-limit strings, and sensitive values can cause extraction
  failure rather than becoming usable context.

Mapping sources are `EVENT` (normalized event) and `PROVIDER` (provider payload).
An optional `integrationType` restricts a mapping to that exact integration type.
Mappings are ordered: the first non-null/nonblank value wins before normalization.

Paths support property traversal, numeric indexes such as `alerts[0].labels.env`,
and an optional leading `$`. Root array access requires bracket notation, such
as `[0].environment`. Wildcards, filters, and arbitrary expressions are not
supported. Prototype access and path segments resembling authorization, cookies,
passwords, tokens, secrets, signatures, integration keys, API keys, or credentials
are blocked.

## Conditions and three-valued matching

All conditions within a rule are ANDed. An empty condition list is true. A rule
runs only when its combined result is `TRUE`; `FALSE` and `UNKNOWN` do not match.

Supported operators:

- Equality: `EQ`, `NE` with a canonical scalar value.
- Membership: `IN`, `NOT_IN` with a list of canonical values.
- Numeric comparison: `LT`, `LTE`, `GT`, `GTE` with a number on a numeric field.
- State checks: `IS_SET`, `IS_MISSING`, `IS_UNMAPPED`, without a comparison value.

`IS_SET` is true for both Recognized and Unmapped values. It does not guarantee
that a value can participate in ordinary comparisons. For Missing or Unmapped
fields, `EQ` and `IN` return false; negative and ordered comparisons return
unknown. Use explicit state checks when defining a fallback for unknown data.

Condition values must already be canonical. An alias that normalizes to a different
value is invalid as a condition value; use the canonical result instead.

## Actions and rule ordering

Enrichment (`ENRICH`) allows:

- `SET_PRIORITY`: set P1–P5.
- `SET_CONTEXT`: write a canonical value into a declared custom field.
- `ADD_TAG`: add a tag, deduplicated within the evaluation.

All matching enrichment rules run in order, with later field writers winning.
Routing evaluates the resulting context and stops at the first matching rule.

Routing (`ROUTE`) requires exactly one of:

- `USE_SERVICE_DEFAULT`.
- `USE_ESCALATION_POLICY` with an active, valid policy ID.
- `NO_ESCALATION`.

It can also contain `NOTIFY_CHANNEL` actions for service-owned enabled Slack or
Teams destinations. Duplicate provider/destination actions in the winning rule
are deduplicated. These notifications are supplemental to responder escalation.
No matched route means service default. No escalation does not discard the event,
prevent incident creation, or mute unrelated notification paths.

Compilation validates disabled rules too. Warnings include overlapping priority
writers and routes hidden behind an unconditional route. Blocking errors include
invalid fields/values, unsupported phase actions, and routing rules with anything
other than one responder route. Publication and activation also check referenced
policies and destinations, not just snapshot syntax.

An enabled unconditional `NO_ESCALATION` route is a blocking
`CATCH_ALL_NO_ESCALATION` error. Use explicit, reviewed conditions for suppression.
The `displayOnly` field flag suppresses the unused-field warning; it does not
prevent extraction or prohibit conditions from referencing the field.

## Bounds

- UI automation actions and the shared validation/simulation helpers enforce a
  256 KiB serialized UTF-8 JSON limit. Validation checks the snapshot; simulation
  also checks its full input, and UI actions check their full action input.
- v2 API requests have a separate 1 MiB body limit. Draft PUT and publication do
  not invoke the 256 KiB helper: a schema-valid draft above 256 KiB may be saved
  and published through the API, even though validation/simulation or UI actions
  can reject it. Keep configurations within the smaller limit when using both
  the UI and API.
- 64 custom fields; extraction path depth 12.
- 32 mappings per field.
- 200 aliases per field and up to 200 canonical enum choices.
- 100 rules, 20 conditions per rule, and 8 actions per rule.
- 200 values in a membership condition.
- Text scalars: at most 2,048 UTF-8 bytes; enum values: 256 UTF-8 bytes.
- Field/rule IDs and display names: at most 100 characters; tags: 64 characters.
- Evaluation guard budget: 15 ms. This is an evaluator safety limit, not an
  end-to-end ingestion latency guarantee; database and downstream work have
  separate costs.

## Version lifecycle and readiness

Draft save requires the current draft revision. Publication checks the expected
active version and creates immutable history with a compiled checksum.

- Disabled/Shadow publication updates the active version and clears any candidate.
- Live publication stages a candidate while the active version keeps routing.
  If a candidate already exists, publication must supply its expected identity;
  omission or a mismatched identity is a conflict.
- Candidate activation requires Live mode and global enablement, validates the
  candidate and dependencies again, promotes it, and clears the candidate atomically.
- Candidate discard clears only the candidate pointer.
- Restore copies history into a draft and preserves restoration lineage. It does
  not publish, activate, change mode, or discard a candidate.

Every mode-change request selecting Live requires a valid published active
version and safe dependencies. No Shadow evidence in the last seven days requires
`acknowledgeNoShadow`; any recorded errors/fallbacks require
`acknowledgeShadowErrors`. Do not assume candidate quantity/freshness thresholds
are enforced for mode changes to Live. These checks run again when re-enabling
a previously Live service after Disabled or Shadow, and when requesting Live
while already Live.

Candidate promotion uses the configurable readiness policy. Defaults are:

- `minimumEvaluations`: 100.
- `maximumEvidenceAgeHours`: 48.
- `maximumPendingObservations`: 0.
- `maximumErrorRate`: 0.

Evidence totals cover seven days. Age is measured from the latest daily aggregate
bucket, so it is not exact event-time freshness. Error rate is
`max(errors, fallbacks) / evaluated`; overlapping counters are not added together.
Pending counts include both pending and processing observation jobs and may be
bounded lower-bound samples.

An administrator may explicitly acknowledge insufficient/stale evidence, errors
above policy, and material route/priority/no-escalation differences. A backlog
above policy and a malformed readiness policy remain blocking. Concurrent changes
to reviewed versions or settings can invalidate activation; reload and review again.

## Settings, privacy, and retention

Global settings control enablement, trace/observation retention, diagnostic value
previews, and candidate readiness policy. Retention defaults to 90 days and accepts
1–3,650 days. Observation previews default to false.

With previews disabled, discovery retains keyed service-scoped value identities
and counts with empty previews. Preview opt-in permits bounded examples, subject
to sensitive-value filtering. It does not guarantee that arbitrary free text is
free of personal data. Alias authoring from historical values needs a retained,
readable preview. Avoid secrets and personal data in fields and test samples.

Disabling previews hides them at the response boundary immediately and queues
bounded, resumable physical cleanup. Each batch scrubs up to 200 observation rows
and 200 queued payloads. Inspect cleanup status and retry failed cleanup through
the administrator controls. Retention cleanup is background work, not synchronous
expiry at the instant the retention boundary passes.

The v2 API observations endpoint returns metadata/frequencies, not raw previews
or hashes. API simulation returns priority, safe tags, routes, and condition truth states,
but omits raw received values, custom context values, and provider payloads. Incident-level decision diagnostics also check incident visibility. Service-level
traces, stored samples, and observation previews have additional capability gates:
Administrators and Responders have sensitive incident access; Auditors can read
automation configuration but receive redacted trace values and cannot load stored
alert payloads. Reading stored observation previews requires both sensitive access
and the global preview setting.

## API access and concurrency

The base resource is `/api/v2/services/{id}/automation`. API roles, service
ownership, scopes, and incident visibility all apply; a scope alone is insufficient.

- `automation:read`: configuration, draft/history, validation, simulation,
  observations, and candidate review. Decisions additionally require `incidents:read`.
- `automation:write`: draft editing/restoration; responders must belong to the
  service team, while administrators can edit any service.
- `automation:publish`: administrator publication, mode changes, and promotion.

Draft save/restore and publication use the **draft** ETag. Mode changes use the
**configuration** ETag. Candidate activation/discard use expected version IDs in
the body and require `Idempotency-Key`; these two routes do not require `If-Match`.
Supply the reviewed active version and readiness-policy revision on candidate
activation to detect changes to those reviewed resources as well. A stale precondition returns 412; refetch and review
rather than blindly retrying with a new precondition. Draft writes replace the
complete desired snapshot.

See the [v2 API reference](./api/v2#service-automation-drafts-and-publication) for
request/response and retry contracts, and the [API inventory](./api/) for routes.
Validation and simulation do not create incidents or notification/observation jobs.

## Audit and worker operations

Configuration commands record attributed audit events in the same transaction as
successful changes. Useful actions include `automation.draft.updated`,
`automation.draft.restored`, `automation.context.mapping.updated`,
`automation.version.published`, `automation.rollback.published`,
`automation.candidate.activated`, `automation.candidate.discarded`,
`automation.mode.changed`, and `automation.settings.updated`. Shadow/Live enablement
also records `automation.shadow.enabled` / `automation.live.enabled`. Inspect the
actor and reviewed version identities when reconstructing a configuration change.

Observation processing (`AUTOMATION_OBSERVE`) updates discovery and Shadow
aggregates with retry-safe bookkeeping. Retention (`AUTOMATION_RETENTION`) processes
bounded batches of old traces and observations; once history exists, retention
continues even when global automation is OFF. Privacy cleanup uses its own
`AUTOMATION_PRIVACY_CLEANUP` task. Keep the scheduler and appropriate workers
running for these operations; turning off routing does not finish maintenance work.

Supplemental Slack messages use central notification intents; Teams messages use
the Teams delivery pipeline. A committed automation route is not proof of provider
delivery. A missing/disabled destination at enqueue time can skip the supplemental
notification, and delivery has its own retry and failure records. The global routing
switch does not recall a notification intent already committed for delivery.

## Complete v2 endpoint checklist

These paths are relative to `/api/v2/services/{id}/automation`. Path IDs must be
valid service/version IDs, not names. Read endpoints use `automation:read` unless
stated otherwise; normal actor/resource authorization also applies.

- `GET /`: effective configuration, revision ETag, active/candidate summaries, and
  seven-day health. Global state and counters are related data, not part of the
  configuration revision's write precondition.
- `GET /draft`: current snapshot and draft ETag; an absent draft returns revision
  zero and the empty snapshot.
- `PUT /draft`: complete `{ snapshot }` replacement; `automation:write`, draft
  `If-Match`, and `Idempotency-Key` required.
- `POST /validate`: `{ snapshot }`; returns validity/issues and an activation-review
  reminder. It does not publish and does not waive activation gates.
- `POST /simulate`: `{ snapshot, event, integrationType }`, with optional
  service-owned `integrationId`, `providerPayload`, and ISO `evaluationAt`;
  returns redacted outcomes. Validation/simulation use the SEARCH_EXPORT rate-limit
  tier and do not require write scope or an idempotency key.
- `POST /publish`: `{ expectedActiveVersionId, expectedCandidateVersionId? }`;
  administrator `automation:publish`, draft `If-Match`, and `Idempotency-Key`
  required. Existing-candidate replacement requires its expected identity.
- `PATCH /mode`: `{ mode, expectedActiveVersionId, acknowledgeNoShadow?,
  acknowledgeShadowErrors? }`; administrator publication scope, configuration
  `If-Match`, and `Idempotency-Key` required.
- `GET /versions`: immutable history summaries in descending version-number order.
- `GET /versions/{versionId}`: service-owned historical snapshot and lint report.
- `POST /restore`: `{ sourceVersionId }`; write scope, draft `If-Match`, and
  `Idempotency-Key` required. Returns the new draft and its ETag.
- `GET /candidate`: candidate snapshot, aggregates, readiness, and evidence-freshness
  summary; no candidate returns not found rather than an empty candidate.
- `POST /candidates/activate`: expected candidate ID plus optional expected active
  ID, policy revision, and acknowledgement flags; administrator publication scope
  and `Idempotency-Key` required; no `If-Match` requirement.
- `DELETE /candidate`: `{ expectedCandidateVersionId }`; administrator publication
  scope and `Idempotency-Key` required; no `If-Match` requirement.
- `GET /decisions`: incident decision metadata; additionally requires
  `incidents:read` and incident visibility. It omits stored summaries/source values.
- `GET /observations`: discovery metadata/frequencies; optional `unmapped=true`
  or `unmapped=false`. It omits previews and value hashes.

Versions, decisions, and observations accept `limit` (1–100) and `cursor`; follow
`pagination.nextCursor` while `pagination.hasMore` is true. Cursors are validated
against their service and ordering boundary. Do not reuse an observation cursor
with a different unmapped filter. Observation order uses first-seen time and ID,
so a frequency refresh does not move an existing row between pages. Configuration,
draft, candidate, and single-version reads are not paginated lists.

Global `GET`/`PATCH /api/v2/settings/automation` use separate administrator
`automation-settings:read` / `automation-settings:write` scopes. PATCH requires
its settings ETag and an idempotency key; send `automationEnabled` and
`automationTraceRetentionDays`, plus optional preview/readiness settings. Omitted
optional settings preserve their previous values. This is not the service mode API.

## Browser workspace and sample-test boundaries

Desktop and mobile use the same workspace and session-authorized domain actions.
The browser endpoint `/api/services/{id}/automation` is separate from the v2
Bearer API: GET loads an authorized workspace area and page; POST forwards an
allowlisted automation action and requires a matching request Origin. Its POST
body is bounded to 256 KiB. Use the v2 endpoints for API-key integrations instead
of assuming the browser endpoint shares their authorization or response contract.

The Test panel reports semantic fixture results alongside the chosen sample's
trace. Passing the built-in fixtures verifies those fixed normalization/operator
cases, not that your service's mappings, rule coverage, live payloads, or external
notifications are correct. Inspect the sample-specific result, then verify actual
ingestion and delivery during rollout.

## Failures and operator diagnosis

Known evaluator/configuration failures produce fallback diagnostics:
`VERSION_MISSING`, `VERSION_INVALID`, `EXTRACTION_LIMIT`, `CONTEXT_FIELD_LIMIT`,
`EVALUATION_TIMEOUT`, or `POLICY_MISSING`. Live fallback preserves the base
classification priority and returns to service-default policy routing. Failed
results do not hand executable automation context to Runbooks.

Database failures abort ingestion into its transaction/replay path; they are not
silently treated as a successful default-route evaluation. Candidate evaluator
failures are tracked separately from the active decision, allowing the active
Live version to continue routing.

When behavior differs from expectations:

1. Confirm the service/integration identity and whether the event created a new
   incident or deduplicated into an existing one.
2. Check global enablement, effective mode, active version, and candidate pointer.
3. Inspect the incident's pinned version, matched rule, base/final priority,
   route, and fallback reason. Later publication does not rewrite that decision.
4. Check extraction roots, mapping order, normalization states, and rule order.
5. Check referenced policy safety, destination ownership, and destination enablement.
6. Check observation and notification workers independently. Slow diagnostic
   processing can delay evidence without changing an already committed decision.
7. For unexpected suppression, disable automation or use the global emergency
   switch, preserve the decision/version identifiers, and review before reactivation.

Operational telemetry includes `opsknight_automation_evaluations_total`,
`opsknight_automation_fallback_total`, `opsknight_automation_shadow_difference_total`,
`opsknight_automation_observation_queue_depth`,
`opsknight_automation_observation_oldest_age_seconds`, and
`opsknight_automation_shadow_rollup_lag_seconds`. Treat queue and rollup metrics
as diagnostic processing health, separate from provider delivery success. See
[metrics](./metrics) and [notification delivery](./notifications/) for the surrounding
monitoring and delivery contracts.
