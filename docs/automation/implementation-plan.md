Yes. Based on the current OpsKnight code at `ec1d8a1c`, this is the execution plan I would use. It is designed specifically around the existing incident transaction, dedup lock, classification engine, escalation engine, durable `BackgroundJob` outbox, RBAC model, split workers, and service UI—not as a separate workflow product bolted onto OpsKnight.

## Target architecture

The rule is:

> **One centralized automation engine, service-scoped configuration, PostgreSQL as source of truth, no Redis/new queue, immutable published versions, existing OpsKnight escalation/outbox used for all real delivery.**

Runtime:

```text
Webhook / Events API
        │
        ▼
Authentication / signature / payload validation
        │
        ▼
Provider transformer
        │
        ├── normalized OpsKnight event
        └── validated provider payload
                 │
                 ▼
        IntegrationEventEnvelope
                 │
                 ▼
Existing Classification Engine
 severity → base priority + urgency
                 │
                 ▼
Central Automation Engine
  Context Extraction
        │
        ▼
  Context Normalization
        │
        ▼
  ENRICH rules
        │
        ├── priority
        ├── tags
        └── context
                 │
                 ▼
Existing SLA + Support Hours
using FINAL priority
                 │
                 ▼
ROUTE rules
                 │
        ┌────────┼─────────────┐
        ▼        ▼             ▼
 Default     Policy X     No escalation
        │        │             │
        └────────┼─────────────┘
                 ▼
Incident +
IncidentAutomationDecision +
AutomationTrace +
Outbox
       SAME DB transaction
                 │
                 ▼
Existing OpsKnight workers
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
Escalation/Paging       Slack/Teams/etc
```

The most important architectural requirement is that automation **selects routing** but does not replace the escalation engine.

---

# Phase 0 — Architectural spike and ADR

Do this before schema or UI work.

Study and freeze how automation intersects with:

- `src/lib/events.ts`
- `src/lib/incidents/creation.ts`
- `src/lib/incidents/classification.ts`
- `src/lib/incidents/response-policy.ts`
- `src/lib/escalation/repository.ts`
- `src/lib/escalation/index.ts`
- `src/lib/event-outbox.ts`
- `src/lib/event-side-effects.ts`
- `src/lib/jobs/queue.ts`
- `src/lib/integrations/handler.ts`
- `src/lib/integrations/request-security.ts`
- `prisma/schema.prisma`
- current service UI/RBAC.

The ADR must freeze these decisions:

1. PostgreSQL remains the coordination/state system.
2. No Redis or additional message broker.
3. Existing `BackgroundJob` remains the outbox.
4. Existing advisory-lock-based event dedup stays authoritative.
5. Automation evaluation is deterministic and pure.
6. Published versions are immutable.
7. Every incident pins its automation routing decision.
8. Failures fall back to existing service behavior.
9. Shadow mode never changes production behavior.
10. Runtime integration is behind a global feature flag.
11. Every service begins `DISABLED`.
12. No automatic rerouting of existing incidents in v1.

### Phase-0 spike

Prototype the real event transaction.

Today `processEvent()` already does:

```text
transaction
  service lookup
  advisory lock(service + dedup)
  existing incident lookup
  classification
  incident creation
  escalation initialization
  outbox creation
commit
```

Prove automation can safely fit inside that transaction without causing an unacceptable transaction duration.

Measure:

```text
baseline transaction
baseline + context extraction
baseline + 25 rules
baseline + 50 rules
baseline + 100 rules
```

The evaluator itself must contain **zero DB queries**.

All DB-dependent information must be loaded before calling the pure evaluator.

### Phase-0 exit gate

Commit a written ADR stating exactly:

```text
Evaluation runs: inside/outside incident transaction
Automation version pinning: method
Concurrent webhook retry handling: method
Selected escalation policy persistence: method
NO_ESCALATION behavior: method
Fallback behavior: method
```

No Phase 1 migration until this ADR is merged into the branch.

---

# Phase 1 — Freeze the automation language

Create:

```text
src/lib/automation/
  contract.ts
  semantics.ts
```

The engine uses three field states:

```ts
MISSING

UNMAPPED(rawValue)

RECOGNIZED(value)
```

Conditions return:

```ts
TRUE
FALSE
UNKNOWN
```

A rule matches only when the result is:

```text
TRUE
```

## Operator semantics

Freeze this permanently:

| State | `=` / `IN` | `!=` / `NOT IN` | `is set` | `is missing` | `is unmapped` |
|---|---:|---:|---:|---:|---:|
| Recognized equal | TRUE | FALSE | TRUE | FALSE | FALSE |
| Recognized different | FALSE | TRUE | TRUE | FALSE | FALSE |
| Unmapped | FALSE | UNKNOWN | TRUE | FALSE | TRUE |
| Missing | FALSE | UNKNOWN | FALSE | TRUE | FALSE |

Future rule:

```text
NOT(UNKNOWN) = UNKNOWN
```

This prevents:

```text
environment = "stg-2"
```

from accidentally satisfying:

```text
environment != production
```

when `stg-2` has never been mapped.

## Falsy values

Must explicitly test:

```text
number 0       → RECOGNIZED(0)
boolean false  → RECOGNIZED(false)
string ""      → MISSING
null           → MISSING
undefined      → MISSING
```

