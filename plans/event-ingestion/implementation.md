# Enterprise event ingestion implementation

Status: implementation in progress; enterprise certification has not passed. Do not open a PR until every required certification gate has evidence. The branch is `feat/enterprise-event-ingestion`, based on `origin/main` at `58e9271cc`.

System administrators can now change unfinished-event/byte limits, completed-payload retention, per-worker concurrency and idle polling through the shared ingestion operations API and System health panel. Commands strictly validate bounds, serialize policy updates, require the displayed revision and commit the audit atomically. Pause/resume preserves policy. Admission reads shared policy within its transaction; workers adopt policy between cycles (idle polling/backoff can delay adoption), and maintenance reads current retention policy. Reducing capacity preserves accepted work and rejects new work until capacity is available. Already-running transactions can finish under their previously read policy. Concurrency changes do not resize database pools. Transport and quota bootstrap settings remain deployment configuration pending their separate distributed-policy implementation.

## Implemented boundary

Provider parsers and authentication remain in their existing routes. `processIntegrationEvent` is the shared admission boundary. `OPSKNIGHT_INGESTION_MODE=sync` preserves the synchronous API by default. `postgres` acknowledges only a committed inbox append and returns a receipt ID. An accepted receipt is not proof of a successfully materialized incident.

The ingestion module owns envelope validation, delivery identity, capacity reservations, quota leases, processing leases, retries, operator commands, status and retention. Workers call the existing incident engine. Incident mutation, Service Automation decisions, notification/runbook outbox records, receipt completion and capacity release commit in one transaction. The receipt row lock and lease token fence stale workers. There is no claim of exactly-once external notification delivery.

Admission takes a per-key transaction lock before assigning the monotonically increasing receipt sequence. Consumers claim only the oldest unfinished receipt for a service/integration/deduplication identity. Independent keys can run concurrently. An exhausted or malformed head goes to `DEAD` and blocks subsequent same-key events until authorized replay succeeds. Raw accepted work is not discarded to unblock a key.

PostgreSQL admission explicitly enables `synchronous_commit` for its transaction. Startup checks require logged inbox storage, `fsync` and `full_page_writes`. Node-loss protection still depends on the deployment's synchronous replication, storage and failover configuration; a single PostgreSQL instance does not provide replica-failure durability.

## Service Automation

Accepted envelopes retain the original provider payload and receipt time. Admission captures the active/candidate immutable Automation version references and mode. Processing evaluates those references through the existing runtime, rather than substituting rules published during queue delay. The global Automation emergency-disable switch is checked live. A configuration disabled at acceptance stays disabled for that event.

Classification, responder snapshot validation, escalation decisions, immutable SLA contracts, observation privacy, Runbook trigger evaluation and outbox generation remain in the existing engine. Mutable service/policy configuration still follows that engine's processing-time reads; the inbox does not claim to freeze every service setting.

Raw alert timestamps and the five-minute resolve-before-trigger lookback use original acceptance time. Backlog delay therefore does not make an old recovery appear newly received. Provider event time is not substituted for gateway receipt time.

## Admission and storage limits

The default unfinished capacity is 100,000 receipts and 1 GiB of serialized envelope data. Sixty-four independently updated budget rows enforce conservative per-shard caps without one global write counter. Admission starts at the preferred shard and spills into other available budget shards; a concentrated partition can consume the full bounded backlog. Shard counters retain conservative global limits without one shared write counter. DEAD receipts keep their reservations. These are logical queue bounds, not a bound on PostgreSQL WAL, indexes, retained receipts, or existing Alert history.

Asynchronous admission reserves small fixed-window quota blocks in PostgreSQL and spends them locally. Unused reservations are stranded until expiry when a replica exits or cache entries are evicted. This deliberately under-admits rather than overshooting the shared quota. Allocation uses the database clock; local validity uses a conservative monotonic deadline. This is not the proposed Redis/GCRA implementation and does not provide separate sustained/burst policies.

Completed raw inbox payloads expire after 24 hours by default, in bounded, audited maintenance batches. Pending/processing/dead-letter payloads are retained. Terminal receipt IDs, content hashes, results and delivery-idempotency identities remain for 90 days after completion by default (System settings allows 31–3,650 days). Expiration requires minimized child/shared payloads and fresh retention-hold checks under the existing hold resource lock. Empty minimized batch metadata expires afterward. A retry after identity expiry becomes a new accepted event and uses normal incident deduplication; an expired receipt can return 404. Existing Alert and audit retention policies are independent. Receipt-history partitioning, archival and measured lifecycle throughput remain required capacity work.

Envelopes are capped at 2 MiB without silent truncation. The existing HTTP request limit remains 1 MiB; the larger internal envelope limit accommodates normalized event context. Synchronous behavior retains its existing request limits. Delivery IDs identify requests, and a stable ordinal identifies each event produced by a multi-alert request. Providers without a delivery ID or explicit `Idempotency-Key` retain logical incident deduplication, but HTTP resubmission can create additional raw alert receipts.

## Operator interfaces

