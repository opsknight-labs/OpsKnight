---
title: Accept a Compose deployment for production
description: Verify security, ownership, database, recovery, monitoring, and end-to-end incident behavior before production traffic.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Compose production checklist, acceptance, go-live]
reader:
  status: READER_COMPLETE
  task: Complete production acceptance for an OpsKnight Compose deployment.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/
    - tests/docs/journeys/
---

# Accept a Compose deployment for production

Use this as a go/no-go gate after installation and before routing production alerts or users to OpsKnight.

## Prerequisites

Finish the selected [integrated](./integrated) or [split](./split) installation, [reverse proxy](./reverse-proxy), provider configuration, and monitoring. Identify the deployment owner and rollback decision-maker.

## Prepare the acceptance record

Record the application and database image digests, Compose file order, configuration revision, public origin, runtime topology, database class, PgBouncer use, secret backup location, test time, and operator. Do not paste secret values into the record.

## Run production acceptance

1. Confirm no image uses `latest` and every role resolves to the approved digest.
2. Confirm placeholder secrets are absent and stable secrets are backed up outside the host.
3. Confirm public TLS, forwarded headers, request limits, webhook signatures, and realtime streams.
4. Confirm exactly one runtime ownership model is active.
5. Confirm migration used a direct database path and completed successfully.
6. Confirm PostgreSQL is not publicly exposed and connection use stays inside budget.
7. Confirm persistent storage alerts and logical backup schedules.
8. Restore the latest backup into an isolated database and complete post-restore checks.
9. Confirm readiness plus every role's heartbeat, queue, and error signals.
10. Trigger an alert into a test service.
11. Verify incident creation, routing, notification delivery, acknowledgement, assignment/escalation where configured, resolution, and status projection.
12. Restart one non-database application role and confirm recovery without duplicate ownership or lost work.
13. Review dashboards and alerts with the on-call operator.
14. Record pass/fail evidence and an explicit go/no-go decision.

## Verify acceptance

Acceptance passes only when every applicable step has objective evidence and no unresolved critical failure. A container showing `healthy` is insufficient without the end-to-end incident and recovery checks.

Keep failed items open with an owner and block production traffic when they affect security, data recovery, migration correctness, notification delivery, or incident processing.

## Operate it in production

Schedule recurring restore drills, secret/certificate rotation, dependency patching, capacity review, provider delivery tests, and upgrade rehearsal. Re-run affected acceptance steps after topology, database, proxy, identity, notification, or major release changes.

## Troubleshooting failed acceptance

Preserve logs and state, classify the failed layer, and use [Compose troubleshooting](./troubleshooting). Do not weaken TLS, disable signature checks, bypass migration, expose PostgreSQL, or delete persistent volumes to make a check pass.

After correction, rerun the failed check and all downstream checks that depended on it.

## Change or undo the release decision

If acceptance fails after traffic was enabled, stop new alert/user traffic where safe, preserve incident data, invoke the documented [rollback](../../upgrades/rollback) or recovery plan, and communicate the service impact. Record why the original gate did not catch the failure.

## Next steps

- [Operate health and metrics](../../reliability/health-and-metrics)
- [Back up and restore](../../data/backup-and-restore)
- [Upgrade Compose](./upgrade)

