# Compliance foundation

This catalogue describes repository capabilities and runtime deployment posture. It is not a certification, a legal opinion, an exhaustive framework assessment, or a guarantee that an organization is fully compliant. Readiness counts apply only to the selected catalogue; they are never compliance percentages.

## Sources of truth

- [Control catalogue](../../src/lib/compliance/controls.ts): stable IDs, baseline status, assessmentMode, evaluator IDs, owner, evidence, and gaps.
- [Framework definitions](../../src/lib/compliance/frameworks.ts): primary sources and scope.
- [Evaluators registry](../../src/lib/compliance/evaluators/): modular, read-only evaluators inspecting live system state.
- [Evaluation engine](../../src/lib/compliance/evaluation/): batching, monotonic state projection, and audit logging.
- [Evidence index](../../src/lib/compliance/evidence.ts): derived directly from the catalogue.
- [Security capability manifest](../../security-capabilities.json): testable, deliberately bounded public claims.
- [Shared responsibility](shared-responsibility.md): maintainer, operator and organizational ownership.
- [Processing inventory](data-processing-inventory.yaml): current and target personal-data handling.

---

## Runtime control evaluation architecture (Phase 4)

OpsKnight separates **static repository baseline claims** from **dynamic runtime deployment posture**.

```text
Static Control Definition (controls.ts)
           +
Live Evaluator (src/lib/compliance/evaluators/*)
           ↓
Runtime Inspection Context (Prisma, Configuration, Registry Fingerprints)
           ↓
Immutable History (ComplianceEvaluation table)
           ↓
Monotonic State Projection (ComplianceControlState table)
           ↓
Security & Compliance UI / Compliance APIs
```

### Runtime statuses

1. **`IMPLEMENTED`**: The control has been evaluated against live state and meets all active operational criteria.
2. **`PARTIAL`**: The control operates, but legacy data, secondary keys, or non-blocking conditions remain.
3. **`ACTION_REQUIRED`**: Unreadable records, corrupted payloads, unresolvable conflicts, or missing policies block control assurance.
4. **`UNVERIFIED`**: No evaluation has run, verification prerequisites are absent (e.g. no completed verify run), or the evaluator version has changed since the last evaluation.
5. **`NOT_APPLICABLE`**: The control is disabled or not applicable to the current deployment.

### Evaluator versioning

Evaluators declare a semantic `version` string (e.g., `'1'`). If an evaluator's logic is updated, cached runtime states matching older evaluator versions automatically resolve to `UNVERIFIED` until re-evaluated.

### Initial runtime evaluators

| Control ID          | Evaluator ID         | Version | Description                                                                                                                               |
| :------------------ | :------------------- | :------ | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `SEC-ENC-001`       | `encryption.at-rest` | 1       | Inspects latest completed `VERIFY` run and registry fingerprint; detects blocking errors, legacy keys, or full active-key authentication. |
| `SEC-RETENTION-001` | `data.retention`     | 1       | Checks system retention policies and verifies hold-aware cleanup integration.                                                             |
| `PRIV-HOLD-001`     | `privacy.holds`      | 1       | Checks legal retention hold registry and active hold protection across user, incident, and privacy-request scopes.                        |
| `PRIV-ERASURE-001`  | `privacy.erasure`    | 1       | Verifies personal data domain registry and cascade erasure execution capability.                                                          |
| `PRIV-EXPORT-001`   | `privacy.export`     | 1       | Verifies subject data export bundle generation engine.                                                                                    |
| `SEC-AUTHZ-001`     | `authorization.rbac` | 1       | Validates capability and role definitions across Admin, Responder, Auditor, and User roles.                                               |

### APIs & RBAC

- **`GET /api/compliance/controls`**: Returns all compliance controls with static definitions and current cached `runtimeState`.
  - Required capability: `compliance.read` (`ADMIN`, `AUDITOR`).
- **`POST /api/compliance/evaluations`**: Triggers a new evaluation run (batch or selected controls), recording immutable history and updating state projections.
  - Required capability: `compliance.evaluate` (`ADMIN`).
- **`GET /api/compliance/controls/[id]/evaluations`**: Returns historical evaluation records for a specific control.
  - Required capability: `compliance.read` (`ADMIN`, `AUDITOR`).

### Audit trail

Every batch evaluation emits structured audit events (`entityType: COMPLIANCE_EVALUATION`):

- `COMPLIANCE_EVALUATION_STARTED`: emitted before execution with target control IDs and trigger.
- `COMPLIANCE_EVALUATION_COMPLETED`: emitted upon successful completion with summary counts.
- `COMPLIANCE_EVALUATION_FAILED`: emitted if an unhandled fatal error occurs.
