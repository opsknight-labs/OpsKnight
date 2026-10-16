# REST v2 domain command and review contract

API-13 establishes the review contract for the deliveries in
[the coverage plan](complete-feature-coverage-plan.md). The machine-readable
[workflow inventory](workflow-inventory.json) maps capability families to existing
implementation sources and delivery owners. It is an initial source inventory,
not evidence that every UI action has been extracted or certified.

## Shared command boundary

UI actions and REST adapters call the same server-side command. Commands must not
import Next request/session state or call a public endpoint over HTTP. Resolve the
actor at the adapter, then enforce domain authority using the canonical
`AuthorizationActor`, `authorization-policy.ts` and resource filters. UI capability
checks and API scope checks are additional boundary checks, not substitutes for
resource authorization inside the command.

A command accepts validated input, an actor, the caller's Prisma transaction, and
server-derived provenance. Use a discriminated provenance value: UI has no API
credential; API requires the authenticated credential ID. Never accept actor,
credential, audit source or tenant membership from a request body. Existing command
signatures can remain where they provide equivalent guarantees; do not refactor
unrelated code merely to adopt a uniform signature.

The adapter owns the outer transaction and durable replay record when using REST
idempotency. Commands must join that transaction rather than commit independently.
Recheck mutable ownership, revision and dependencies under the same transactional
protection as the write. Use existing serializable retry helpers or documented lock
ordering for cross-row invariants. Never retry a transaction containing a remote
provider send.

Persist authoritative state, one canonical business audit event and required
outbox/queue records together. Add credential attribution to the business event;
do not add a second REST business event. Access telemetry may be separate but must
be named and classified as access telemetry. Rollback must remove state, audit,
outbox and replay result together. Natural repeats with distinct idempotency keys
must not repeat transitions, audit or queue activity.

External work runs through durable workers after commit. Return persisted pending
state, job identity and an authorized status operation. Provider acceptance is not
delivery confirmation. If the existing domain cannot provide this contract, extract
and certify it before exposing the operation.

## Operation admission checklist

Each new operation must supply the following in its implementation PR:

1. Existing UI entry point and canonical command, or an explicit product exception.
2. Stable operation ID, exact scope, role policy, resource filter, nested-parent
   validation and sensitive-operation restrictions. Broad scopes do not implicitly
   grant agent, secret or identity-control privileges.
3. Strict body/query/parameter schemas, bounded bytes/depth, allowed fields,
   pagination/order and safe response projection. Sensitive responses are no-store.
4. A mutation-contract entry defining replay, concrete revision preconditions,
   already-completed outcomes, dependency checks, rollback and async side effects.
5. A canonical audit event and server-derived credential attribution. Specify safe
   redaction for configuration, input defaults, recipients and provider payloads.
6. Runtime-matching OpenAPI errors, headers and result schemas; generated SDKs,
   Explorer examples and capability status updated in the same PR.
7. Focused PostgreSQL evidence for races and rollback, UI/API outcome parity and
   security negatives. Unit/contract checks alone cannot satisfy these gates.

Secret issuance never stores a plaintext response in replay state. Lost-response
recovery uses safe status/list/revoke operations. Reads cannot disclose issued
secrets. Secret rotation must specify overlap, cutover, revocation and failure
recovery before implementation.

Publish, activate and shared configuration updates require concrete strong If-Match
revisions; reject wildcard revision bypasses. A validated plan or policy result
must be tied to the exact revision and dependencies used at activation. Preview
operations must state any persisted authorization evidence and cannot dispatch
production work.

## Required negative and race cases

Test missing/insufficient scopes; inactive or revoked identity; wrong role;
unrelated team; inaccessible resource; wrong nested parent; stale membership;
expired token; unexpected fields; oversized input; stale/wildcard revision;
concurrent publication/deletion; duplicate and distinct-key retries; rollback after
audit/outbox insertion; and secret absence in responses, logs and replay storage.
Select applicable cases explicitly and explain exclusions in the owning PR.

Inventory tests verify source paths and catalog coverage, not semantic security.
Existing route conformance and mutation-contract suites remain required. Do not
replace runtime negative tests with source-string assertions.

## Delivery and certification

Keep #883 as the foundation. API-14 depends on integration and certification of
`feat/service-automation`; this inventory does not merge that branch. API-23 depends
on approval of the SLO product contract. Restricted SCIM, OAuth, agent protocol and
recovery workflows remain separate even when a delivery owns their documentation.

All eight release gates start pending. Mark a gate passed only with durable evidence
containing commit, command, environment, results and limitations. Load evidence
includes hardware/data/topology, predefined latency/error budgets, 1/2/4 replicas,
PostgreSQL connection pressure, queue lag and recovery. No Redis dependency is
introduced. Local unit tests do not establish production capacity or HA.
