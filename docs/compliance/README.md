# Compliance foundation

This catalogue describes repository capabilities and known gaps. It is not a certification, a legal opinion, an exhaustive framework assessment, or evidence that a particular deployment has enabled a control. Readiness counts apply only to the selected catalogue; they are never compliance percentages.

## Sources of truth

- [Control catalogue](../../src/lib/compliance/controls.ts): stable IDs, implementation, status, owner, evidence and gaps.
- [Framework definitions](../../src/lib/compliance/frameworks.ts): primary sources and scope.
- [Evidence index](../../src/lib/compliance/evidence.ts): derived directly from the catalogue.
- [Security capability manifest](../../security-capabilities.json): testable, deliberately bounded public claims.
- [Shared responsibility](shared-responsibility.md): maintainer, operator and organizational ownership.
- [Processing inventory](data-processing-inventory.yaml): current and target personal-data handling.

Implemented means the narrowly described repository capability exists. Partial means material technical or operational gaps remain. Missing means the described capability is not established. Ownership is separate: maintainers implement software, operators configure and run it, and organizations determine applicable obligations and maintain governance evidence.

## Review and maintenance

Review mappings when their evidence changes and before releases. Record commit SHA, reviewer, date, deployment scope, operating artifacts and exceptions in a restricted evidence store. A file path proves that code or documentation exists, not that a control operated successfully. Do not store customer data, credentials or private vulnerability reports in this directory.

Framework mappings are engineering topic mappings, not exhaustive article-by-article or licensed standard reproductions. Organizations must maintain their own applicability assessment, processing records, risk register and statement of applicability.

## Phase one boundary

No schema changes, destructive privacy operations, authentication changes, incident lifecycle changes, paging changes or retention changes. Discovery is limited to counts of explicitly linked records. Future phases cover export, erasure, legal holds, stronger release gates and operating-evidence automation.
