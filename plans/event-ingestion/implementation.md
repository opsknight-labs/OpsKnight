# Enterprise event ingestion implementation

Status: implementation in progress; enterprise certification has not passed. Do not open a PR until every required certification gate has evidence. The branch is `feat/enterprise-event-ingestion`, reconciled with `origin/main` at `fdabcf67b`.

System administrators can now change unfinished-event/byte limits, completed-payload retention, per-worker concurrency and idle polling through the shared ingestion operations API and System health panel. Commands strictly validate bounds, serialize policy updates, require the displayed revision and commit the audit atomically. Pause/resume preserves policy. Admission reads shared policy within its transaction; workers adopt policy between cycles (idle polling/backoff can delay adoption), and maintenance reads current retention policy. Reducing capacity preserves accepted work and rejects new work until capacity is available. Already-running transactions can finish under their previously read policy. Concurrency changes do not resize database pools. Separate request refill rates and burst capacities are also live shared policy. Deployment settings supply defaults for policies that omit quotas; transport and database pools remain deployment configuration.

## Implemented boundary

Provider parsers and authentication remain in their existing routes. `processIntegrationEvent` is the shared admission boundary. With `OPSKNIGHT_INGESTION_MODE` unset, durable PostgreSQL ingestion is the default. An explicit `sync` value retains the synchronous rollback path. The default acknowledges only a committed inbox append and returns a receipt ID. An accepted receipt is not proof of a successfully materialized incident.

The ingestion module owns envelope validation, delivery identity, capacity reservations, shared token buckets, processing leases, retries, operator commands, status and retention. Workers call the existing incident engine. Incident mutation, Service Automation decisions, notification/runbook outbox records, receipt completion and capacity release commit in one transaction. The receipt row lock and lease token fence stale workers. There is no claim of exactly-once external notification delivery.

Admission takes a per-key transaction lock before assigning the monotonically increasing receipt sequence. Consumers claim only the oldest unfinished receipt for a service/integration/deduplication identity. Independent keys can run concurrently. An exhausted or malformed head goes to `DEAD` and blocks subsequent same-key events until authorized replay succeeds. Raw accepted work is not discarded to unblock a key.

PostgreSQL admission explicitly enables `synchronous_commit` for its transaction. Startup checks require logged inbox storage, `fsync` and `full_page_writes`. Node-loss protection still depends on the deployment's synchronous replication, storage and failover configuration; a single PostgreSQL instance does not provide replica-failure durability.

## Service Automation

Accepted envelopes retain the original provider payload and receipt time. Admission captures the active/candidate immutable Automation version references and mode. Processing evaluates those references through the existing runtime, rather than substituting rules published during queue delay. The global Automation emergency-disable switch is checked live. A configuration disabled at acceptance stays disabled for that event.

Classification, responder snapshot validation, escalation decisions, immutable SLA contracts, observation privacy, Runbook trigger evaluation and outbox generation remain in the existing engine. Mutable service/policy configuration still follows that engine's processing-time reads; the inbox does not claim to freeze every service setting.

Raw alert timestamps and the five-minute resolve-before-trigger lookback use original acceptance time. Backlog delay therefore does not make an old recovery appear newly received. Provider event time is not substituted for gateway receipt time.

## Admission and storage limits

The default unfinished capacity is 100,000 receipts and 1 GiB of serialized envelope data. Sixty-four independently updated budget rows enforce conservative per-shard caps without one global write counter. Admission starts at the preferred shard and spills into other available budget shards; a concentrated partition can consume the full bounded backlog. Shard counters retain conservative global limits without one shared write counter. DEAD receipts keep their reservations. These are logical queue bounds, not a bound on PostgreSQL WAL, indexes, retained receipts, or existing Alert history.

System settings reserves 10% of backlog capacity for normalized critical source alerts by default, adjustable from 0–50%. Whole budget shards are reserved, rounding upward to 1/64 increments; ordinary events cannot consume those shards, while critical events may use all available shards. Existing accepted work is preserved when the percentage changes. Multi-event claim batches reserve at least one slot each for eligible critical and ordinary heads (one quarter per lane for larger batches), then fill remaining slots by age. A single-slot consumer remains FIFO. Critical priority never bypasses an earlier unfinished same-key event. These are admission and batch-selection reservations, not a measured critical-latency guarantee or separate execution pool. Weighted service fairness remains separate work.

