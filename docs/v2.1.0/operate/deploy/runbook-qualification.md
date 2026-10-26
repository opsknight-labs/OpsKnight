---
title: Runbook enterprise qualification
description: Repeatable correctness, physical target, failure, load, distribution and operator qualification gates.
type: how-to
product_area: runbooks
audience: [administrator, operator, developer]
verification:
  level: source
  verified_at: 2026-10-16
  evidence:
    [
      tests/integration/runbook-enterprise-readiness-database.test.ts,
      tests/integration/runbook-physical-targets.test.ts,
      tests/integration/runbook-authenticated-http-capacity.test.ts,
      .github/workflows/runbook-validation.yml,
    ]
---

# Runbook enterprise qualification

Keep Runbooks **Beta** until the deployment's release gates have measured receipts.
A passing source check, browser journey, candidate container or direct-library
benchmark each proves a limited property. Record the server and Agent revisions,
image digests, topology, policy, test interval, raw results and limitations for each
receipt. The audit coverage tracker is
`plans/runbook-engine/enterprise-readiness.json` in the repository.

## Prerequisites

- Complete isolated staging environment with PostgreSQL 15+ database.
- Physical Docker or Kind cluster for outbound agent verification.
- Valid API keys and agent enrollment tokens for test agents.

## Correctness and authorization

1. Provision an isolated disposable database for safety and concurrency testing.
2. Execute the database integration suite to verify leases, timeouts, and state machines.
3. Validate adversarial input sanitization and secret masking across execution logs.
   regressions cover overlapping advancement/reconciliation, a running write at its
   execution deadline, results produced before/after the deadline, expired leases,
   normalized artifact upload retries and counts across more than twenty rules.
   Authorization regressions deny service-authorized responders every rule mutation
   and separately test service authority. Adversarial output tests include unrelated
   container environment credentials, structured secret payloads, quoted values,
   connection strings, private keys, malformed gzip, invalid UTF-8 and decompression
   bombs. Download tests exercise capability and incident boundaries.

The existing Runbook CI also covers immutable versions, suggestions, duplicate
events, exact-plan preview/approval, cancellation, grants, signing rotation,
pool changes, outbox/recovery and browser journeys. Only **Incident created** is
currently supported as an automatic event. Other enum values are compatibility
identifiers and cannot be configured through the supported trigger schema.

## Physical Docker and Kind checks

The `Disposable Docker and Kind physical actions` job creates uniquely named
fixtures. It executes Docker stop/start/restart through the Agent executor,
projects inspect output, and independently reads actual container state. It creates
an isolated Kind cluster and namespace, scales a real Deployment to two/one
replicas, restarts it and independently waits for converged ready replicas.
Only fixtures created by the test are removed. The job uploads
`runbook-physical-target-evidence` with before/after observations.

To run locally, Docker, Kind and kubectl must be healthy. From the repository:

```bash
RUNBOOK_PHYSICAL_TARGETS=true \
RUNBOOK_PHYSICAL_EVIDENCE=plans/runbook-engine/evidence/physical-targets-current.json \
npx vitest run --no-file-parallelism --maxWorkers=1 \
  tests/integration/runbook-physical-targets.test.ts
```

This test creates real disposable infrastructure and performs writes. Do not point
it at production targets. It changes only its temporary `KUBECONFIG` and restores
it afterward. Test success proves direct executor actions on Docker/Kind; signed
control-plane authorization and approval are tested separately. Native Systemd,
Podman, multi-node storage movement and release upgrade/rollback need additional
receipts on their intended hosts.

## Authenticated HTTP idle-fleet measurement

The `Authenticated HTTP idle-fleet capacity` job enrolls independent fixture
identities in a dedicated PostgreSQL database. It uses real Ed25519 signatures,
HTTP requests, nonce persistence and 25-second long polling at 10, 100, 500 and
1,000 simultaneous Agents, with two rounds per size. It records HTTP p50/p95/p99,
coalesced availability query count, shared incident-read p95, connections,
CPU/memory and stored artifact bytes. Its uploaded artifact is
`runbook-authenticated-http-evidence`.

For local measurement, provision/migrate a dedicated `rbe_enterprise_test` or
`rbe_http_test` database, set `DATABASE_URL`, `DIRECT_URL` and the test encryption
key, then run:

```bash
RUNBOOK_HTTP_CAPACITY=true npx vitest run -c vitest.int.config.ts \
  --no-file-parallelism --maxWorkers=1 \
  tests/integration/runbook-authenticated-http-capacity.test.ts
```

Set `RUNBOOK_HTTP_ROUNDS` to 2–30 for longer repeated idle measurements; CI uses
two rounds per size. This still does not create an active-action workload.

The fixture exercises the real route over loopback HTTP; it does not run the full
Next/TLS/proxy deployment. Client and handler share a process. Idle long-poll
latency includes the intended wait and is not action dispatch latency. Two rounds
are a regression measurement, not sustained production capacity. Production
qualification still needs authenticated active work, trigger bursts, 100-Agent
concurrent policy changes, fairness, database query/buffer measurements, recovery
lag and notification/escalation workloads throughout an agreed sustained interval.

