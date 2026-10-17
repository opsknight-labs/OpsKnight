# Phase 6 — Journey C: Linux Systemd Qualification & Policy Control

**Status:** Schema & Policy Certified  
**Date:** October 17, 2026  
**Scope:** Systemd step schema, allowlist policy validation, and command generation

---

## 1. Architectural Architecture & Policy Contracts

The OpsKnight Runbook Engine enforces strict local policy controls over Linux Systemd units. A Systemd execution step is rejected at the Agent dispatch boundary unless:

1. The Agent's local `policy.json` contains `"SYSTEMD"` in `allowedStepTypes`.
2. The specific systemd unit (e.g. `nginx.service`, `redis.service`) is explicitly allowlisted in `systemdUnits: ["..."]`.
3. If the action is non-idempotent (`restart`, `reload`), `allowNonIdempotent: true` must be configured.

---

## 2. Command Generation & Step Types

In `agent/src/executor.ts`, Systemd actions map strictly to non-interactive systemctl invocations:

- `status`: `systemctl status <unit> --no-pager`
- `start`: `systemctl start <unit>` (Idempotent write)
- `stop`: `systemctl stop <unit>` (Safe write)
- `restart`: `systemctl restart <unit>` (Non-idempotent write, requires approval)
- `logs`: `journalctl --no-pager --unit <unit> --lines <lines>` (Read-only diagnostics)

Evidence capture (`agent/src/evidence.ts`) queries `systemctl show --property=ActiveState --value <unit>` to capture pre- and post-execution service states with bounded buffers.
