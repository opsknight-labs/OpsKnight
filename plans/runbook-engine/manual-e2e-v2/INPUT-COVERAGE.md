# OpsKnight Runbook Engine — Enterprise E2E Certification: Typed Inputs Coverage

**Document Version:** 2.1.0-cert2  
**Date:** October 17, 2026  
**Auditor:** Antigravity Advanced Agentic Coding Pair  
**Branch:** `feat/runbook-full-automatic-e2e-certification`  
**Control Plane:** `https://opssentinal.com`

---

## 1. Executive Summary & Typed Inputs Schema

In accordance with PR #888 defect resolutions, the OpsKnight Runbook Engine enforces seven canonical input types (`RUNBOOK_INPUT_TYPES` in `src/lib/runbooks/types.ts`):

1. `STRING` (Text with regex pattern, min/max length, and shell escaping)
2. `NUMBER` (Integer or Float with min/max bounds and zero support)
3. `BOOLEAN` (Strict `true`/`false` flags)
4. `URL` (Target URL with protocol and SSRF constraints)
5. `DURATION` (Human duration formats, e.g. `300s`, `15m`, `1h`)
6. `SECRET_REF` (Scoped encrypted secret identifier masked in logs)
7. `SELECT` (Strict enumeration allowlist)

All seven input types were tested for default handling, required validation, type confusion edge cases, template substitution (`${{ inputs.<key> }}`), and output sanitization.

---

## 2. Comprehensive Input Type Certification Entries

### Entry INP-01: STRING

- **Test ID:** `INP-01-STRING`
- **Specification:** Text parameter with optional `minLength`, `maxLength`, and `pattern` regex constraints.
- **Success Case:** Input `container_name: "ag-e2e-docker-api"` validated against regex `^[a-zA-Z0-9_-]+$`. Substituted into template `${{ inputs.container_name }}` with automatic shell quote escaping.
- **Boundary Case (Empty Optional):** Optional string input left blank. Evaluated as empty string `""` without crashing schema validator.
- **Negative Case (Pattern Mismatch):** Value `"api; rm -rf /"` rejected at UI and API boundary with `INVALID_INPUT: Value does not match required regex pattern`.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Input Validation Schemas

---

### Entry INP-02: NUMBER

- **Test ID:** `INP-02-NUMBER`
- **Specification:** Numeric parameter with `min`, `max`, and `integerOnly` options.
- **Success Case (Zero Value):** Input `replicas: 0`. Critical edge case: zero was preserved as numeric `0` rather than falsely evaluating to `undefined` or falsy default.
- **Success Case (Positive Integer):** Input `replicas: 2` with `min: 1`, `max: 10`. Passed validation, cast to JSON number.
- **Negative Case (Type Confusion):** String `"two"` supplied for number field. Rejected with `TYPE_MISMATCH: Expected number, received string`.
- **Negative Case (Out of Bounds):** Value `100` supplied when `max: 10`. Rejected with `BOUNDS_EXCEEDED: Value exceeds maximum limit 10`.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Input Validation Schemas

---

### Entry INP-03: BOOLEAN

- **Test ID:** `INP-03-BOOLEAN`
- **Specification:** Strict boolean parameter.
- **Success Case (True Flag):** Input `force: true`. Passed as boolean primitive.
- **Success Case (False Flag):** Input `force: false`. Critical edge case: false was preserved as boolean `false` rather than triggering fallback default.
- **Negative Case (Non-Boolean Coercion):** Value `"yes"` or `"1"` passed via API. Rejected with `TYPE_MISMATCH: Expected boolean, received string`.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Input Validation Schemas

---

### Entry INP-04: URL

- **Test ID:** `INP-04-URL`
- **Specification:** HTTPS URL format validator.
- **Success Case:** Input `probe_url: "https://opssentinal.com/api/v1/health"`. Validated protocol `https:`, parsed origin, and accepted.
- **Negative Case (Malformed URL):** Input `probe_url: "not-a-valid-url"`. Rejected with `INVALID_URL: Value must be a valid URL`.
- **Negative Case (Insecure Scheme):** Input `probe_url: "javascript:alert(1)"` or `file:///etc/passwd`. Blocked by scheme allowlist.
- **Status:** `PASS`
- **Relevant Fixing Commit:** URL Scheme Validation

---

### Entry INP-05: DURATION

- **Test ID:** `INP-05-DURATION`
- **Specification:** Human readable duration string parsed to integer milliseconds.
- **Success Case:** Inputs `"30s"`, `"5m"`, `"1h"`. Converted accurately to `30000ms`, `300000ms`, and `3600000ms`.
- **Boundary Case (Minimum Duration):** Input `"1s"`. Converted to `1000ms`.
- **Negative Case (Invalid Unit):** Input `"500lightyears"` or `"-10s"`. Rejected with `INVALID_DURATION: Unknown unit or negative duration`.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Duration Parser Schemas

---

### Entry INP-06: SECRET_REF

- **Test ID:** `INP-06-SECRET_REF`
- **Specification:** Scoped vault credential reference. Secret value is injected into execution environment at runtime and masked in logs/previews.
- **Success Case:** Input `api_token: "secret:vault_token_prod"`. Injected as environment variable `API_TOKEN`. Substituted value `eyJhbG...` used in authorization header.
- **Output Masking Test:** Step echoed secret value. Output stream scrubber replaced secret with `[REDACTED_SECRET]` before saving to execution log database.
- **Negative Case (Missing Grant):** Secret reference requested by an Agent without explicit scoped grant in **Runbooks → Secrets**. Execution halted with `UNAUTHORIZED_SECRET_ACCESS: Agent lacks grant for secret`.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Commit `082c093a8` & Secret Masking Engine

---

### Entry INP-07: SELECT

- **Test ID:** `INP-07-SELECT`
- **Specification:** Single selection from pre-defined enumeration options.
- **Success Case:** Options `["rolling", "recreate"]`, input `strategy: "rolling"`. Accepted.
- **Negative Case (Option Mismatch):** Input `strategy: "blue-green"`. Rejected with `INVALID_SELECTION: Option blue-green not present in allowed options [rolling, recreate]`.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Select Option Validator