## Fault, availability and distribution receipts

For every supported topology, terminate an Agent before claim, after claim, after
start, during a write and after physical completion before result upload. Record
lease expiry, durable spool/start markers, target observations and duplicate-write
counts. Repeat for worker/control-plane loss, database primary failover, network
partition, full/unwritable disk, corrupt spool, revocation and lost persistent
identity. Existing automated spool/lease/recovery tests support these checks;
physical multi-node failure qualification remains a separate gate.

Use independent Agent identities and persistent volumes for redundancy. A
LOCAL_HOSTS write target cannot silently move to another machine. Shared-target
pools require independently authorized access to the same target. Kubernetes
RBAC and Unix/container access remain independent of local Agent policy.

Install published x64/arm64 release assets from their final URLs and digests, then
verify compatibility, upgrade, rollback and signing-key rotation while preserving
identity and spool. Candidate builds and mocked distributions are insufficient.
Do not publish a release merely to satisfy a test; use the approved release process.

## Data protection and operator review

Assess logs, artifacts, database/backups and the local spool as sensitive. Review
retention, encryption at rest, download capability and access audit. Avoid a direct
Docker socket where a narrowly scoped authorization proxy can be used; socket
access can grant host control even when mounted read-only. Grant Kubernetes writes
only for exact namespaces/resources/actions needed by the approved workflow;
Secret and ConfigMap diagnostic capture is rejected by the Agent. Keep the default
non-root/read-only deployment and grant privileges only for an explicitly reviewed
executor.

A human responder should verify rule overview, configuration versus Agent-policy
checks, frozen preview, exact-plan approval, target verification and UNKNOWN
investigation. Include keyboard-only, screen-reader, mobile and error-recovery
journeys. Automated browser success does not substitute for this human review.
Record receipt owners and unresolved failures before deciding release readiness.

### Historical artifact cleanup

Downloads sanitize legacy output, but old database payloads remain until rewritten
or expired. After reviewing backup retention and applicable evidence requirements,
run one bounded batch with the authorized database credentials:

```bash
npx ts-node --project tsconfig.script.json scripts/sanitize-runbook-artifacts.ts \
  --apply --limit=25
```

Continue with `--after=<nextCursor>` from the prior batch. The script rewrites at
most 100 artifacts per invocation, preserves IDs, updates compressed size/checksum
and uses an optimistic checksum fence. Each rewrite records an audit event in the
same transaction. It logs counts and a cursor, never output
payloads. Invalid/oversized legacy records are counted as rejected and produce
exit status 2; inspect them through an authorized data-protection process. A
rewrite cannot remove copies from old backups or prior downloads. Do not run the
rewrite while preserving original hashes for an active evidence investigation.

## Execution results, logs and recovery evidence

The Agent bounds decoded output to a shared 10 MiB contract, including truncation markers.
It bounds again after sanitization and reserves compression overhead before uploading gzip.
Result requests accept up to 1 MiB to account for JSON escaping of valid previews and typed evidence.
The server validates gzip and UTF-8 and retains at most 1 MiB of sanitized text including the
truncation marker. Logs remain potentially sensitive; sanitization cannot identify arbitrary
application credentials that have no recognizable structure.

Artifact upload failure does not suppress an execution result. The Agent persists a bounded
`Artifact unavailable` preview and submits the original status, exit code and physical evidence.
If result submission also fails, the durable spool retains the outcome for retry.
A metadata write failure leaves the original spooled outcome intact and does not stop its submission. Transient
artifact uploads may be retried with that result; permanently rejected artifacts are omitted.
An artifact error does not by itself mean that the target action failed.

Terminal state transitions enqueue a separate `FINALIZE_VERIFICATION` background job in the
same state transaction. Verification runs after commit and cannot roll back a timeout,
cancellation or failed execution. Each successful terminal transition increments `verificationRevision` and creates
`runbook-verification:<executionId>:<revision>`. Late-result recovery clears the prior proof;
a later terminal outcome schedules a fresh revision without modifying a previous worker’s
processing or completed job. Workers skip obsolete revisions and lock the parent execution
while persisting evidence, serializing with late-result recovery. Repeated processing computes
the same evidence from the same terminal snapshot. Existing unversioned jobs remain readable
during upgrades. Command success and verified recovery remain separate conclusions.

Malformed historical definitions and missing versions fail the verification job with
`RUNBOOK_VERIFICATION_DEFINITION_INVALID` or `RUNBOOK_VERIFICATION_VERSION_MISSING`.
Normal background-job retries and failed-job reporting apply; inspect those jobs when evidence
is missing. Do not retry a physical write merely to repair missing verification metadata.
Previews, error messages and signed structured evidence are sanitized at the persistence boundary;
execution details also sanitize historical evidence before sending it to the browser.