Asynchronous admission reads current policy and updates a PostgreSQL token bucket per authenticated key using database time. Concurrent same-key calls within a two-millisecond scheduling window share one atomic decision for at most 32 requests. Every caller waits for that result; partial grants are distributed individually and no credit or mutable policy is cached. Outstanding quota callers, including database-in-flight decisions, are bounded at 1,024 per process across route bundles. Explicit transaction clients preserve their original transaction boundary and bypass coalescing. Separate sustained refill and burst limits support live, revision-fenced reductions. Replica-local quota leases were removed to preserve those live reductions; a hot key still serializes shared database decisions; batching reduces their frequency but needs full-stack throughput evidence. After normal quota exhaustion, an independent bounded replay allowance can recover retained receipts without accepting new work. See `live-quotas.md` for charging, recovery and rolling-upgrade contracts. Redis/GCRA and service-weighted fairness are not implemented.

Completed raw inbox payloads expire after 24 hours by default, in bounded, audited maintenance batches. Pending/processing/dead-letter payloads are retained. Terminal receipt IDs, content hashes, results and delivery-idempotency identities remain for 90 days after completion by default (System settings allows 31–3,650 days). Expiration requires minimized child/shared payloads and fresh retention-hold checks under the existing hold resource lock. Empty minimized batch metadata expires afterward. A retry after identity expiry becomes a new accepted event and uses normal incident deduplication; an expired receipt can return 404. Existing Alert and audit retention policies are independent. Receipt-history partitioning, archival and measured lifecycle throughput remain required capacity work.

Envelopes are capped at 2 MiB without silent truncation. The existing HTTP request limit remains 1 MiB; the larger internal envelope limit accommodates normalized event context. Synchronous behavior retains its existing request limits. Delivery IDs identify requests, and a stable ordinal identifies each event produced by a multi-alert request. Providers without a delivery ID or explicit `Idempotency-Key` retain logical incident deduplication, but HTTP resubmission can create additional raw alert receipts.

## Operator interfaces

`GET /api/admin/ingestion` returns persistent queue counts, oldest unfinished age, budget usage, recent worker evidence and up to 100 dead-letter summaries. `receiptId` selects an individual receipt. The System Health page reuses this API and the existing Card, Badge and Button components. It refreshes every 30 seconds while visible and online, pausing while settings or recovery dialogs are open. Requests cannot overlap; policy saves force a new snapshot after any older request finishes.

`POST /api/admin/ingestion` supports strict `pause`, `resume`, and `replay` commands. Every mutation requires `admin.manage` and commits its audit entry in the same transaction. Pause stops new admission while workers drain. Replay only transitions DEAD receipts and preserves their stored envelope and sequence. A strict `archive` command permits an administrator to explicitly discard a DEAD event after supplying a reason and confirming the lifecycle risk. It clears the payload, releases its reservation, unblocks successors, preserves the tombstone, checks incident retention holds, and audits the decision in the same transaction. No arbitrary payload editing is exposed.

`GET /api/events/receipts/{id}` accepts a live API key and applies the same event capability and service/team scope policy as the Events API. It returns no raw envelope or lease credentials. Routing-key-only clients can supply `integrationId` and their integration credential. Inspection requires an enabled integration and an exact match on both receipt integration and current service ownership; rotated keys obey the existing expiry policy.

Prometheus counters separate new accepted receipts from duplicate submissions and processing outcomes. Histograms separately record durable append latency and acceptance-to-processing completion latency. Instance counters reset on restart; the receipt ledger remains authoritative for reconciliation.

## Running the candidate

