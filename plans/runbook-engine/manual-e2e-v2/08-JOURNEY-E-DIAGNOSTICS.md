# Phase 8 — Journey E: Linux Diagnostics & Evidence Capture

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Scope:** LINUX_DIAGNOSTICS step type, bounded telemetry capture, and evidence redaction

---

## 1. Supported Diagnostic Subtypes

The `LINUX_DIAGNOSTICS` step type allows non-intrusive runtime observation of host or container health:

| Diagnostic Subtype      | Command Executed             | Output Capture & Bounds         | Risk Classification |
| :---------------------- | :--------------------------- | :------------------------------ | :------------------ |
| `summary`               | OS release, uptime, kernel   | Bounded to 4 KiB                | `READ_ONLY`         |
| `disk` / `filesystem`   | `df -h`                      | Bounded to 4 KiB                | `READ_ONLY`         |
| `memory`                | `free -m` / `/proc/meminfo`  | Bounded to 4 KiB                | `READ_ONLY`         |
| `processes` / `process` | `ps aux`                     | Top processes, bounded to 4 KiB | `READ_ONLY`         |
| `network`               | `ip route` / interface stats | Bounded to 4 KiB                | `READ_ONLY`         |
| `journal`               | `journalctl -n 100`          | Log summary, bounded to 4 KiB   | `READ_ONLY`         |

---

## 2. Policy Enforced Protection

- The Agent inspects its local `policy.json` for allowlisted diagnostics in `linuxDiagnostics: [...]`.
- Any diagnostic request not explicitly enabled in the local policy is rejected locally with `LOCAL_POLICY_DENIED: Linux diagnostic <type> is not enabled in local Agent policy`.
- All outputs are automatically scrubbed by `agent/src/output-safety.ts` to redact environment tokens, credentials, and sensitive private key material.
