# Compliance Framework Mapping Engine

## Overview & Purpose

The OpsKnight Compliance Framework Mapping Engine replaces coarse framework tags with a granular, versioned requirement mapping architecture.

In earlier versions of OpsKnight, controls were marked with coarse string arrays such as `frameworks: ['GDPR', 'SOC2', 'ISO27001']`. This approach obscured which specific articles or criteria applied, what kind of relationship existed between the technical control and the standard, and where organizational or operator obligations began.

The Framework Mapping Engine models the complete provenance chain:

```text
Official Standard Source
       ↓
ComplianceFrameworkDefinition (Versioned)
       ↓
FrameworkRequirement (Specific article/clause, paraphrased summary, lifecycle)
       ↓
FrameworkControlMapping (Relationship, evidence expectation, technical rationale)
       ↓
OpsKnight Control (Technical definition)
       ↓
Runtime Evaluation + Automated Evidence (Observed state + SHA-256 integrity hash)
       +
Shared Responsibility Callouts (Operator & Organizational obligations)
```

---

## Non-Certification Invariant

> [!IMPORTANT]
> **Core Architectural Rule**:
> Mapping an OpsKnight control to a framework requirement means **"this control provides relevant supporting technical evidence."** It does **never** mean "this requirement is satisfied", "this control makes you compliant", or "this deployment is certified."

To prevent misleading compliance claims, the mapping engine structurally enforces the following rules:

- **No Certification States**: State enums are strictly limited to technical evaluation states (`IMPLEMENTED`, `PARTIAL`, `ACTION_REQUIRED`, `UNVERIFIED`, `NOT_APPLICABLE`). The engine structurally forbids `COMPLIANT`, `CERTIFIED`, `PASSED`, or `FAILED`.
- **No Synthetic Scores**: The query engine does not compute compliance percentages, completion meters, or audit readiness scores.
- **Uncollapsed Control States**: When multiple controls map to a requirement, their runtime states remain distinct and visible; they are never collapsed or averaged into a synthetic requirement status.
- **Shared Responsibility Boundary**: Technical evidence collected by OpsKnight covers only the software/deployment layer. Operator procedures and organizational policies are explicitly delineated.

---

## Architecture & Data Model

The framework mapping engine is implemented in TypeScript within `src/lib/compliance/framework-mappings/` as versioned product metadata. It does not require runtime schema migrations because runtime state and evidence already reside in `ComplianceControlState`, `ComplianceEvaluation`, and `ComplianceEvidence`.

### 1. Framework Definitions (`ComplianceFrameworkDefinition`)

Each supported framework is registered with its official legal or standard citation, version, jurisdiction, and official authoritative source URL:

| Framework ID | Title                                                                             | Version           | Jurisdiction    | Authoritative Source                                                            |
| ------------ | --------------------------------------------------------------------------------- | ----------------- | --------------- | ------------------------------------------------------------------------------- |
| `GDPR`       | General Data Protection Regulation (Regulation (EU) 2016/679)                     | 2016/679          | European Union  | EUR-Lex (`eur-lex.europa.eu`)                                                   |
| `CRA`        | EU Cyber Resilience Act (Regulation (EU) 2024/2847)                               | 2024/2847         | European Union  | EUR-Lex (`eur-lex.europa.eu`)                                                   |
| `SOC2`       | SOC 2 Trust Services Criteria                                                     | 2017              | Global / AICPA  | AICPA (`www.aicpa-cima.com`)                                                    |
| `ISO27001`   | ISO/IEC 27001:2022 Information Security Management                                | 2022              | International   | ISO (`www.iso.org`)                                                             |
| `ISO27701`   | ISO/IEC 27701:2019 (Legacy mapping — withdrawn; superseded by ISO/IEC 27701:2025) | 2019 (Withdrawn)  | International   | ISO (`www.iso.org`)                                                             |
| `DPDP`       | Digital Personal Data Protection Act, 2023 + DPDP Rules 2025                      | 2023 + Rules 2025 | India           | Ministry of Electronics and Information Technology (MeitY) (`www.meity.gov.in`) |
| `CCPA`       | California Consumer Privacy Act (as amended by CPRA)                              | 2018 / 2020       | California, USA | California Department of Justice (`www.oag.ca.gov`)                             |

### 2. Requirements (`FrameworkRequirement`)

Requirements represent specific clauses, articles, or criteria within a framework:

- **Reference**: The official designation (e.g., `Article 32(1)(a)`, `CC6.1`, `Clause A.8.24`).
- **Copyright-Safe Summary**: Standard descriptions are strictly paraphrased in OpsKnight's own words to respect third-party copyright (specifically for paywalled ISO standards and AICPA criteria).
- **Official URL**: Deep link to EUR-Lex, AICPA, ISO, MeitY, or CA DOJ.
- **Lifecycle**: `ACTIVE`, `FUTURE`, `SUPERSEDED`, or `REFERENCE_ONLY`.
- **Applicability**: `PRODUCT`, `OPERATOR`, `ORGANIZATION`, or `SHARED`.

### 3. Mappings (`FrameworkControlMapping`)

Mappings define how a technical control relates to a framework requirement:

- **Relationship**:
  - `TECHNICAL_EVIDENCE`: Automated verification directly demonstrates the technical mechanism (e.g., encryption at rest).
  - `PROCESS_SUPPORT`: OpsKnight facilitates a required workflow (e.g., subject discovery for DSR erasure requests).
  - `OPERATOR_DEPENDENCY`: The control provides the mechanism, but effectiveness depends on operator configuration (e.g., KMS master key rotation).
  - `ORGANIZATIONAL_DEPENDENCY`: The control covers technical aspects, but organizational policy or legal review is mandatory.