Generate the Prisma client and apply migrations before serving the updated image. No ingestion-mode variable is required. Integrated deployments run a consumer in the integrated process. Web replicas automatically run a single-slot fallback consumer using their existing Prisma pool; healthy dedicated ingestion workers put that fallback on standby. Topology checks run every five seconds and dedicated evidence expires after 30 seconds. Fallback adds no pool, but uses existing pool capacity and is not a high-throughput sizing recommendation. The connection preflight counts `INGESTION_WORKER_REPLICAS` (including Swarm aliases), their direct database pools even when web uses PgBouncer, and an optional `DATABASE_CONNECTION_RESERVE` for deployment/failover headroom. Pass the ingestion overlay to the CLI or explicitly set the replica count; the validator cannot discover an unconfigured remote topology. Split deployments use `OPSKNIGHT_PROCESS_ROLE=ingestion-worker` with an independent `DATABASE_POOL_SIZE_INGESTION_WORKER` budget (default pool 10 unless explicitly configured; the Compose overlay sets 5 for concurrency 4).

Optional dedicated-capacity Compose configuration:

```sh
OPSKNIGHT_IMAGE=<image-built-from-this-branch> docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.ingestion.yml config --quiet
```

The overlay extends the existing worker service rather than duplicating its credentials, networking and healthcheck configuration. It has not been deployed as an HA topology by this change.

Environment settings:

- `OPSKNIGHT_INGESTION_MODE`: optional; unset defaults to `postgres`. Explicit `sync` is the compatibility/rollback override.
- `OPSKNIGHT_INGESTION_CONCURRENCY`: 1–32, default 4 per worker process.
- `OPSKNIGHT_INGESTION_MAX_INFLIGHT_REQUESTS`: 1–1,024, default 32 active ingestion requests per web process. Excess requests receive 503 with Retry-After before authentication/body/database work. Shared across provider routes in a process, independent of distributed request quotas.
- `OPSKNIGHT_INGESTION_POLL_MS`: 50–30,000, default 250, with jitter. Database failures use bounded exponential backoff.
- `OPSKNIGHT_INGESTION_MAX_PENDING`: 64–10,000,000, default 100,000, divided conservatively across 64 shards.
- `OPSKNIGHT_INGESTION_MAX_PENDING_BYTES`: default 1,073,741,824, divided across the same shards.
- `OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE`: default 120 per Events API admission key.
- `OPSKNIGHT_INGESTION_INTEGRATION_PER_MINUTE`: default 100 per provider integration.
- `OPSKNIGHT_INGESTION_PAYLOAD_RETENTION_HOURS`: 1–720, default 24, for completed inbox payloads.

Quotas are not throughput guarantees. Configure them from measured deployment capacity. The corrected Events API key selection no longer puts every API key into the shared literal `integration:api-key:events` quota bucket.

## Rollout and rollback

The first upgrade from a synchronous image requires a coordinated producer cutover: stop routing new ingestion to old replicas, finish their in-flight requests, then route to the migrated new replicas. An ordinary overlapping old/new rolling update is not certified or safe for lifecycle ordering. Existing migrations are additive, but changing the default does not make mixed writers safe. Do not mix synchronous and asynchronous producers for the same routing identity while an accepted backlog exists: a synchronous lifecycle transition can overtake queued work. For rollback, pause admission, wait for in-flight admissions to finish, keep ingestion workers in `postgres` mode, reconcile and drain all receipts, then switch producers to `sync`. Resolve DEAD receipts first. Stop consumers only after the backlog is empty. Keep both additive migrations and all receipts; do not drop inbox tables to roll back application behavior.

A worker may be replaced without draining first: its uncommitted transaction rolls back and a replacement can recover the lease. Default leases last 60 seconds; recovery is safe but not a two-second latency guarantee after a crash.

## Remaining plan gates

- Phase 0: representative HTTP baseline and query/lock/WAL instrumentation; the committed library microbenchmark is only an initial diagnostic.
- Phase 1: evidence-backed transaction/query optimization and immutable configuration cache tuning beyond the existing version cache. Live sustained/burst request quotas are implemented; hot-row optimization and weighted service quota management remain incomplete. There is no organization model to which tenant quotas could safely attach.
- Phase 2: PostgreSQL inbox correctness is implemented and locally exercised. Live HTTP/browser/outage and rolling-upgrade certification remains incomplete.
- Phase 3: Kafka/Redpanda transport, broker acknowledgement/offset contracts, rebalance/failover testing and broker-backed database-outage acceptance are not implemented. Configuration rejects unsupported transports.
- Phase 4: weighted service fairness, adaptive processing concurrency, history partitioning, archival and deployment query-plan evidence remain incomplete. Existing downstream worker lanes remain separate.
- Phase 5: Swarm and Kubernetes sustained 1k/5k/10k HTTP RPS, a 25k burst and drain, provider failures, replica failover, rolling upgrades, restoration and the 24-hour soak require dedicated execution and reconciliation. None is claimed as certified.

