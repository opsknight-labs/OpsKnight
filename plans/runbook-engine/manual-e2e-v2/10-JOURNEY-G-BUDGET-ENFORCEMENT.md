# Phase 10 — Journey G: Remediation Budget & Safety Enforcement

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Scope:** Automated execution quotas, mutation budgets, and non-idempotent write locks

---

## 1. Remediation Safety Model

To prevent automated runaway execution loops (e.g. infinite restart loops during persistent underlying hardware failures), OpsKnight enforces per-incident safety limits:

```
+-----------------------------------------------------------------------------------+
|                            Per-Incident Safety Budgets                            |
+------------------------------+--------------------+-------------------------------+
| Budget Metric                | Default Limit      | Enforcement Behavior          |
+------------------------------+--------------------+-------------------------------+
| Automatic Runs               | 3 per incident     | Further automated runs blocked|
| Automatic Writes             | 3 per incident     | Write actions rejected        |
| Non-Idempotent Actions       | OFF (0 allowed)    | Strictly requires human gate  |
+------------------------------+--------------------+-------------------------------+
```

---

## 2. Verification Receipts

1. **Safety Card Visibility:**
   - On both the Docker incident (`#cmvbxz59`) and the Kubernetes incident (`#cmvby1ln`), the "Automation safety" panel displayed:
     - `Automatic runs: 0 / 3`
     - `Automatic writes: 0 / 3`
     - `Non-idempotent actions: Off`
2. **Responder Exemption:**
   - Runs initiated or authorized by an authenticated human responder are tracked separately and do not consume the automated unattended safety budget.
3. **Execution Guardrails:**
   - Attempting to run a non-idempotent action without an approval gate or policy override is rejected at the execution planning phase with `AUTOMATION_BUDGET_EXCEEDED` or `APPROVAL_REQUIRED`.
