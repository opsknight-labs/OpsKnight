# OpsKnight CI/CD & Test Certification Topology

This document establishes the machine-readable inventory and classification of OpsKnight's test and CI workflows. It defines test ownership, execution layers, performance budgets, and deduplication boundaries.

---

## 1. Test Layer Classification (L0 – Certification)

| Layer | Classification | Scope & Characteristics | Target Duration | Environment / DB |
| :--- | :--- | :--- | :--- | :--- |
| **L0** | **Static / Instant** | ESLint (`npm run lint:check`), TypeScript (`tsc --noEmit`), architecture/contract verification, schema validation | < 1–2 min | None (pure static analysis) |
| **L1** | **Unit** | Pure application logic: state machines, SLA calculators, deduplication, router, utilities, UI component tests | < 2 min | Mocked DB (memory-only Prisma mock) |
| **L2** | **Integration** | Real persistence: Postgres migrations, relational integrity, advisory locks, queue semantics, webhooks | 2–4 min | Single PostgreSQL instance |
| **L3** | **End-to-End (E2E)** | User and browser flows: auth lifecycle, host proxy routing, mobile PWA, incident management | 3–5 min (PR smoke) | Pre-built application + PostgreSQL + Playwright |
| **Cert** | **Certification / Resilience** | Multi-replica failover (3 web + 3 workers), k6 retry storm, chaos drills, backup/restore, cross-platform packaging | 15–35 min (Nightly / Release) | Multi-container Docker Compose / k6 |

---

## 2. CI Workflow & Job Inventory

```
+------------------------------------------------------------------------------------------------------------------------------------------------+
| Workflow                      | Job                    | Layer | DB? | Build? | Docker? | Trigger                        | Canonical Purpose   |
+------------------------------------------------------------------------------------------------------------------------------------------------+
| tests.yml                     | fast-validation        | L0/L1 | No  | No     | No      | PR, push main                  | Lint, type & unit   |
| tests.yml                     | build                  | Gate  | No  | Yes    | No      | PR, push main                  | Canonical build     |
| tests.yml                     | db-integration         | L2    | Yes | No     | No      | PR, push main                  | DB integration      |
| tests.yml                     | auth-e2e               | L3    | Yes | Restored| No     | PR, push main                  | Auth browser E2E    |
| tests.yml                     | mobile-e2e             | L3    | Yes | Restored| No     | PR, push main                  | Mobile & PWA E2E    |
| tests.yml                     | test (aggregate)       | Gate  | No  | No     | No      | PR, push main                  | Required test check |
| auth-e2e.yml                  | auth-browser           | L3    | Yes | Yes    | No      | workflow_dispatch (standalone) | Manual debugging    |
| mobile-pwa-e2e.yml            | mobile-browser / pwa   | L3    | Yes | Once   | No      | workflow_dispatch (standalone) | Manual debugging    |
| microsoft-teams-e2e.yml       | teams-e2e              | L3    | Yes | Yes    | No      | PR, push main (path-filtered)  | Teams cards / sync  |
| integration-certification.yml | failover-load          | Cert  | Yes | Docker | Yes     | Push main, weekly, dispatch    | 3x3 failover + k6   |
| docker-image.yml              | build-test             | Cert  | No  | Docker | Yes     | PR, push main                  | Container packaging |
| docker-image.yml              | release-quality        | Cert  | Yes | Docker | Yes     | Tags (v*)                      | 10-gate release cert |
| deployment-validation.yml     | validate               | L0/L2 | No  | No     | No      | PR, push main                  | Helm/Kustomize/K8s  |
| security.yml                  | scan / audit           | Sec   | No  | No     | No      | PR, push main                  | SAST, SCA, secrets  |
| sbom-validation.yml           | validate               | Sec   | No  | No     | No      | PR, push main, tags             | CycloneDX compliance|
+------------------------------------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Shared Composite Actions (`.github/actions/`)

To eliminate duplicate setup across all pipelines, common actions are standardized:

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

1. **Build Once for PR Browser E2E**: All PR browser/E2E workflows consume the canonical shared build artifact. Standalone workflow_dispatch runs remain independently executable for debugging.
2. **Container Boundary**: Docker container build remains a separate artifact boundary with its own platform/runtime packaging concerns.
3. **Isolate Unit from Infrastructure**: Unit tests (L1) run against the Prisma mock in memory without provisioning PostgreSQL.
4. **Decouple Fast Gates from Certification**: Heavy stress, retry storms (k6), and 3-replica worker tests belong in nightly and release certification workflows, not on ordinary PR feedback paths.
5. **Required Gate Stability**: The aggregate PR check retains the exact `test` context required by repository branch protection rulesets.