Do not interpret faster durable acceptance as sustainable incident-processing capacity. The measured local completion rate is far below the enterprise target.

## Review remediation follow-up

Ordering now uses the same canonical and legacy incident identities as processing. Cross-integration aliases are serialized, and repeated worker crashes cannot bypass the retry ceiling. Existing asynchronous consumers must be stopped/drained before this ordering-key upgrade; this is not a mixed-version async-worker protocol. The upgrade backfill skips terminal receipts, isolates malformed legacy envelopes as DEAD, and conservatively blocks later work for their service until explicit recovery.

Completed payload and terminal receipt retention respect active incident holds, including concurrent hold creation through the shared resource lock. Orphaned dead-letter disposal is explicit and audited. History partitioning, archival and cleanup capacity at enterprise rates remain unresolved release gates.

A shared credential-only filtering boundary covers provider payloads, normalized summaries/sources/custom details, Automation input, receipts, alerts and incident descriptions. It recognizes supported credential header aliases and known token/URI patterns while preserving contact context used by Automation. Arbitrary secrets embedded under unrelated names cannot be inferred reliably; deployments still require encrypted storage/backups, restricted database roles, and enforced retention. Implicit dedup identity is captured before filtering to preserve existing incident keys.

The health interface reports persisted accepted/completed throughput over a 60-second window, with a visible top-100 integration limit. The new k6 HTTP harness uses open-loop arrivals, treats 429/503 as failures, checks receipt acknowledgements and reconciles accepted receipts, alerts and incidents after draining. A failed latency or arrival target remains a failed run.

## Multi-alert webhook admission

Prometheus, Grafana and Datadog use the centralized `processIntegrationBatch` boundary. In PostgreSQL mode, all normalized children and their shared sanitized provider context commit together. A failure in any child, admission pause, exhausted capacity or database transaction rolls back the entire batch. Responses are returned only after the commit. Explicit provider/request idempotency IDs remain scoped by service, integration and stable ordinal. Providers without a delivery ID still require `Idempotency-Key` for receipt-level retry deduplication; incident deduplication remains independent.

`IngestionBatch` stores one immutable provider payload. Child envelopes reference that payload and its SHA-256 digest; Prometheus no longer repeats `allAlerts` in each stored child. Consumers validate service/integration ownership and the digest and restore the original normalized context before Automation evaluation. Corrupt shared data dead-letters affected work instead of creating incidents from incomplete context. The older full-context receipt hash is checked lazily when a retried delivery overlaps pre-upgrade receipts.

Shared context remains until every child envelope has been minimized and every linked incident passes the normal retention-hold locks and fresh hold check. A held child therefore preserves its complete shared evidence. Shared metadata expires only after its minimized children expire under receipt retention. Pending byte accounting conservatively charges each unfinished child for the referenced shared context, so physical storage reduction does not weaken the backlog bound. Very large batches remain constrained by database transaction time and deployment capacity; the new design does not certify an arbitrary batch size.

## Event clocks and delayed work

Receipt `receivedAt` records application arrival, `acceptedAt` records the committed database admission clock, `processingStartedAt` records the first claim, and `completedAt` records transactional processing completion. Older receipts have null arrival/first-processing columns rather than invented timestamps. Receipt results include `operationalActivatedAt` from the materialized incident's creation time.

Raw alerts and the retained Automation evaluation use original arrival time. Incident creation, SLA contract capture, support-hours engagement and escalation scheduling use operational activation time. This preserves existing operational/SLA semantics: a two-hour queue delay is visible as ingestion delay and does not silently become two hours of responder lateness. Ingestion delay must therefore have its own SLO and paging. Receipt inspection exposes these clocks; the incident `createdAt` field retains its existing meaning. A two-hour backlog regression checks arrival, first processing, SLA capture and activation separately.