Never use JavaScript truthiness to determine field state.

## String normalization

Order must be:

```text
trim
→ optional lowercase
→ alias lookup
→ canonical value validation
```

Aliases are normalized when published.

Reject:

```text
Prod → production
PROD → prod
```

if both normalize to the same alias key but resolve differently.

## Number support

For v1 support:

```text
=
!=
IN
NOT IN
<
<=
>
>=
is set
is missing
is unmapped
```

Invalid numeric coercion becomes:

```text
UNMAPPED
```

Never:

```text
0
```

## Priority

OpsKnight currently supports:

```text
P1
P2
P3
P4
P5
null
```

Therefore priority is **not always set**.

`SET_PRIORITY` can only assign P1–P5.

Do not invent P0 or clamp invalid values.

---

# Phase 2 — Golden fixture system

Before writing the evaluator, create a portable fixture format:

```text
tests/fixtures/automation/
```

Example:

```json
{
  "name": "unmapped value must not satisfy negation",
  "context": {
    "environment": {
      "state": "UNMAPPED",
      "raw": "stg-2"
    }
  },
  "condition": {
    "fieldKey": "environment",
    "operator": "NOT_IN",
    "value": ["production"]
  },
  "expected": "UNKNOWN"
}
```

These fixtures must be consumed by:

```text
evaluator tests
lint tests
automation test API
UI sample tester
```

They become the semantic source of truth.

Initial fixture families:

```text
missing values
unmapped values
recognized values
negative operators
0
false
blank strings
alias normalization
alias collisions
number coercion
numeric operators
case sensitivity
multiple AND terms
post-enrichment routing
last-writer-wins
tag union
no-route fallback
NO_ESCALATION
selected escalation policy
timeout fallback
```

---

# Phase 3 — Centralized database model

Do not overload existing `EscalationRuleCondition`.

Automation has very different semantics.

Create dedicated tables.

## `ServiceAutomationConfig`

```ts
ServiceAutomationConfig {
  serviceId          PK/FK Service

  mode:
    DISABLED
    SHADOW
    LIVE

  activeVersionId?
  draftId?

  updatedBy?
  updatedAt
}
```

Default:

```text
DISABLED
```

No migration backfill required beyond optional config creation.

---

## `AutomationDraft`

Mutable.

```ts
AutomationDraft {
  id
  serviceId UNIQUE

  schemaVersion
  snapshot JSON

  revision
  updatedBy
  updatedAt
}
```

Use optimistic locking:

```text
expectedRevision
```

to avoid two browser tabs overwriting one another.

---

## `AutomationVersion`

Immutable.

```ts
AutomationVersion {
  id
  serviceId

  versionNumber

  schemaVersion
  snapshot JSON
  compiledSnapshot JSON
  checksum

  sourceVersionId?
  publishedBy
  publishedAt

  lintReport JSON
}
```

Constraint:

```text
UNIQUE(serviceId, versionNumber)
```

Published versions may never be updated.

Use DB-level immutability protection similar to the current classification-policy implementation.

---

# Phase 4 — Durable incident automation decision

This is essential for OpsKnight.

Create:

## `IncidentAutomationDecision`

```ts
IncidentAutomationDecision {
  incidentId UNIQUE
  serviceId

  versionId?
  mode

  routeType:
    SERVICE_DEFAULT
    ESCALATION_POLICY
    NO_ESCALATION

  escalationPolicyId?
  escalationPolicyNameSnapshot?

  matchedRouteRuleId?
  matchedRouteRuleName?

  basePriority?
  finalPriority?

  evaluationAt
  fallbackReason?

  summary JSON
  createdAt
}
```

This must be retained as long as the incident.

Why?

Because today escalation reads:

```text
incident.service.policy
```

If automation selects Policy B but Service default is Policy A, future escalation steps must continue using B.

The incident decision becomes authoritative.

---

# Phase 5 — Policy-reference protection

Create:

## `AutomationVersionPolicyRef`

```ts
AutomationVersionPolicyRef {
  versionId
  escalationPolicyId

  PRIMARY KEY(versionId, escalationPolicyId)
}
```

At publish time, extract every referenced escalation policy into this table.

Then deletion logic can detect:

```text
Policy is referenced by active automation version.
```

Prefer blocking deletion while referenced by the current active version.

Historical versions can retain the policy ID and name snapshot even after deactivation.

Runtime still handles:

```text
POLICY_MISSING
```

as a defensive fallback.

---

# Phase 6 — Context schema

Create centralized context definitions.

## `AutomationContextField`

Could live entirely inside version snapshots, but draft UX also needs persistence.

Each field:

```ts
{
  fieldId
  key
  label

  type:
    STRING
    ENUM
    NUMBER
    BOOLEAN

  caseSensitive

  allowedValues?
  aliases?

  mappings[]
}
```

Example:

```text
Environment
```

```json
{
  "key": "environment",
  "type": "ENUM",
  "allowedValues": [
    "production",
    "staging",
    "development"
  ],
  "aliases": {
    "prod": "production",
    "prd": "production",
    "stg": "staging"
  }
}
```

---

# Phase 7 — Provider envelope

This is required because the current provider transformers throw away some useful information.

For example CloudWatch currently receives:

```text
AWSAccountId
```

but does not preserve it completely in the normalized event.

Introduce:

