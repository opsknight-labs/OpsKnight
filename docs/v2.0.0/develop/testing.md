---
title: Testing
description: Validate OpsKnight changes and documentation evidence.
type: developer
product_area: engineering
audience: [developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [package.json, tests/]
---

# Testing

Run the smallest relevant suite while iterating, then the full quality gates for
the affected surface. Unit and integration tests use Vitest or Node's test
runner; browser workflows use Playwright. Database tests must use an isolated
database and deterministic fixtures.

Documentation changes run `npm run docs:lint`; runtime evidence additionally
runs `npm run docs:journeys` against the intended image. Application changes
also require type checking, linting, and relevant product tests. Do not update a
snapshot or evidence image until the underlying behavior has been inspected.

The documentation test layer supplements the existing unit, integration, and
Playwright suites. A documentation journey is evidence for a documented user
workflow; it is not a substitute for product correctness tests.