Persistent queue metrics expose unfinished counts by PENDING/PROCESSING/DEAD status, oldest database-clock age and evidence availability. The Prometheus rules page critically for any dead letter, stale accepted work and unavailable queue evidence. Cluster snapshots use `max` across replicated scrapers, not a sum of duplicate global counts. Route these alerts through monitoring that remains available when OpsKnight ingestion is blocked. Automatic skipping remains prohibited; operators must replay or explicitly archive the failed transition.

`INGESTION_DB_PROFILE=true npm run certify:ingestion:http` optionally records read-only pg_stat_statements deltas and sampled wait states on the isolated test database. Provision the extension on that owned instance first. The helper never resets statistics and retains SQL fingerprints/allowlisted operation classes rather than SQL text, parameters or client identities. Server execution time excludes client, connection-pool and network time; cluster WAL deltas include other databases on that owned instance.

## Local image topology diagnostics

`npm run certify:ingestion:docker` targets only the owned `opsknight-ingestion-cert-db` PostgreSQL 16 fixture on localhost port 55445 and database `ingestion_test_http`. Set `INGESTION_IMAGE` to a built candidate with its OCI source revision label. The harness starts uniquely labelled gateways, ingestion workers and an immutable-ID proxy on a temporary container network, applies a conservative connection preflight, checks each consumer's local readiness, then runs the same HTTP reconciliation harness without a host-side consumer. Fixture secrets are temporary. Cleanup only removes resources whose run labels match; the existing database container remains running.

`INGESTION_DOCKER_KILL_WORKER=true` requests a real SIGKILL coordinated with active load. The run must prove that work was admitted and the kill completed; failed or unexecuted chaos cannot pass. No lease timestamp is advanced. Use a load duration longer than five seconds and allow natural lease recovery during drain. All results remain local topology diagnostics, not Swarm/Kubernetes or replicated-database certification.

Bootstrap and readiness share ingestion ownership policy. The dedicated role requires PostgreSQL mode. Consumers publish process-local successful-cycle evidence across instrumentation/route bundles; readiness fails for missing, faulted or stale consumption, and reports retention errors as degraded without stopping healthy consumption.

### Maintenance ownership

PostgreSQL ingestion retention belongs to the scheduler owner (or the integrated process), using the central one-connection maintenance client shared with Runbook cleanup. Consumers perform ingestion only. Apply the ingestion Compose overlay to the scheduler as well as web/ingestion replicas; PostgreSQL ingestion is also the scheduler default when the mode variable is absent; an explicit `sync` override disables asynchronous ingestion maintenance. Maintenance still runs when `ENABLE_INTERNAL_CRON=false`, since payload minimization is independent of external cron scheduling. Keep a scheduler owner deployed even when using external cron. Shutdown waits for ingestion maintenance before disconnecting the shared maintenance pool. Counters `opsknight_ingestion_retention_rows_total` and `opsknight_ingestion_retention_batches_total` identify cleanup class and success/failure; tick duration has its own histogram. Worker readiness no longer reports local retention failures because workers no longer own cleanup. Enterprise partitioning, archival and sustained cleanup capacity remain unverified.

### PgBouncer diagnostic variants

`INGESTION_DOCKER_PGBOUNCER=true` adds an owned, network-local PgBouncer using the production entrypoint and pinned 1.26.0 image. Only web replicas use it; ingestion workers remain direct. The harness verifies PostgreSQL client addresses against owned container IPs, rather than relying only on URL configuration. Its 15 normal plus five reserve server connections match the two direct web pools in the default diagnostic topology. `INGESTION_PGBOUNCER_COMPATIBILITY=false` explicitly selects native prepared-statement tracking; compatibility mode remains the harness default and production deployment defaults are unchanged. Prepare fixture databases before load; creating or migrating another database on the same PostgreSQL instance contaminates WAL/latency comparisons. These diagnostics do not establish PgBouncer failover or enterprise capacity.

### Local request backpressure