```ts
IntegrationEventEnvelope {
  serviceId
  integrationId
  integrationType

  event: EventPayload

  providerPayload: unknown

  receivedAt
}
```

Only **already validated** provider payload enters this envelope.

Do not pass raw unauthenticated bytes directly into automation.

Flow becomes:

```text
request
→ authentication
→ signature verification
→ schema validation
→ provider transform
→ IntegrationEventEnvelope
→ centralized processing
```

---

# Phase 8 — Gradually migrate integrations

Do not rewrite all integrations at once.

Add:

```ts
processIntegrationEvent(envelope)
```

Keep:

```ts
processEvent(...)
```

as compatibility while migrating.

Convert representative providers first:

```text
Events API
CloudWatch
Datadog
Prometheus
Grafana
```

Then the rest.

For every provider conversion add a parity test:

```text
automation feature flag OFF

old path
vs
new envelope path

must produce same:
incident
classification
dedup behavior
outbox work
escalation state
```

---

# Phase 9 — Central extraction engine

Create:

```text
src/lib/automation/context/extract.ts
src/lib/automation/context/normalize.ts
src/lib/automation/context/types.ts
```

Extraction accepts:

```ts
{
  providerPayload,
  normalizedEvent,
  mappings
}
```

and returns bounded context.

Do **not** flatten the whole webhook.

Compile field paths during publish.

Runtime operation should effectively be:

```ts
for (const mapping of compiledMappings) {
   value = readCompiledPath(payload, mapping.pathTokens)
}
```

rather than repeatedly parsing:

```text
$.foo.bar[0].baz
```

---

# Phase 10 — Extraction safety limits

Even though OpsKnight already limits integration bodies to ~1 MiB, automation should have smaller independent limits.

Start approximately with:

```text
maximum context fields: 64
maximum path depth: 12
maximum string field: 2 KB
maximum enum raw value: 256 bytes
maximum aliases/field: 200
maximum rules: 100
maximum conditions/rule: 20
maximum actions/rule: 8
```

These should be constants/config, not magic numbers scattered through UI and backend.

Limit violation:

```text
fallback to service default routing
trace fallback reason
metric increment
```

Example:

```text
CONTEXT_FIELD_LIMIT
EXTRACTION_LIMIT
EVALUATION_TIMEOUT
VERSION_INVALID
```

---

# Phase 11 — Pure automation evaluator

Create:

```text
src/lib/automation/evaluator/operators.ts
src/lib/automation/evaluator/conditions.ts
src/lib/automation/evaluator/enrich.ts
src/lib/automation/evaluator/route.ts
src/lib/automation/evaluator/index.ts
```

The top-level function should look conceptually like:

```ts
evaluateAutomation({
  version,
  initialContext,
  evaluationAt
})
```

It receives no Prisma object.

It performs no DB/network IO.

It returns:

```ts
{
  inputContext,
  enrichedContext,

  writes,

  enrichmentRuleResults,

  routingRuleResults,

  outcome,

  warnings,

  duration
}
```

This makes the evaluator:

```text
fast
replayable
unit-testable
property-testable
HA-safe
```

---

# Phase 12 — ENRICH evaluation

Allowed ENRICH actions in v1:

```text
SET_PRIORITY
SET_CONTEXT
ADD_TAG
```

Nothing else.

Rules execute in explicit order.

Example:

```text
Rule 1:
IF customer_tier = enterprise
SET priority = P1

Rule 2:
IF priority = P1
ADD tag = critical-customer
```

Rule 2 must see the value written by Rule 1.

It is a single forward pass.

No cycles.

No repeated evaluation.

No fixed-point engine.

Conflict semantics:

```text
priority/context:
last writer wins

tags:
union
```

Trace every write.

---

# Phase 13 — ROUTE evaluation

Route runs only after enrichment completes.

Allowed routing actions:

```text
USE_SERVICE_DEFAULT
USE_ESCALATION_POLICY(policyId)
NO_ESCALATION
```

Each routing rule must have **exactly one** of those.

Optional supplemental actions:

```text
NOTIFY_CHANNEL
```

but supplemental notification does not replace responder routing.

Example:

```text
IF
  environment = production
  AND priority IN [P1, P2]

THEN
  use "Production Primary"
  notify Slack #production-incidents
```

Routing strategy:

```text
first TRUE rule wins
```

No rule TRUE:

```text
SERVICE_DEFAULT
```

---

# Phase 14 — Fix responder routing centrally

Add something similar to:

```text
src/lib/escalation/routing.ts
```

with one function:

```ts
resolveIncidentResponderRouting(...)
```

It returns:

```ts
{
  type:
    DEFAULT_POLICY
    SELECTED_POLICY
    NO_ESCALATION
    DEFAULT_FANOUT

  policy?
}
```

Refactor all escalation code that directly assumes:

```ts
incident.service.policy
```

to use this resolver.

At minimum audit/change:

```text
initializeEscalationExecution()
executeEscalation()
recovery/reconciliation
resume escalation
reopen
scanner/fallback paths
manual escalation paths where relevant
```

This is the most important code-level integration.

---

# Phase 15 — Correct `NO_ESCALATION`

Do not model this as “policy missing.”

Today:

```text
no policy owns routing
→ fallback user notifications
```

That would make automation dangerous.

