# Runbook Engine — Release Qualification (PR #893)

**Scope:** Operator-dispatched Runbooks, human approval gates, encrypted scoped secrets, and pre-dispatch shared-target Agent failover.  
**Release decision:** Suitable for a limited operator-dispatched release following green CI on the final commit and normal human review. This is **not** a claim of fully certified unattended remediation or in-flight multi-node HA.

## Changes retained

- Runtime fixes for incident-ingestion trigger queuing, Systemd inactive-status handling, claim/lease behavior, and integration request security.
- UI authoring and Systemd expected-state validation changes.
- Regression tests for the affected runtime/security paths.
- Docker-socket Agent Compose configuration for shared-target operation.

## Qualification evidence

- Physical operator-dispatched recoveries exercised Docker, Kubernetes, Systemd, Podman, and Swarm-related workloads; the historical `AUTO-005` failure is classified as a pre-fix diagnostic, not a successful execution.
- Shared-target pre-dispatch failover demonstrated with HA-001 through HA-003, including a surviving Agent claiming a queued operation and restoring Docker health.
- Direct Docker, Compose, Helm, Systemd, Podman, and Swarm Agent journeys were exercised; Kustomize received manifest/server dry-run validation, **not** a live pod installation.
- UI creation, publish, approval evidence, and scoped-secret creation were inspected on staging.
- The prior reviewed candidate (`9a5139bb139640b27ced5d03c5f8074093c51ae0`) passed all eight GitHub Actions workflows. The final cleanup commit must pass its own checks.

## Boundaries and follow-up qualification

- Unattended alert → background worker → real Agent action → monitoring recovery → automatic incident resolution remains outside this release claim; test-driver dispatch and a manual Docker action are insufficient evidence.
- HA-004 through HA-012 exercised important database/reconciler behaviors, but actual Agent process/node failures during physical writes remain outside this release claim.
- Do not advertise complete zero-touch AIOps or physically certified in-flight HA for this release.

## Evidence retention and PR hygiene

The complete original certification reports, JSON results, and captured screenshots are preserved in Git history at [the pre-cleanup evidence commit](https://github.com/opsknight-labs/OpsKnight/tree/dcf0e2cb828bd88516d93bdd2b4b0c11d0d292bd/plans/runbook-engine/enterprise-physical-certification). They are intentionally **not** part of this production PR's final diff. Store future execution receipts, screenshots, and raw evidence as CI/run artifacts rather than committing test output to the repository.
