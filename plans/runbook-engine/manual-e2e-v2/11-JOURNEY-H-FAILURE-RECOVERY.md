# Phase 11 — Journey H: Failure Recovery, Durability & Reconnection

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Scope:** Agent crash durability, restart survival, identity persistence, spool queues

---

## 1. Identity Durability Across Restarts

1. **Volume Pre-Staging & Key Generation:**
   - When an Agent container starts for the first time, it reads the enrollment token from `/var/lib/opsknight-agent/enrollment-token`.
   - It performs outbound mutual authentication with the Control Plane, generates a unique Ed25519 keypair, and writes its identity to `/var/lib/opsknight-agent/identity.json`.
   - It safely unlinks the one-time token file.
2. **Container Recreation Verification:**
   - During this certification, the Docker agent container `31eadaeb257e` was forcibly stopped, removed (`docker rm`), and recreated as a new container (`9c30a68ed4c9`).
   - Because the identity was stored in the durable volume `opsknight-agent-cmvbcv9lr02hz14mah9j953nm_opsknight_agent_data`, the new container immediately loaded its existing Ed25519 keypair and re-authenticated with the Control Plane without needing a new enrollment token.
   - Status on `https://opssentinal.com/runbooks/agents` transitioned seamlessly back to `Online` with `0 spooled` and `0 dead-letter` attempts.

---

## 2. Execution Lease Expiration & Worker Health

- Steps claimed by an Agent are bound by an active lease heartbeat.
- If an Agent process abruptly dies mid-execution, the Control Plane's watchdog detects lease expiration and safely marks the execution as `UNKNOWN` or `TIMED_OUT` to prevent hanging workflows.
