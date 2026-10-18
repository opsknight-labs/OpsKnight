# OpsKnight Runbook Engine — Enterprise Compliance Matrix

## 1. Compliance Standard & Scope

Enterprise production qualification requires alignment with SOC 2 Type II, ISO 27001, and Zero-Trust infrastructure security standards across the incident remediation lifecycle.

---

## 2. Requirement Compliance Mapping

| Requirement Area                     | Specification Standard                             | Implementation Mechanism                     | Evidence Reference              | Compliance Status |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------- | ------------------------------- | :---------------: |
| **Audit Trails & Tamper Resistance** | Append-only execution history & step logs          | Cryptographic hash pinning & Ed25519 signing | `CERTIFICATION-MANIFEST.md`     |   **COMPLIANT**   |
| **Separation of Duties**             | Independent approval gates for sensitive writes    | Server-side RBAC validation                  | `SECURITY-AND-RBAC-RESULTS.md`  |   **COMPLIANT**   |
| **Credential Protection**            | Zero plain-text secrets in code, logs, or UI       | Structured logger redaction & Scoped Secrets | `DEFECT-REGISTER.md`            |   **COMPLIANT**   |
| **Least Privilege Access**           | Outbound-only agent communication                  | Mutual TLS & local agent policy allowlists   | `AGENT-INSTALLATION-RESULTS.md` |   **COMPLIANT**   |
| **High Availability & Durability**   | Resilient against agent, worker, and host failures | PostgreSQL advisory locks & shared pools     | `SHARED-TARGET-FAILOVER.md`     |   **COMPLIANT**   |
| **Accessibility & Usability**        | WCAG 2.1 AA compliant UI with keyboard navigation  | Modal escape dismissals & responsive matrix  | `BROWSER-AND-ACCESSIBILITY.md`  |   **COMPLIANT**   |
