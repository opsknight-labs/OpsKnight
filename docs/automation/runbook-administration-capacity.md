# Runbook administration capacity evidence

These are local reference measurements, not production throughput or HA certification. The harnesses require explicit opt-in to the owned local `api_completion_test` database on port 55442 and remove only their own fixtures. Do not run them concurrently with database tests, which reset that database.

## Fleet writes

Changing one Agent's scheduling labels executes a constant number of SQL statements, but the number of changed memberships and pool revisions grows with the number of matching pools. Revision writes are required to invalidate stale configuration ETags. They must not be removed to improve benchmark numbers.

The reference fixture covers 100, 1,000 and 5,000 Agents with 100 or 1,000 pools. Each label edit moves an Agent between two selectors, each matching half the pools. Eight simultaneous writers use the actual command-owned Serializable transaction, unchanged timeout and retry budget. The harness checks that every identity's memberships match its committed labels, including after failed transactions.

The eight-writer workload exhausts the retry budget for some requests. Therefore eight simultaneous fleet mutations are outside the demonstrated conflict-free capacity envelope. Raw PostgreSQL serialization/deadlock failures return retryable HTTP 409 responses. Clients should serialize bulk fleet configuration updates, preserve revision checks, and use bounded exponential backoff with jitter for conflicts. Do not retry authorization or stale-revision failures as though they were transient contention.

Full samples, write amplification, cluster-wide WAL deltas and concurrent outcomes are in [the fleet benchmark evidence](../../plans/rest-api-enterprise/runbook-fleet-concurrent-benchmark.json). WAL includes co-resident activity. Advisory-lock statement duration includes waiting and execution; it is not isolated lock-wait attribution. This evidence does not establish a production fleet mutation SLA.

### Membership parent lock order

Concurrent membership inserts previously acquired shared parent-pool locks in the active-assignment guard, then attempted to upgrade those locks when the revision trigger updated the pool. Two inserts could retain each other's shared lock and deadlock. Migration `20261019164000_runbook_membership_parent_lock_order` adds an earlier database trigger which locks affected parent rows with `FOR NO KEY UPDATE`, in ID order. This runs for direct SQL and older application writers as well as shared commands. Retirement checks and revision updates remain enabled; the change does not weaken the authority fence or eliminate configuration revisions. Apply this migration before exercising concurrent membership administration.

The unchanged policy-check scenarios still create 1, 10, 50 and 100 Agents concurrently. Additional tests cover 50 direct nested writes, opposite membership moves and parent revision increments. A separate test deliberately pre-acquires competing shared locks to recreate the old cycle and verify classification of the actual Prisma failure. That deliberate error-shape test is not evidence that normal membership inserts still follow the old locking order.

Prisma 5.22 returns some nested-write deadlocks as `PrismaClientUnknownRequestError` without structured SQLSTATE metadata. The compatibility adapter accepts only that error class and the engine frame's machine-readable SQLSTATE header. It does not classify by words such as “deadlock” inside a server message. Structured metadata takes precedence for known Prisma errors. Unknown frame formats retain the generic error response, and driver diagnostics remain private. Driver upgrades must rerun both the actual-error integration test and the negative classification tests.

## Secret reference lookup

The API and scale harness share the same parameterized SQL builder. Matching remains an exact top-level input reference, or a `SECRET_REF` default; the endpoint does not report proof of runtime secret consumption. Results expose reference metadata, never decrypted values.

The fixture contains 100,000 executions, 1,000 service rules and 1,000 input defaults. It measures common and rare references on first and deep cursor pages, retains `EXPLAIN (ANALYZE, BUFFERS)` output, and runs 16 concurrent requests with the same two-second SQL statement budget as the API. The recorded final reference run completed all 16 requests. Four individual query plans took approximately 5–32 ms; the slowest concurrent request took approximately 213 ms. These warm/local observations are not p95/p99 production guarantees.

See [the secret lookup evidence](../../plans/rest-api-enterprise/runbook-secret-usage-scale-benchmark.json) for plans, buffer counts and raw samples. An actual PostgreSQL statement-timeout integration test verifies the public retryable HTTP 503 response and `Retry-After` header. The timeout is not extended to accommodate large datasets.

## Pool retirement

Retirement is terminal and blocks new assignments, claims and pre-execution authorization. Paused service rules explain that an active target must be selected before re-enabling them.

The reconciler checks both the attempt's direct pool and its execution's `targetSelection.sourcePoolId`. This includes individually selected Agents whose direct target pool is null. It fails pending attempts against retired pools with `TARGET_POOL_RETIRED`, then schedules execution advancement atomically. Claimed work retains its live lease; after expiry, work which never passed the execution fence fails without creating another attempt. Already-running work follows existing result, cancellation and lease-expiry rules. An expired running attempt retains an unknown outcome and cannot retry into the retired pool, even if its action would otherwise be safe to retry. Repeated reconciliation does not duplicate the terminal transition or its advancement job.

These transitions have PostgreSQL regression coverage. A physical Agent journey through retirement, command fencing, result delivery and restart remains a separate deployment certification gate.