Define explicit outcome:

```text
RESPONDER_ROUTE_NONE
```

When selected:

```text
no escalation job
no default user fanout
no email page
no push page
no voice page
no SMS page
no WhatsApp page
```

But still permit:

```text
service notifications
status page
war room if configured
Jira
supplemental Slack/Teams automation action
```

This needs dedicated tests.

---

# Phase 16 — Compose classification correctly

Current code already has a strong classification system.

Do not replace it.

Use:

```text
resolveIncidentClassification()
```

first.

This gives:

```text
base priority
urgency
classification provenance
```

Feed those values into context:

```text
priority
urgency
severity
integration
source
...
```

Automation ENRICH may modify:

```text
priority
```

Then calculate:

```text
SLA
support hours
engagement
```

using final values.

Correct order:

```text
classification
↓
automation enrichment
↓
FINAL priority
↓
SLA
↓
route
↓
incident creation
```

Not:

```text
SLA
↓
automation changes priority
```

otherwise SLA would be inconsistent.

---

# Phase 17 — Event transaction integration

For a brand-new trigger:

```text
BEGIN

load service

acquire existing service+dedup advisory lock

dedup lookup

create Alert

if new incident:
    load automation config/version

    base classification

    extract context

    normalize context

    evaluate ENRICH

    determine final priority

    calculate SLA/support hours

    evaluate ROUTE

    create Incident

    create IncidentAutomationDecision

    create initial AutomationTrace

    link Alert

    initialize selected escalation route

    create existing OpsKnight outbox jobs

COMMIT
```

No Slack API.

No Teams API.

No email.

No external queue.

No network calls inside this transaction.

---

# Phase 18 — Concurrency and retries

The existing advisory lock gives OpsKnight a major advantage.

Keep:

```text
serviceId + dedupKey
```

as the serialization boundary.

Do not add a second automation dedup key.

Under 50 simultaneous retries:

Expected:

```text
1 active incident
1 initial AutomationDecision
1 initial AutomationTrace
1 selected routing policy
1 escalation generation
1 logical initial outbox set
```

All later callers observe/reuse the winning incident.

Also preserve `InboundDelivery` fencing for providers that supply delivery IDs.

---

# Phase 19 — Existing incidents / retriggers

Do not reroute by default.

For existing incident:

```text
same dedup key
→ append alert
→ current OpsKnight dedup behavior
→ optional UPDATE automation evaluation
```

The initial `IncidentAutomationDecision` stays pinned.

In v1:

```text
routing never silently changes
```

If new data would imply:

```text
P3 → P1
```

record:

```text
Automation update suggests priority P1.
Initial incident routing remains unchanged.
```

Add a timeline entry/banner when materially different.

Later v2:

```text
Re-evaluate routing when priority increases
```

can be an explicit per-service option.

Do not sneak that into v1.

---

# Phase 20 — Shadow Mode

This needs a strict guarantee.

In SHADOW:

```text
context extraction        YES
normalization             YES
ENRICH simulation         YES
ROUTE simulation          YES
trace                     YES
shadow metrics            YES
field observations        YES
```

But:

```text
change incident priority  NO
add actual tags           NO
change escalation         NO
Slack automation action   NO
Teams automation action   NO
reroute responder         NO
```

Existing OpsKnight behavior runs normally.

The trace stores:

```text
actual outcome
would-have outcome
difference
```

---

# Phase 21 — Shadow aggregation

Do not query thousands of detailed JSON traces every time the UI opens.

Create daily/hourly bounded aggregates such as:

```ts
AutomationShadowAggregate {
  serviceId
  versionId
  bucketDate

  evaluated
  same
  routeDifferent
  priorityDifferent
  noEscalationDifferent
  errors
  fallbacks
}
```

Update idempotently only after the unique initial trace exists.

Admin UI can instantly show:

```text
1,842 evaluated

1,804 same
38 different

21 different policy
9 different priority
6 would not page
2 evaluator fallback
```

---

# Phase 22 — Unmapped field observations

Create something like:

```ts
AutomationContextObservation {
  serviceId
  integrationId
  fieldKey

  normalizedRawValueHash
  rawValuePreview

  count
  firstSeenAt
  lastSeenAt
}
```

Do not store unbounded arbitrary payloads.

UI:

```text
Environment
────────────
production       1,294
staging            421
stg-2               19 ⚠ unmapped
prd                  7 ⚠ unmapped
```

Action:

```text
Map "stg-2"
```

→ opens:

```text
Production
Staging
Development
New canonical value
```

This makes normalization drift manageable.

---

# Phase 23 — Automatic field discovery

Discovery should happen outside critical ingest work wherever possible.

For real events:

```text
bounded observation
→ async general worker
→ discovery statistics
```

For pasted samples:

```text
analyze immediately
```

Suggested fields ranked by:

```text
known provider semantics
scalar suitability
frequency
value diversity
previous mappings
```

Example CloudWatch:

```text
AWS Account ID
Region
Alarm Name
Namespace
Metric
State
```

Datadog:

```text
Host
Tags
Monitor ID
Alert type
Source type
```

Prometheus:

```text
alertname
cluster
environment
namespace
service
team
severity
```

---

# Phase 24 — Publishing/compiler

Create:

```text
src/lib/automation/compiler.ts
src/lib/automation/versioning.ts
```