`GET /api/admin/ingestion` returns persistent queue counts, oldest unfinished age, budget usage, recent worker evidence and up to 100 dead-letter summaries. `receiptId` selects an individual receipt. The System Health page reuses this API and the existing Card, Badge and Button components.

`POST /api/admin/ingestion` supports strict `pause`, `resume`, and `replay` commands. Every mutation requires `admin.manage` and commits its audit entry in the same transaction. Pause stops new admission while workers drain. Replay only transitions DEAD receipts and preserves their stored envelope and sequence. A strict `archive` command permits an administrator to explicitly discard a DEAD event after supplying a reason and confirming the lifecycle risk. It clears the payload, releases its reservation, unblocks successors, preserves the tombstone, checks incident retention holds, and audits the decision in the same transaction. No arbitrary payload editing is exposed.

`GET /api/events/receipts/{id}` accepts a live API key and applies the same event capability and service/team scope policy as the Events API. It returns no raw envelope or lease credentials. Routing-key-only clients can supply `integrationId` and their integration credential. Inspection requires an enabled integration and an exact match on both receipt integration and current service ownership; rotated keys obey the existing expiry policy.

Prometheus counters separate new accepted receipts from duplicate submissions and processing outcomes. Histograms separately record durable append latency and acceptance-to-processing completion latency. Instance counters reset on restart; the receipt ledger remains authoritative for reconciliation.

## Running the candidate

Generate the Prisma client, apply migrations, then enable the mode consistently on producers and ingestion consumers. Integrated deployments run a consumer in the integrated process. The connection preflight counts `INGESTION_WORKER_REPLICAS` (including Swarm aliases), their direct database pools even when web uses PgBouncer, and an optional `DATABASE_CONNECTION_RESERVE` for deployment/failover headroom. Pass the ingestion overlay to the CLI or explicitly set the replica count; the validator cannot discover an unconfigured remote topology. Split deployments use `OPSKNIGHT_PROCESS_ROLE=ingestion-worker` with an independent `DATABASE_POOL_SIZE_INGESTION_WORKER` budget (default pool 10 unless explicitly configured; the Compose overlay sets 5 for concurrency 4).

Compose opt-in configuration:

```sh
OPSKNIGHT_IMAGE=<image-built-from-this-branch> docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.ingestion.yml config --quiet
```

The overlay extends the existing worker service rather than duplicating its credentials, networking and healthcheck configuration. It has not been deployed as an HA topology by this change.

Environment settings:

- `OPSKNIGHT_INGESTION_MODE`: `sync` (default) or `postgres`.
- `OPSKNIGHT_INGESTION_CONCURRENCY`: 1–32, default 4 per worker process.
- `OPSKNIGHT_INGESTION_POLL_MS`: 50–30,000, default 250, with jitter. Database failures use bounded exponential backoff.
- `OPSKNIGHT_INGESTION_MAX_PENDING`: 64–10,000,000, default 100,000, divided conservatively across 64 shards.
- `OPSKNIGHT_INGESTION_MAX_PENDING_BYTES`: default 1,073,741,824, divided across the same shards.
- `OPSKNIGHT_INGESTION_EVENTS_PER_MINUTE`: default 120 per Events API admission key.
- `OPSKNIGHT_INGESTION_INTEGRATION_PER_MINUTE`: default 100 per provider integration.
- `OPSKNIGHT_INGESTION_PAYLOAD_RETENTION_HOURS`: 1–720, default 24, for completed inbox payloads.

Quotas are not throughput guarantees. Configure them from measured deployment capacity. The corrected Events API key selection no longer puts every API key into the shared literal `integration:api-key:events` quota bucket.

## Rollout and rollback

Do not mix synchronous and asynchronous producers for the same routing identity while an accepted backlog exists: a synchronous lifecycle transition can overtake queued work. For rollback, pause admission, wait for in-flight admissions to finish, keep ingestion workers in `postgres` mode, reconcile and drain all receipts, then switch producers to `sync`. Resolve DEAD receipts first. Stop consumers only after the backlog is empty. Keep both additive migrations and all receipts; do not drop inbox tables to roll back application behavior.

A worker may be replaced without draining first: its uncommitted transaction rolls back and a replacement can recover the lease. Default leases last 60 seconds; recovery is safe but not a two-second latency guarantee after a crash.

## Remaining plan gates

- Phase 0: representative HTTP baseline and query/lock/WAL instrumentation; the committed library microbenchmark is only an initial diagnostic.
- Phase 1: evidence-backed transaction/query optimization and immutable configuration cache tuning beyond the existing version cache. Sustained/burst admission and service/tenant quota management remain incomplete.
- Phase 2: PostgreSQL inbox correctness is implemented and locally exercised. Live HTTP/browser/outage and rolling-upgrade certification remains incomplete.
- Phase 3: Kafka/Redpanda transport, broker acknowledgement/offset contracts, rebalance/failover testing and broker-backed database-outage acceptance are not implemented. Configuration rejects unsupported transports.
- Phase 4: weighted tenant fairness, reserved critical ingestion capacity, adaptive processing concurrency, history partitioning, archival and deployment query-plan evidence remain incomplete. Existing downstream worker lanes remain separate.
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
