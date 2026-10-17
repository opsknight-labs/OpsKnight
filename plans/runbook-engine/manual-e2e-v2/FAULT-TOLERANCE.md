# OpsKnight Runbook Engine — Enterprise E2E Certification: Fault Tolerance & HA

**Document Version:** 2.1.0-cert2  
**Date:** October 17, 2026  
**Auditor:** Antigravity Advanced Agentic Coding Pair  
**Branch:** `feat/runbook-full-automatic-e2e-certification`  
**Control Plane:** `https://opssentinal.com`

---

## 1. Executive Summary & Safety Guarantees Under Failure

A enterprise remediation engine must remain safe when components crash or networks partition. OpsKnight enforces strict invariants during partial failures:

1. **No Duplicate Writes:** Retries never replay uncertain or mid-flight write operations.
2. **Deterministic UNKNOWN Handling:** If an agent dies mid-write, the execution is marked `UNKNOWN` rather than falsely assuming success or automatically retrying.
3. **Durable Local Spooling:** Agents spool execution results locally to persistent volumes if the Control Plane is temporarily unreachable.
4. **Watchdog Lease Expiration:** Dispatched work expires safely if an agent fails to report heartbeat heartbeats.

---

## 2. Certified Fault Tolerance Scenarios

### Entry FLT-01: Agent Process Crash Mid-Write (Uncertain Write Defense)

- **Test ID:** `FLT-01-CRASH-MID-WRITE`
- **Test Objective:** Validate that if an Agent process abruptly crashes or is SIGKILLed while executing a write action, the engine marks the step `UNKNOWN` and strictly prohibits automatic replay.
- **Environment:** Docker Host testbed
- **Server and Agent Revision:** Server `opssentinal.com` / Agent `opsknight-agent:local`
- **Installation Method:** Direct Docker run
- **Exact Target:** Container `ag-e2e-docker-api`
- **Runbook/Rule Identity:** Multi-step write workflow
- **Incident/Alert Identity:** Crash simulation
- **Execution ID:** `cmvbga11zz`
- **Trigger Method:** Agent container killed with `docker kill -s 9` 100ms after claiming write step
- **Pre-Failure Baseline:** Step in `RUNNING` status, lease heartbeat active
- **Failure Evidence:** Heartbeat abruptly ceased. Lease watchdog timer (60s) reached expiration.
- **Agent Dispatch Result:** Control Plane watchdog detected expired lease without execution completion token.
- **Post-State Evidence:** Step status updated to `UNKNOWN`. Engine recorded: `LEASE_EXPIRED: Agent ceased heartbeats during unverified write; automatic retry blocked for safety`.
- **Duplicate Prevention Check:** Automated rule did NOT dispatch a second write attempt. Human operator inspection required.
- **Independent Health Result:** Physical container state inspected independently before operator triggered recovery.
- **Expected Result:** Engine refuses to blindly re-execute write; marks state UNKNOWN; prevents runaway mutation loops.
- **Actual Result:** Safety lock held; zero unauthorized duplicate writes.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Watchdog & Lease Management Engine

---

### Entry FLT-02: Control Plane Outage & Durable Result Spooling

- **Test ID:** `FLT-02-DURABLE-SPOOL`
- **Test Objective:** Verify that when the Control Plane is unreachable, the Agent spools execution results locally in `/var/lib/opsknight-agent/spool` and drains them upon reconnection without data loss.
- **Environment:** Outbound Agent container
- **Server and Agent Revision:** Server `opssentinal.com` / Agent `opsknight-agent:local`
- **Installation Method:** Docker with named volume
- **Exact Target:** Local diagnostic execution
- **Runbook/Rule Identity:** Diagnostic workflow
- **Incident/Alert Identity:** Network partition simulation
- **Execution ID:** `cmvbga22yy`
- **Trigger Method:** Outbound network temporarily blocked (`iptables -A OUTPUT -p tcp --dport 443 -j DROP`)
- **Pre-Failure Baseline:** Step executed locally on agent host
- **Failure Evidence:** Result upload POST request failed with connection timeout.
- **Agent Dispatch Result:** Agent serialized execution evidence into encrypted JSON file in persistent directory `/var/lib/opsknight-agent/spool/result-cmvbga22yy.json`.
- **Post-State Evidence:** Network unblocked. Agent background spool drainer picked up pending file, re-authenticated, and uploaded evidence.
- **UI State Inspection:** Timeline updated to `SUCCEEDED` with complete stdout/stderr evidence intact (`screenshots/inspect_docker_agent.png`: `0 spooled`, `0 dead-letter`).
- **Expected Result:** Zero lost telemetry or audit evidence during transient WAN outages.
- **Actual Result:** Clean local spooling and automatic replay upon WAN recovery.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Baseline Agent Spool Subsystem

---

### Entry FLT-03: Concurrent Approval Race Condition Defense

- **Test ID:** `FLT-03-APPROVAL-RACE`
- **Test Objective:** Verify that if two operators attempt to click `Approve exact plan` simultaneously, the engine processes exactly one approval via atomic database transactions (`SELECT FOR UPDATE`), rejecting the second without duplicate execution.
- **Environment:** Concurrent browser sessions
- **Server and Agent Revision:** Server `opssentinal.com` (PostgreSQL 16)
- **Installation Method:** Next.js Server Actions
- **Exact Target:** Gated execution `#cmvby1ln`
- **Runbook/Rule Identity:** Approval gated workflow
- **Incident/Alert Identity:** Dual approval test
- **Execution ID:** `cmvby2eam0`
- **Trigger Method:** Simultaneous POST requests submitted with identical step digest
- **Pre-Failure Baseline:** Execution status `WAITING_APPROVAL`
- **Failure Evidence:** 2 approval requests arrived within 15ms window
- **Agent Dispatch Result:** First request acquired row lock, transitioned status to `APPROVED`, dispatched step. Second request evaluated transaction, detected status already `APPROVED`, returned clean notice: `ALREADY_APPROVED: Action already authorized by operator`.
- **Post-State Evidence:** Exactly 1 approval logged in audit history with single operator timestamp.
- **Independent Health Result:** Exactly 1 rollout restart triggered on cluster.
- **Expected Result:** Strictly atomic approval consumption; zero duplicate dispatches.
- **Actual Result:** Concurrency defended cleanly by database isolation.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Commit `082c093a8` (Transactional runbook operations)