Publishing:

```text
authorization
↓
service advisory lock
↓
expected-version check
↓
schema validation
↓
semantic validation
↓
lint
↓
compile extraction paths
↓
normalize aliases
↓
resolve policy references
↓
build optimized rule structures
↓
checksum
↓
create immutable AutomationVersion
↓
create PolicyRef rows
↓
atomically set activeVersionId
↓
audit
```

Runtime should use:

```text
compiledSnapshot
```

not the editor document.

---

# Phase 25 — Version cache

Published versions are immutable.

That means we can safely cache by:

```text
versionId
```

per process.

Simple bounded LRU:

```text
versionId → compiled automation
```

No Redis invalidation.

Why?

A publish creates:

```text
new version ID
```

so a request pinned to version 8 can keep version 8.

A new request reads:

```text
activeVersionId = version 9
```

and naturally misses/loads the new cache entry.

This is both fast and HA-safe.

---

# Phase 26 — Lint engine

Create:

```text
src/lib/automation/lint.ts
```

Use the same condition structures/functions as the evaluator.

Blocking errors:

```text
invalid field
invalid operator
invalid action for phase
route rule with zero route actions
route rule with multiple route actions
missing escalation policy
alias collision
invalid priority
invalid enum target
duplicate rule IDs
invalid extraction path
definite catch-all → NO_ESCALATION
```

Warnings:

```text
possible shadowed rule
catch-all before specific rule
conflicting SET_PRIORITY writes
unused context field
field never observed
unmapped values currently present
too many rules
complex rule set
selected policy has no steps
```

Do not implement “AI-style guessy lint.”

Blocking rules must be deterministic.

---

# Phase 27 — Catch-all detection

Do not attempt full theorem proving.

Define guaranteed catch-all as:

```text
zero conditions
```

or safely known always-true cases such as:

```text
priority is set
```

only where the field contract guarantees it.

Anything more complicated becomes:

```text
warning
```

rather than blocking.

---

# Phase 28 — Fault behavior matrix

Freeze this in code and docs.

| Failure | Runtime behavior |
|---|---|
| Feature globally off | Existing OpsKnight behavior |
| Service DISABLED | Existing behavior |
| No active version | Existing behavior |
| Version missing | Service default |
| Version corrupt | Service default |
| Extraction error | Service default |
| Evaluator timeout | Service default |
| Rule error | Service default |
| No routing match | Service default |
| Referenced policy missing | Service default |
| Supplemental Slack failure | responder routing unaffected |
| Supplemental Teams failure | responder routing unaffected |
| `NO_ESCALATION` | intentionally no responder page |
| Worker crash | existing durable retry |
| Web replica crash before commit | entire transaction rolls back |
| Web replica crash after commit | outbox remains durable |
| Two workers race | existing lease/generation fences |
| Publish while event evaluates | event stays on pinned version |

---

# Phase 29 — Global kill switch

Add environment control:

```text
OPSKNIGHT_AUTOMATION_ENABLED=false
```

Evaluation order:

```text
environment flag OFF
    ↓
skip everything

environment ON
    ↓
check service mode
```

Optional UI-level emergency disable can exist in `SystemSettings`, but environment OFF must always have highest priority.

This gives deployment operators a true emergency stop.

---

# Phase 30 — RBAC

Do not invent parallel authorization.

Add capabilities to OpsKnight's existing capability framework:

```text
automation.read
automation.edit
automation.publish
```

Suggested v1:

```text
Admin
  read
  edit
  publish
  live mode
  rollback

Responder with service ownership
  read
  edit draft
  test
  view shadow results

Auditor
  read
  history
  trace

Viewer
  maybe none/read depending current service policy
```

For maximum v1 safety:

```text
publish = ADMIN only
```

Publishing a workflow that can prevent paging is materially different from editing a service description.

---

# Phase 31 — Audit

Reuse current audit system.

Audit events:

```text
automation.draft.updated
automation.version.published
automation.mode.changed
automation.rollback.published
automation.context.mapping.updated
automation.shadow.enabled
automation.live.enabled
```

Store:

```text
service
actor
from version
to version
from mode
to mode
lint state
timestamp
```

Do not put full webhook payloads in audit.

---

# Phase 32 — Service UI architecture

Today `ServiceDetailTabs.tsx` has:

```text
Incidents
Escalation Policy
Runbooks
Integrations & Webhooks
Notifications
Service Settings
```

Add:

```text
Automation
```

I would position it:

```text
Incidents
Automation
Escalation Policy
Runbooks
Integrations
Notifications
Settings
```

because Automation becomes the control plane that selects escalation behavior.

Do not force 7 equal narrow grid columns.

Change the tab layout to a responsive auto/scroll navigation.

Desktop:

```text
natural-width tab pills
```

Tablet/mobile:

```text
horizontal scrolling
```

No tiny crushed labels.

---

# Phase 33 — Lazy-load automation UI

The current service page already loads considerable data.

Do not add:

```text
rules
versions
traces
shadow stats
context observations
```

to `src/app/(app)/services/[id]/page.tsx`.

Instead Automation tab should load a lightweight shell.

Then fetch individual areas only when needed.

This prevents Automation from slowing the normal Incidents page.

---

# Phase 34 — Automation workspace information architecture

Inside the Automation tab:

```text
Overview
Context
Rules
Test
Activity
```

## Overview

Top status strip:

```text
Automation
Shadow mode

Version 4
Healthy
Last published 2h ago
```

Cards:

```text
Automation status
Shadow impact
Context health
Recent errors
```

Primary actions:

```text
Edit automation
Test
Publish
Go live
```

Never have 15 competing buttons.

---

# Phase 35 — Context UX

This must be one of the strongest parts.

Page:

```text
Context

These fields can be used by automation rules.
```

Cards:

```text
Environment
Provider mapping: payload.labels.environment

Recognized
production
staging
development

Aliases
prod → production
prd → production
stg → staging

Unmapped
stg-2 · 19 alerts
```

Actions:

```text
Edit mapping
Manage values
View recent examples
```

Avoid exposing raw JSONPath in the default UI.

Advanced mode can expose source paths later.

---

# Phase 36 — Field creation UX

Wizard:

### Step 1

```text
Choose source
```

Options:

```text
CloudWatch
Datadog
Prometheus
Events API
...
```

### Step 2

```text
Choose observed field
```

Searchable:

```text
AWS Account ID
Region
Alarm name
Metric namespace
```

### Step 3

```text
How should OpsKnight treat it?
```

```text
Text
Choice
Number
True/False
```

### Step 4

If enum:

```text
Map observed values
```

This is vastly safer than asking operators to type field paths manually.

---

# Phase 37 — Template onboarding

When Automation is empty:

```text
What would you like to automate?
```

Cards:

```text
Route production alerts

Route by environment

Route by AWS account / customer

Route by alert priority

VIP/customer routing

Start from scratch
```

Example:

> Route production alerts

creates a normal editable draft:

```text
Context field: environment

Rule:
IF environment = production
→ service default escalation

Fallback:
→ no escalation / alternate policy
```

Templates disappear after generation.

There is only one runtime engine.

---

# Phase 38 — Rules UI

Do not make it look like code.

Two clear sections.

## Enrichment

```text
1. Production criticality
When
  Environment is Production
  Severity is Critical

Set
  Priority → P1
```

## Routing

```text
1. Production P1
When
  Environment is Production
  Priority is P1

Route to
  Primary Production On-call

Also
  Notify #production-incidents
```

Card footer:

```text
“Production P1 incidents page Primary Production On-call
and notify #production-incidents.”
```

That plain-English sentence is extremely useful.

---

# Phase 39 — Rule ordering

Routing uses:

```text
first match wins
```

UI must make order unmistakable.

Display:

```text
1
2
3
Fallback
```

Allow:

```text
drag
Move up
Move down
```

Keyboard accessible.

If user moves:

```text
Any alert → Policy A
```

above:

```text
Production P1 → Policy B
```

show immediately:

> Rule 2 may never run because Rule 1 matches all alerts.

---

# Phase 40 — Draft persistence and UI resilience

Autosave the draft with debounce.

Example:

```text
500–1000 ms after edits
```

But use optimistic revision checking.

UI states:

```text
Saved
Saving…
Offline
Save failed — retry
Conflict detected
```

Do not let a network failure silently lose 30 rules.

On revision conflict:

```text
Another version of this draft was saved.

Reload their changes
Review conflict
Keep my copy as a new draft
```

Never blindly overwrite.

---

# Phase 41 — Test UI

This is a production-quality feature, not a toy preview.

Options:

```text
Use recent alert
Paste sample event
Build sample manually
```

Results display the pipeline:

```text
1. Provider input
2. Extracted context
3. Canonical context
4. Base classification
5. Enrichment
6. Final priority
7. Routing
8. Supplemental actions
```

Example:

```text
Provider
environment = "prd"

Normalization
"prd" → production

Classification
severity critical → P2

Rule “Production Critical”
matched

Enrichment
priority P2 → P1

Route “Production P1”
matched

Would route to
Production Primary

Would also notify
#production-incidents
```

This backend must call the exact real evaluator.

---

# Phase 42 — Why Was I Paged?

Add a compact card on incident detail.

Example:

```text
Automation

Production P1 routing
Version 4

Environment
prd → Production

Priority
P2 → P1

Responder route
Production Primary

Why?
Environment = Production
Priority = P1
```

Button:

```text
View evaluation
```

No need to expose the entire trace by default.

---

# Phase 43 — Shadow dashboard

Overview:

```text
Shadow results · Last 7 days

1,842 evaluated

97.9% same
2.1% different
```

Breakdown:

```text
Different responder route  21
Different priority          9
Would skip escalation       6
Fallback/errors             2
```

Click:

```text
Would skip escalation
```

and show affected incidents/events.

Side-by-side:

```text
CURRENT                 AUTOMATION

Priority P2             Priority P1
Default Policy          Primary Production
Paged Team A            Would page Team B
```

This is what builds operator trust.

---

# Phase 44 — Activity/version history

Activity page:

```text
Version 7 · Active
Published by Alice
2 Oct 2026 · 15:40

Version 6
Published by Bob

Version 5
Rollback from v3
```

Actions:

```text
View
Compare
Restore as new version
```

Never:

```text
activate old DB row directly
```

Rollback produces:

```text
version 8
sourceVersionId = version 5
```

which keeps history linear.

---

# Phase 45 — Trace schema and retention

