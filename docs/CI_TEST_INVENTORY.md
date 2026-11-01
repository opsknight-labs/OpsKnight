# OpsKnight CI/CD & Test Certification Topology

This document establishes the machine-readable inventory and classification of OpsKnight's test and CI workflows. It defines test ownership, execution layers, performance budgets, and deduplication boundaries.

---

## 1. Test Layer Classification (L0 – Certification)

| Layer | Classification | Scope & Characteristics | Target Duration | Environment / DB |
| :--- | :--- | :--- | :--- | :--- |
| **L0** | **Static / Instant** | TypeScript check (`tsc --noEmit` - blocking), ESLint (`npm run lint:check` - visible/diagnostic pending lint debt cleanup), schema validation | < 1–2 min | None (pure static analysis) |
| **L1** | **Unit** | Pure application logic: state machines, SLA calculators, deduplication, router, utilities, UI component tests | < 2 min | Mocked DB (memory-only Prisma mock) |
| **L2** | **Integration** | Real persistence: Postgres migrations, relational integrity, advisory locks, queue semantics, webhooks | 2–5 min | Single PostgreSQL instance |
| **L3** | **End-to-End (E2E)** | User and browser flows: auth lifecycle, host proxy routing, mobile PWA, incident management | ~3–12 min per suite (main or `ci:full`) | Pre-built application + PostgreSQL + Playwright |
| **Cert** | **Certification / Resilience** | Multi-replica failover (3 web + 3 workers), k6 retry storm, chaos drills, backup/restore, cross-platform packaging | 15–35 min (Nightly / Release) | Multi-container Docker Compose / k6 |

---

## 2. CI Workflow & Job Inventory

Pull requests run a light required gate. Heavy suites run on `main` (and tags or `workflow_dispatch`), and on a pull request only when it carries the **`ci:full`** label. "PR (`ci:full`)" below means the job is skipped on unlabelled pull requests. Path filters still apply when the label is present.

```
+------------------------------------------------------------------------------------------------------------------------------------------+
| Workflow                         | Job                        | Layer | DB? | Build?  | Docker? | Trigger                               |
+------------------------------------------------------------------------------------------------------------------------------------------+
| tests.yml                        | static-validation          | L0    | No  | No      | No      | PR, push main                         |
| tests.yml                        | unit-tests                 | L1    | No  | No      | No      | PR, push main                         |
| tests.yml                        | db-integration (4 shards)  | L2    | Yes | No      | No      | PR, push main                         |
| tests.yml                        | ingestion-durability       | L2    | Yes | No      | No      | PR, push main                         |
| tests.yml                        | database-secret-scripts    | L2    | Yes | No      | No      | PR, push main                         |
| tests.yml                        | build                      | Gate  | No  | Yes     | No      | PR, push main                         |
| tests.yml                        | test (aggregate, required) | Gate  | No  | No      | No      | PR, push main                         |
| security.yml                     | Security Summary (req.)    | Sec   | No  | No      | No      | PR, push main, daily                  |
| e2e.yml                          | auth / mobile / dashboard  | L3    | Yes | Once    | No      | push main, PR (ci:full), dispatch     |
| docker-image.yml                 | build + image checks       | Cert  | Yes | Docker  | Yes     | push main, tags, PR (ci:full)         |
| docker-image.yml                 | release-quality            | Cert  | Yes | Docker  | Yes     | Tags (v*)                             |
| runbook-validation.yml           | runbook / agent suites     | L3/Cert | Yes | Yes   | Yes     | push main, tags, PR (ci:full)         |
| swarm-validation.yml             | L0, L1-L5                  | Cert  | Yes | Docker  | Yes     | push main (paths), via runbook        |
| deployment-validation.yml        | validate                   | L0/L2 | No  | No      | No      | push main (paths), via runbook        |
| mcp-certification.yml            | MCP PR validation          | L2    | Yes | Yes     | No      | push main, PR (ci:full), dispatch     |
| automation-validation.yml        | automation                 | L3    | Yes | Yes     | No      | push main, PR (ci:full, paths)        |
| enterprise-sso-certification.yml | authentication / browser   | Cert  | Yes | Yes     | No      | push main, PR (ci:full, paths)        |
| scim-certification.yml           | certify                    | Cert  | Yes | Yes     | No      | push main, PR (ci:full, paths)        |
| microsoft-teams-e2e.yml          | teams-e2e                  | L3    | Yes | Yes     | No      | push main, PR (ci:full, paths)        |
| integration-certification.yml    | failover-load              | Cert  | Yes | Docker  | Yes     | push main, weekly, tags, PR (ci:full) |
| sbom-validation.yml              | validate                   | Sec   | No  | No      | No      | push main, tags, dispatch             |
| auth-e2e.yml / mobile-pwa-e2e.yml| standalone browser suites  | L3    | Yes | Yes     | No      | workflow_dispatch (debugging)         |
+------------------------------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Shared Composite Actions (`.github/actions/`)

Standardizes setup for workflows using the shared CI actions:

1. [`.github/actions/setup-node`](../.github/actions/setup-node/action.yml)
   * Standardizes Node 20.x setup.
   * Leverages GitHub `npm` cache (`~/.npm`).
   * Executes deterministic `npm ci --legacy-peer-deps` with `HUSKY=0`.
   * Optionally executes `npx prisma generate` with cached client.

2. [`.github/actions/setup-test-db`](../.github/actions/setup-test-db/action.yml)
   * Deploys Prisma migrations sequentially via `npx prisma migrate deploy`.
   * Enforces status platform indexes (`npm run prisma:indexes:status-platform`).
   * Runs the post-migration database smoke check (`scripts/ci-db-smoke.cjs`).
   * Validates migration health and schema invariants.

3. [`.github/actions/build-app`](../.github/actions/build-app/action.yml)
   * Executes the canonical `npm run build` with deterministic E2E build-time environment.
   * Validates performance architecture budgets (`npm run perf:budgets`).
   * Packages `.next/`, `public/`, and manifests as an artifact with `include-hidden-files: true` for downstream E2E consumers.

4. [`.github/actions/restore-build`](../.github/actions/restore-build/action.yml)
   * Restores compiled application artifacts for downstream Playwright runs, completely eliminating re-compilation.

---

## 4. Execution Principles

1. **Light PRs, Full Main**: Pull requests run only L0–L2 and the build (`tests.yml`) plus the security suite, targeting about 10 minutes. Browser E2E, Docker, runbook, swarm, MCP and certification suites run on `main`, or on a PR labelled `ci:full`.
2. **Build Once for Browser E2E**: In `e2e.yml` the Next.js application is compiled once in its `build` job. Auth, Mobile/PWA and Dashboard suites download the artifact and start `next start` without recompiling. Standalone `workflow_dispatch` runs remain independently executable for debugging.
3. **Container Boundary**: Docker container build remains a separate artifact boundary with its own platform/runtime packaging concerns.
4. **Isolate Unit from Infrastructure**: Unit tests (L1) run against the Prisma mock in memory without provisioning PostgreSQL.
5. **Decouple Fast Gates from Certification**: Heavy stress, retry storms (k6), and 3-replica worker tests belong in nightly and release certification workflows, not on ordinary PR feedback paths.
6. **Required Gate Stability**: The aggregate PR check retains the exact `test` context required by the repository ruleset (with `Security Summary`).
7. **False-Green Protection**: Aggregate gate strictly validates that artifact reports exist, XML is well-formed, test counts are positive, and all prerequisite jobs succeeded.