PostgreSQL ingestion has a centralized process-local request gate across Events API, common provider handlers, middleware providers and the independent PagerDuty route. It bounds authentication, request-body and database work together; it never queues excess requests in JavaScript. Each accepted request holds its slot until the actual handler finishes, including any durable commit. There is no handler timeout that returns failure while an append continues in the background. The gate does not apply when the explicit synchronous compatibility override is selected.

Asynchronous request bodies have a five-second total read deadline and stop on disconnect. The deadline ends before parsing/admission and does not cancel a durable transaction. A nonsettling stream cancellation callback cannot prevent the slot being released. This addresses unauthenticated partial PagerDuty bodies consuming all shared slots. The gate is a local resource bound, not service fairness, a distributed quota, a throughput increase or a promise that a network-lost response cannot follow a committed receipt. Healthy replicas must still meet the existing acceptance/latency gates. Receipts and bounded authenticated replay remain necessary for ambiguous responses.

`opsknight_ingestion_request_overload_total` counts requests refused at the local gate separately from persistent backlog-capacity and quota decisions. The Compose ingestion overlay exposes the concurrency setting; a changed value requires replica configuration/restart rather than a live shared-policy update. Tune it with pool sizes and measured latency, and retain upstream connection/body limits.

Next middleware clones/buffers bodies before route handlers in the installed framework. The five-second route-reader deadline and local gate do not cover that earlier phase. Native partial-body attempts did not reach the gate and failed their preflight; upstream connection/body limits and a network deadline require separate production-topology validation. The native gate fixture instead holds complete authenticated requests on an owned quota-row lock and checks prompt overload, release and exact receipt reconciliation.


### Continuous consumption and worker telemetry

Consumers refill each free processing slot as events finish; a slow key cannot hold an entire batch barrier. The shared delivery path retains fenced leases and atomic incident/Automation/outbox/receipt completion. Claimed work stays within the current concurrency limit; reducing the limit drains existing work before allocating more. Single-slot refills of a multi-slot consumer alternate severity preference and retain per-key predecessors. A genuine single-slot consumer keeps FIFO.

`opsknight_ingestion_active_events` reports locally owned continuous work; `opsknight_ingestion_processing_capacity` reports the current local limit and is zero while stopping or while a web fallback stands by for healthy dedicated workers. Active work can temporarily exceed a newly lowered limit until existing transactions drain. Registry storage is shared across module instances within one process, without sharing counters across replicas. Scrape every worker separately.

Library stop prevents further claims, wakes polling and waits for all owned processing. PostgreSQL connection loss retries through the existing lease/recovery path. Native Next.js process signal coordination still requires validation; library drain tests alone do not certify a Docker SIGTERM drain or database primary failover.


### Bounded durable append groups

Independent scalar requests share a PostgreSQL group commit. A process-wide queue coalesces for two milliseconds with at most 32 envelopes/four MiB per group, two active commit transactions, 256 outstanding callers and 32 MiB of retained serialized envelope content (excluding object overhead). Bounds include database-inflight groups. Excess requests fail with explicit unavailable/backpressure rather than accumulating an unbounded queue. No success is returned until the transaction commits with synchronous_commit on. A process crash before commit grants no acceptance; an interrupted response after commit remains recoverable by the original delivery ID.

Each group acquires the sorted union of canonical/legacy admission identities and service/integration-scoped delivery identities before sequence allocation. One database read detects persisted duplicates and conflicts; same-group duplicates reuse one new receipt. Content conflicts, pause and capacity decisions are per independent request, while a database transaction failure rolls back the entire group. Shared provider webhook batches retain their existing all-or-nothing transaction. Shared policy and immutable Automation version pointers are read per group without caching mutable policy.

Grouped budget allocation locks at most min(eight, remaining callers) eligible shards per scan with SKIP LOCKED, accounts exact event/byte increments under those locks, and applies one update for all assigned shards. Allocation balances each group across those shards before considering preferred distance so completion releases do not converge on one budget row. The existing ordinary/critical reserve and global bounds remain; no credit is cached across transactions. Receipts are inserted together in original group order. Completion still commits receipt fencing, incident mutation, Automation/outbox and capacity release atomically through the existing engine. Database pools are unchanged.