Detailed `AutomationTrace` stores:

```text
incident ID
version ID
mode
phase
evaluation timestamp

input context
normalization provenance
matched enrich rules
writes
matched route
outcome
fallback reason
warnings
duration
```

Do not store full payload.

Retention:

```text
detailed traces: 90 days default
incident decision summary: incident lifetime
aggregates: much longer
```

Retention cleanup runs on existing maintenance/general worker infrastructure.

Never critical worker.

---

# Phase 46 — Supplemental Slack/Teams actions

Do not invoke Slack directly in the evaluator.

Evaluator returns:

```ts
supplementalActions: [
  {
    ruleId,
    provider: "SLACK",
    destinationId
  }
]
```

Persist corresponding durable jobs.

Idempotency logical key:

```text
AUTOMATION_NOTIFY:
incidentId:
versionId:
ruleId:
provider:
destinationId
```

Retry cannot double-post.

---

# Phase 47 — Performance design

Automation must not materially compromise ingest.

Rules:

### No runtime DB per condition

Bad:

```text
condition
→ DB lookup
condition
→ DB lookup
```

Good:

```text
load version once
load referenced runtime state once
evaluate entirely in memory
```

### No runtime path parsing

Compile paths on publish.

### No runtime lint

Lint only on draft/test/publish.

### No payload flattening

Extract configured fields only.

### No provider API calls

Never.

### No synchronous discovery analytics

Push observations out of critical path.

---

# Phase 48 — Performance budgets

Start with engineering gates such as:

```text
Pure evaluator

p50 < 1 ms
p95 < 3 ms
p99 < 8 ms
```

for ordinary policies.

Hard budget:

```text
~10–15 ms evaluator ceiling
```

before fallback.

But the real release gate is end-to-end.

Compare:

```text
AUTOMATION OFF
SHADOW
LIVE
```

using the same OpsKnight load certification.

Merge should be blocked if automation causes material regression such as:

```text
critical job-age increase
significant RPS reduction
significant p95/p99 ingestion increase
DB connection growth
transaction contention growth
duplicate paging
lost alerts
```

---

# Phase 49 — Metrics

Use existing OpsKnight operational metrics.

Examples:

```text
opsknight_automation_evaluations_total
opsknight_automation_fallback_total
opsknight_automation_shadow_difference_total
opsknight_automation_unmapped_total

opsknight_automation_evaluation_duration_ms
opsknight_automation_extraction_duration_ms
```

Labels should remain low-cardinality:

```text
mode
outcome
fallback_reason
field_type
```

Do not label by:

```text
serviceId
ruleId
accountId
environment value
customer name
```

---

# Phase 50 — Structured logging

Important events:

```text
automation.evaluation.completed
automation.evaluation.fallback
automation.version.published
automation.mode.changed
automation.context.unmapped
automation.route.selected
```

Include IDs in structured logs where appropriate, but use the existing logger's redaction protections.

Never log full webhook body.

---

# Phase 51 — HA certification

Test at least:

```text
2 web replicas
2 critical workers
2 general workers
```

Scenarios:

```text
publish while alerts are arriving
web replica dies before commit
web replica dies after commit
critical worker dies after claim
worker lease expires
two workers race same escalation step
activeVersion changes mid-evaluation
database serialization retry
```

Expected:

```text
no lost incident
no half-applied automation
no duplicate responder page
no route switching mid-incident
```

---

# Phase 52 — Differential Shadow certification

This is a hard merge gate.

Run identical event stream against:

```text
A. automation OFF
B. automation SHADOW
```

Then compare all operational state.

Must be identical:

```text
Incident fields
SLA
escalation state
BackgroundJob responder work
notifications
service notifications
webhooks
status-page work
war-room work
Jira work
```

Allowed differences:

```text
AutomationTrace
AutomationShadowAggregate
Context observations
automation metrics
```

Nothing else.

---

# Phase 53 — Escalation route pinning tests

Very important code-specific certification.

Set:

```text
Service default = Policy A
```

Automation routes to:

```text
Policy B
```

Incident opens.

Then change service default to:

```text
Policy C
```

Test:

```text
initial step → B
delayed second step → B
worker retry → B
worker restart → B
recovery scanner → B
resume after snooze → B
```

The incident must never silently jump to A or C.

---

# Phase 54 — NO_ESCALATION certification

Create:

```text
Rule:
environment != production
→ NO_ESCALATION
→ notify #non-production
```

Test recognized staging.

Expected:

```text
Incident created        YES
Service notification    according to normal settings
Automation Slack        YES
Responder email         NO
Responder push          NO
Voice                    NO
SMS                      NO
WhatsApp                 NO
Escalation job           NO
Default fallback paging  NO
```

Then test:

```text
environment missing
```

Expected:

```text
rule UNKNOWN
→ service default
```

Then:

```text
environment = stg-2 unmapped
```

Expected:

```text
rule UNKNOWN
→ service default
```

That proves the fail-safe behavior.

---

# Phase 55 — Determinism/property tests

Add:

### Replay

```text
same version
same context
same evaluationAt
```

must produce identical evaluation result.

### Property test

For randomized valid rule sets:

> Evaluator can only return a routing action that exists in the version or SERVICE_DEFAULT.

Never arbitrary output.

### Shadow purity

For random events:

```text
SHADOW operational side effects
==
DISABLED operational side effects
```

---

# Phase 56 — Load certification

Extend the existing OpsKnight load suite instead of inventing a tiny one.

Profiles:

```text
baseline disabled
shadow small rules
live small rules
live medium rules
live worst-supported policy
```

Topologies:

```text
Compose integrated
Compose split
Kubernetes/supported HA topology where feasible
```

Track:

```text
event RPS
incident creation p50/p95/p99
DB CPU
DB connections
transaction retries
advisory-lock contention
critical worker queue age
general worker queue age
notification latency
evaluator latency
memory
trace write volume
```

Automation cannot starve the critical lane.

---

# Phase 57 — Security hardening

Treat automation configuration as security-sensitive.

Validate:

```text
all field keys
all paths
all enum values
all IDs
all action payloads
all destination IDs
all provider types
all version IDs
```

Never permit arbitrary executable expressions.

No:

```text
eval()
Function()
user-supplied JS
dynamic SQL
```

No regex in v1.

Future regex must have bounded/safe execution.

Never allow:

```text
Authorization
Cookie
integration keys
signature secret
OAuth secrets
```

as context fields.

---

# Phase 58 — Migration/rolling deployment

Migration must be additive only.

Do not alter/remove:

```text
Service.escalationPolicyId
existing Incident routing behavior
existing Alert payload
existing BackgroundJob semantics
```

Old replicas during rolling deployment:

```text
create incident without AutomationDecision
```

New replicas interpret absence as:

```text
SERVICE_DEFAULT
```

That gives mixed-version compatibility.

---

# Phase 59 — Branch strategy

Since you prefer a single branch, do one branch but make every commit independently green.

Suggested sequence:

```text
01 ADR + architecture tests

02 automation semantic specification

03 golden fixtures

04 additive Prisma schema

05 provider envelope

06 extraction + normalization

07 evaluator operators

08 ENRICH evaluator

09 ROUTE evaluator

10 compiler + lint

11 immutable versioning

12 incident automation decision

13 centralized escalation routing resolver

14 refactor escalation engine

15 processEvent integration

16 shadow mode

17 supplemental durable notifications

18 APIs + RBAC + audit

19 context discovery/observations

20 Automation service tab

21 Context UI

22 Rules UI

23 testing UI

24 shadow dashboard

25 incident explanation

26 activity/version UI

27 metrics/retention

28 HA/concurrency tests

29 load certification

30 final docs/certification
```

Merge/rebase main frequently, especially after changes to:

```text
events.ts
creation.ts
escalation/*
event-outbox.ts
jobs/*
Prisma schema
```

---

# Phase 60 — Deployment rollout

Even after merge:

```text
OPSKNIGHT_AUTOMATION_ENABLED=false
```

Deploy.

Run normal OpsKnight smoke tests.

Then:

```text
global flag ON
all services DISABLED
```

Verify nothing changes.

Choose one non-critical service:

```text
DISABLED → SHADOW
```

Run for enough real/sample events.

Review:

```text
differences
unmapped fields
fallbacks
performance
```

Publish clean rules.

Move:

```text
SHADOW → LIVE
```

Monitor:

```text
evaluation errors
fallback
critical queue age
routing differences
notification latency
```

Then expand service by service.

Never enable all services globally at once.

---

# V1 scope I would freeze

Ship:

```text
service-scoped automation
central engine
context extraction
context aliases/normalization
automatic field discovery
string/enum/number/boolean conditions
three-valued logic
ENRICH
priority changes
tags
context values
routing
service-default route
specific escalation-policy route
NO_ESCALATION
supplemental Slack/Teams
immutable versions
drafts
lint
test mode
shadow mode
activity/history
incident explanation
RBAC
audit
metrics
HA/failure handling
```

Do **not** put these into v1:

```text
suppression
maintenance windows
regex
nested OR/NOT UI
global organization-wide routing
automatic rerouting of active incidents
arbitrary scripts
dynamic HTTP actions
loops
full workflow diagrams
time-based conditions
historical backtest
```

Backtesting can follow because the context/trace/version architecture will already support it.

---

## Definition of done

I would not call this feature production-ready until all of these are true:

```text
Feature flag OFF = current OpsKnight behavior.

SHADOW = operationally identical to OFF.

Concurrent duplicate alert = one incident/one route.

Unmapped value cannot satisfy negative conditions.

Routing evaluates post-enrichment context.

SLA uses final priority.

Selected escalation policy remains pinned for entire incident.

NO_ESCALATION cannot accidentally activate fallback user paging.

Automation evaluator performs zero DB/network IO.

External actions use durable outbox.

Publish creates immutable versions.

Rollback creates a new version.

Every LIVE transition is linted and audited.

Missing/corrupt automation falls safely to service default.

Web/worker replica failure does not lose routing or paging.

Automation maintenance jobs cannot block critical workers.

Existing load certification remains healthy.

UI supports mobile/desktop and does not slow normal Service page usage.

Every incident can explain why it was routed.

Global emergency disable is tested.

Rolling deployment with old/new replicas is tested.
```

This is the plan I would implement for OpsKnight. It gives you a **centralized enterprise automation system without turning automation itself into a new single point of failure**, and—most importantly—it preserves the reliability work already present in OpsKnight instead of rebuilding it in parallel.