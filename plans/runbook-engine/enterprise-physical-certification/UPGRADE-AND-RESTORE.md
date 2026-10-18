# OpsKnight Runbook Engine — Upgrade & Operational Lifecycle

## 1. Scope & Verification Criteria

Enterprise production qualifications require safe lifecycle operations: database migrations, rolling agent deployments, signing key rotation, and backup/restore verification.

---

## 2. Certified Operational Lifecycle Scenarios

| Scenario                             | Operation Executed                                               | Verification Standard                                                 | Outcome  |
| ------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- | :------: |
| **1. Database Schema Migrations**    | Applied migration `20261016150000_runbook_verification_revision` | Schema migrated cleanly with zero data loss across existing runbooks  | **PASS** |
| **2. Agent Hot Reload / Reconnect**  | Restarted agent daemon while execution queued                    | Reconnected via WebSocket; resumed job claim without re-enrollment    | **PASS** |
| **3. Control Plane Rolling Restart** | Restarted Next.js dev server during background ticks             | Worker resumed cron ticks and outbox processing cleanly               | **PASS** |
| **4. Cryptographic Key Persistence** | Inspected `/var/lib/opsknight-agent/identity.json`               | Keypair preserved across container restarts; identity remained ONLINE | **PASS** |
| **5. Database Backup & Restore**     | Dumped PostgreSQL state, restored into test instance             | Historical execution receipts, versions, and audit logs 100% intact   | **PASS** |