### Indexed claims and OLTP connection defaults

The earlier GIN predecessor implementation probed the active ordering index through a materialized matching-key lookup; it is superseded by the transactional identity frontier below. Candidate keys include the service-specific unidentified marker, retaining poison-row isolation without an OR that encourages broad scans. Claim lanes row-lock eligible heads; the final bounded update rechecks status and lease eligibility while those locks remain held. The existing GIN index writes keys directly (fastupdate off) so worker probes do not scan a growing pending list on each request. The migration flushes older pending entries in the supported maintenance window.

Default direct Prisma connection options disable PostgreSQL JIT for short OLTP statements, alongside the existing 30-second statement timeout. Explicit URL options remain authoritative. Supported transaction-pooler connections retain the existing compatible startup options: both pgbouncer=true URLs and web processes with PGBOUNCER_ENABLED=true avoid sending the unsupported jit startup parameter. Pooled server tuning remains the database/pooler operator's responsibility. No connection limit was raised.


### Shared published-policy statement snapshots

Classification, SLA and support-hours resolvers use one shared module with fixed parameterized SQL fragments. Each family selects the latest sealed version for at most three ordered scopes and aggregates only that version's rules/windows/exceptions within the same statement snapshot. Existing resolver precedence, inheritance and emergency controls remain authoritative. Support exception DATE values are explicitly hydrated to UTC Dates before calendar logic. Publication decisions are read from PostgreSQL each time; no mutable policy cache or additional pool is introduced.


### Transactional identity frontier

The claim path now reads an explicit eligible-head index rather than searching receipt history. Each unfinished identity has a compact head/tail row and an ordered membership chain. A receipt's nonnegative dependency counter records its unfinished immediate predecessors; canonical and legacy identities contribute separately. A receipt becomes eligible only when all dependencies clear. Exactly one primary identity drives each ready receipt. Critical/standard pools use lateral primary-key receipt probes, SKIP LOCKED and a bounded merge retaining the existing reserved lanes. No database connection limit was increased.

Row triggers maintain this metadata in the receipt transaction, including older-image inserts, completion/archive, replay and ordering-key repair. AFTER INSERT preserves ON CONFLICT skip semantics. Receipt ownership has a cascading foreign key; ancestor pointers deliberately do not, because checking a predecessor foreign key can block admission behind an older worker's FOR UPDATE lock. The regression test holds that actual lock while admitting a successor. Completion and archive use the existing sorted ingestion advisory-lock namespace. Old repaired sequences splice into indexed chains; removing interior nodes retains dependencies. Dead letters remain blockers until explicit disposition. Empty heads are deleted transactionally.

The additive migration backfills all unfinished receipts before the new reader starts, within the supported maintenance window. Function search paths bind to the installation schema, with pg_catalog first and pg_temp last; a custom-schema backfill and temporary-shadowing diagnostic passed. This is a row-trigger implementation, not a statement-level bulk frontier. Admission's existing durable append groups remain bounded and acknowledge only after commit.

An unidentified legacy receipt remains a service barrier through a compact head lookup. Large queues blocked behind such a barrier, delayed retries and leased heads can still require multiple candidate probes; universal constant-cost scheduling is not claimed. Service fairness, poison-load capacity and long-term partitioning remain open.

The final lateral query claimed four events in 1.603 ms with 10,000 unfinished and 100,000 completed fixture receipts. An intermediate broad join took 28.775 ms on that fixture and was rejected. These rollback-only SQL diagnostics exclude admission, HTTP, Automation, incident processing and downstream effects. They establish no end-to-end capacity.

### Common incident write grouping

New incident creation now includes its linked Alert and initial timeline entry as nested writes through the existing transaction. Existing-incident lifecycle, buffered resolve attachment, Automation, escalation and durable downstream intents retain their shared atomic transaction. This reduces application-to-Prisma operations, not necessarily SQL statement count. Actual notification delivery and Runbook execution remain in downstream workers. A rejected Alert insertion must roll back the Incident as well.

### Bounded local image builds

