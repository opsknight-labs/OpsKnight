# OpsKnight Runbook Engine — Bug & Remediation Register

## 1. Overview & Issue Tracking

During the comprehensive end-to-end certification of the OpsKnight Runbook Engine, defects, edge cases, and safety concerns were logged, diagnosed, and remediated. Below is the complete register of identified issues, root cause analyses, and applied fixes.

---

## 2. Bug Register & Resolution Matrix

| Bug ID      | Component                                 | Severity   | Description                                                                                 | Root Cause                                                                          | Remediation & Fix                                                                                                                                       | Status       |
| ----------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **BUG-001** | `runbook-actions.ts` & `policy-checks.ts` | **Medium** | Unhandled Server Action 500 digest (`1896525779`) on policy check without targets           | `checkRulePolicyAction` lacked `try/catch` and `policy-checks.ts` threw raw `Error` | Wrapped in `try/catch`; returns `error.userMessage` for `RunbookError`; masks unexpected internal DB errors with generic message; added automated tests | **RESOLVED** |
| **BUG-002** | Test Automation / CDP                     | **Low**    | Synthetic button clicks in React 19 forms throw `"A React form was unexpectedly submitted"` | Next.js Server Actions with Radix UI require explicit form dispatch                 | Updated test scripts to invoke `form.requestSubmit()` instead of raw button clicks                                                                      | **RESOLVED** |
| **BUG-003** | Test Runner Scripts                       | **Low**    | Chrome CDP eval SyntaxError on multiline strings                                            | Unescaped newline characters in JS template strings sent over WebSocket             | Replaced regex replacements with `.split('\n').join(' ')`                                                                                               | **RESOLVED** |
| **BUG-004** | Server Action Testing                     | **Medium** | Missing regression tests for Server Action policy check error masking                       | `checkRulePolicyAction` lacked dedicated unit tests for error boundary handling     | Added `tests/lib/runbooks/check-rule-policy-action.test.ts` (3/3 passing)                                                                               | **RESOLVED** |
| **BUG-005** | Agent Policy Readiness                    | **Low**    | Selector requiring incident context could not be validated on service page                  | Rule selector with `incident.labels.*` requires live incident context               | Added informative UI guard: "Target requires incident context. Preview from that incident."                                                             | **RESOLVED** |

---

## 3. Detailed Fix Receipts

### BUG-001: Graceful Error Handling & Security Hardening in `checkRulePolicyAction`

- **Files**:
  - `src/app/(app)/services/[id]/runbook-actions.ts`
  - `src/lib/runbooks/policy-checks.ts`
  - `tests/lib/runbooks/check-rule-policy-action.test.ts`
- **Diff**:

```diff
 export async function checkRulePolicyAction(serviceId: string, ruleId: string) {
   const actor = await bindingActor(idSchema.parse(serviceId));
   const { requestRulePolicyChecks } = await import('@/lib/runbooks/policy-checks');
-  const result = await requestRulePolicyChecks(serviceId, idSchema.parse(ruleId), actor.id);
-  revalidatePath(`/services/${serviceId}`);
-  return result;
+  try {
+    const result = await requestRulePolicyChecks(serviceId, idSchema.parse(ruleId), actor.id);
+    revalidatePath(`/services/${serviceId}`);
+    return result;
+  } catch (error) {
+    if (error instanceof RunbookError) return { error: error.userMessage };
+    console.error('Failed to check rule policy:', error);
+    return {
+      error: 'Could not complete policy check. Please check configuration and try again.',
+    };
+  }
 }
```

- **Automated Test Evidence**: `tests/lib/runbooks/check-rule-policy-action.test.ts` verifies that `RunbookError` returns structured `userMessage`, while unexpected database errors are masked to prevent information disclosure.