- **Evidence Expectation**: `RUNTIME`, `REPOSITORY`, `OPERATOR`, or `ORGANIZATIONAL`.
- **Rationale**: Human-readable technical explanation of what the control demonstrates and its explicit limitations.

### 4. Dynamic Lifecycle & Staged Commencement

The `resolveRequirementLifecycle(requirement, now)` function dynamically evaluates whether a requirement is active, future-effective, or superseded:

- **DPDP Act 2023 + DPDP Rules 2025**:
  - Under the 18-month staged commencement timeline (effective `2027-05-13`), all substantive requirements—reasonable security safeguards (`DPDP-SECURITY-SAFEGUARDS`, Section 8(5) & Rule 6), erasure upon purpose completion or consent withdrawal (`DPDP-RETENTION-SPECIFIED`, Section 8 & Rule 8), correction and erasure rights (`DPDP-ERASURE`, Section 12(3)), and grievance redressal mechanisms (`DPDP-GRIEVANCE-REDRESSAL`, Section 13 & Rule 14)—dynamically resolve to `FUTURE` prior to `2027-05-13` and `ACTIVE` on or after that date.
- **CRA (Regulation (EU) 2024/2847)**:
  - Incident & Vulnerability Reporting (`CRA-ART-14-REPORTING`, Article 14): In effect from `2026-09-11` (`ACTIVE`).
  - Substantive Product Obligations (`CRA-ANNEX-I-SECURITY`, `CRA-VULN-HANDLING`, `CRA-SBOM-DOCUMENTATION`, `CRA-SUPPORT-LIFECYCLE`): Apply 36 months after entry into force on `2027-12-11` (Article 71). Dynamically resolve to `FUTURE` prior to `2027-12-11` and `ACTIVE` thereafter.
- **ISO/IEC 27701:2019 (Legacy mapping — withdrawn; superseded by ISO/IEC 27701:2025)**:
  - ISO/IEC 27701:2019 (Edition 1) has been withdrawn by ISO and superseded by ISO/IEC 27701:2025 (Edition 2). Requirements reference official 2019 clauses (6.5, 7.2.8, 7.3.2, 7.4.2) and are preserved as historical mappings with lifecycle `SUPERSEDED` (`effectiveUntil: '2025-10-14'`). Transition to Edition 2 will occur once licensed Annex A control tables are formally verified.

### 5. Canonical Fingerprint

To enable auditability and change tracking across versions, `computeFrameworkMappingFingerprint()` generates a deterministic SHA-256 hash over the canonical JSON representation of all registered frameworks, requirements, and mappings. Any addition, modification, or deletion of a mapping produces a new unique fingerprint.

---

## Shared Responsibility Boundaries

Compliance cannot be achieved solely through software. OpsKnight establishes clear shared responsibility boundaries:

| Layer                      | Responsible Entity         | Scope & Examples                                                                                                                                                            |
| -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Software Platform**      | OpsKnight                  | Cryptographic algorithms (AES-256-GCM), capability-protected structured audit logging, automated runtime evaluators, cryptographic evidence hashing, access control engine. |
| **Operational Deployment** | Operator / Hosting Team    | Key rotation frequency, root KMS envelope key security, backup retention enforcement, network perimeter firewalls, TLS termination.                                         |
| **Governance & Legal**     | Organization / Legal / DPO | Data Protection Officer appointment, Privacy Impact Assessments (DPIA), breach notification to supervisory authorities, vendor DPAs.                                        |

---

## API Endpoints

All compliance mapping endpoints require authentication with `compliance.read` capability:

### 1. List All Frameworks

```http
GET /api/compliance/frameworks
```

Returns factual summary views for all 7 registered frameworks, including mapping counts, runtime evidence counts, operator dependency counts, and the canonical mapping fingerprint.

### 2. Get Framework Details

```http
GET /api/compliance/frameworks/:id
```

Returns the framework definition, version, authoritative source, and factual summary statistics.

### 3. List Framework Requirements

```http
GET /api/compliance/frameworks/:id/requirements
```

Returns all requirements for the specified framework joined with their mapped controls, active runtime states, and SHA-256 integrity-verified evidence records.

### 4. Get Requirement Details

```http
GET /api/compliance/frameworks/:id/requirements/:requirementId
```

Returns a single requirement joined with mapped controls, individual runtime states, operator responsibilities, and organizational obligations.

### 5. Get Control Framework Mappings

```http
GET /api/compliance/controls/:id/framework-mappings
```

Returns all framework requirements mapped to a specific OpsKnight control, including relationships and technical rationales. Used by control detail drawers and inspectors.

---

## Verification & Architecture Tests

The framework mapping engine is covered by automated architectural and unit test suites:

- **`tests/architecture/compliance-framework-mappings.test.ts`**:
  - Validates uniqueness of all framework, requirement, and mapping IDs.
  - Verifies that all official source URLs belong to allowlisted government and standards bodies.
  - Enforces bidirectional consistency with legacy `control.frameworks` tags.
  - Enforces that all `RUNTIME` evidence expectation controls have active registered evaluators.
  - Formally asserts the absence of certification language (`COMPLIANT`, `CERTIFIED`, `PASSED`, `FAILED`, score, percentage).
  - Confirms determinism of the canonical SHA-256 mapping fingerprint.
- **`tests/unit/compliance-framework-mappings.test.ts`**:
  - Tests dynamic lifecycle resolution across temporal boundary dates for staged DPDP commencement.
  - Validates factual summary views without scoring.
  - Verifies that independent control states are preserved without collapsing into synthetic requirement states.