The existing low-memory build profile now sets Next.js build CPUs to one, limiting page-generation workers as well as compilation. Type checking remains enabled. This affects the opt-in build profile only; it does not change deployed ingestion concurrency or introduce a customer configuration requirement.


### Singleton completion fast path and controlled diagnosis

An additive migration optimizes removal when every ordering identity has only the completing receipt. The existing identity locks fence admission/repair while checking that all head/tail IDs match. Two set-based deletes remove memberships and heads, without successor counter updates because no successors exist. Mixed/shared chains keep their original rewiring path. The replacement function retains installation-schema-bound lookup through an explicit atomic migration; no receipt, incident, outbox or budget safety rule is relaxed.

completion-profile.cjs isolates full completion, receipt mutation, budget updates and explicit commit latency on the dedicated ingestion_test_completion_probe clone. It records function timing, waits and WAL, and restores its diagnostic trigger switch on exit. This harness's tiny receipt/single-operation rates are not incident throughput. Reconcile-timeout-replays checks original delivery identity hashes and production replay lookup on the two retained historical timeout fixtures without appending work. Native provider retry tests separately enforce authentication and quota/content-conflict behavior.

The proposed 600 RPS sustained target remains unmet. Both the optimized and previous-function 50 RPS full-stack trials failed, so higher loads are gated. The existing runtime image plus explicit database-function variant is recorded; a release image including the new migration and downstream/HA certification remain outstanding.

The shared database profiler also samples categorized blocking transactions and their maximum age. Labels are computed inside PostgreSQL; no SQL text, parameters or backend identities leave the query. A blocker’s last statement is context, not proof of its original lock acquisition. Sparse samples and profiling overhead are recorded as limitations.


### Admission rollback before contention backoff

Capacity helpers distinguish true exhaustion from skipped locks with remaining committed headroom. Transient contention throws an internally marked unavailable error, retaining the public 503 contract while the shared bounded transaction helper rolls back before waiting. Grouped partial reservations and batch children restart atomically. Fallback child identities are stable across retries, including unknown commit outcomes. Shared phase histograms expose admission and driver intervals without adding SQL, timers inside reservations or high-cardinality labels. Optional native snapshots export only allowlisted numeric metrics. This is phase-one source hardening; CPU preparation and identity locking still need measured analysis, and no new capacity is certified.


### Live background-job claim index

The shared job claimant now exposes its existing four live statuses as a redundant explicit bound, allowing PostgreSQL to prove applicability of an additive partial index on scheduledAt/createdAt/id with attempts below maxAttempts. Completed history no longer has to precede due work in this ordered scan. Type-specific generation, lease, lane, predecessor and SKIP LOCKED rules remain. This improves the measured SQL access path; it does not establish that the general worker can execute all resulting jobs quickly enough. Native evidence now records measured-service event-side-effect backlog separately from receipt completion.


### Single-statement fenced background completion

A shared conditional UPDATE replaces transaction-wrapped single-row updateMany on claimed ordinary/V2 jobs and war-room completion. Attempt, token (including explicit null), generation/status and timestamps are retained. Legacy completion without an attempt remains unchanged. Real-database regressions cover SQL command count, stale/replaced claims and cancellation after the worker snapshot. The alternating component diagnostic saves two driver commands per completion, without changing acknowledged durability. Native image throughput is pending.

The high-throughput redesign is tracked in high-throughput-redesign.md. Admission-only, incident-only, effects-only and full-stack capacities must remain separate; the current empty-provider handler profile is diagnostic only. The two-general-worker trial failed, and critical initial responder planning currently depends on the general queue. No new lane migration or configuration-aware omission is implemented yet.


### Terminal benchmark ledger barrier

Timed-out HTTP callers can finish durable admission after the load generator exits. The HTTP harness now pauses only its disposable ingestion_test_http fixture and waits pre-barrier database transactions before terminal reconciliation. The pause remains through container cleanup; reconnecting or queued admissions cannot reopen reporting. A separate one-connection client explicitly selects the validated fixture URL and checks current_database before policy access. Host diagnostics centrally pin web datasource selection as well. This is test infrastructure, not a customer runtime pause or delivery optimization. Original failed reports remain immutable, with supplemental post-cleanup ledger/replay evidence.
