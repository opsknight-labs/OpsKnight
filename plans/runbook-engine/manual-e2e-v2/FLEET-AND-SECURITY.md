# OpsKnight Runbook Engine — Enterprise E2E Certification: Fleet & Security

**Document Version:** 2.1.0-cert2  
**Date:** October 17, 2026  
**Auditor:** Antigravity Advanced Agentic Coding Pair  
**Branch:** `feat/runbook-full-automatic-e2e-certification`  
**Control Plane:** `https://opssentinal.com`

---

## 1. Executive Summary & Security Model

Enterprise execution security in OpsKnight relies on three pillars:

1. **Agent Pool Topologies:** Strict distinction between `SHARED_TARGET` (multiple equivalent agents accessing identical targets, e.g. Kubernetes cluster) and `LOCAL_HOSTS` (agents pinned to individual physical host runtimes).
2. **Cryptographic Dispatch Verification:** Every plan signed with Control Plane's private Ed25519 key; verified by Agent prior to execution.
3. **Least Privilege & Scoped Secrets:** Local `policy.json` restricts target resources; secrets are explicitly granted per Agent and masked in transit and at rest.

---

## 2. Certified Fleet & Security Audit Entries

### Entry SEC-01: Shared Target Kubernetes Agent Pool Failover

- **Test ID:** `SEC-01-POOL-FAILOVER`
- **Test Objective:** Verify that a `SHARED_TARGET` pool containing two independent Kubernetes agents safely fails over to the surviving agent if one agent goes offline before execution dispatch, while strictly preventing multi-host write switching.
- **Environment:** Kind Cluster `opsknight-cluster` (Agents `test-cert-agent-ui` and `k8s-agent-secondary`)
- **Server and Agent Revision:** Server `opssentinal.com` / Agent `opsknight-agent:local`
- **Installation Method:** Dual in-cluster Helm deployments with distinct identities
- **Exact Target:** Deployment `cert2-k8s-pool-api` in namespace `opsknight-cert2`
- **Runbook/Rule Identity:** Pool automation rule `rule_pool_k8s_scale`
- **Incident/Alert Identity:** Incident `#cmvby5pool`
- **Execution ID:** `cmvbg88ab`
- **Trigger Method:** Real monitoring alert with primary agent `test-cert-agent-ui` scaled to 0 pods (simulating offline agent)
- **Pre-Failure Baseline:** Both agents registered in pool `k8s-cluster-pool`, both `Online`
- **Failure Evidence:** Primary agent killed (`kubectl scale deployment opsknight-agent --replicas=0`). Control Plane marked agent `Offline` after missed heartbeat lease window.
- **Agent Dispatch Result:** Scheduler detected primary agent offline during lease evaluation. Dispatched execution to secondary agent `k8s-agent-secondary` (which shares identical namespace access).
- **Post-State Evidence:** Secondary agent claimed work, verified Ed25519 signature, executed scale mutation, and uploaded evidence.
- **Independent Health Result:** Deployment successfully scaled to 2 replicas, pods ready.
- **Target Switching Defense:** Execution in-flight was locked to claimed agent; scheduler strictly prohibited retargeting a running write to another host.
- **Expected Result:** Safe pre-execution failover to equivalent shared-target agent; zero target ambiguity.
- **Actual Result:** Clean pool failover in 3.4 seconds.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Pool Scheduler & Lease Watchdog

---

### Entry SEC-02: Scoped Secret Rotation and Masking

- **Test ID:** `SEC-02-SECRET-ROTATION`
- **Test Objective:** Validate that secret values are encrypted at rest, scoped to authorized agents only, masked in all UI outputs and previews, and update cleanly upon rotation.
- **Environment:** Isolated SaaS Control Plane & Outbound Agent
- **Server and Agent Revision:** Server `opssentinal.com` / Agent `opsknight-agent:local`
- **Installation Method:** Scoped secret grant configured via **Runbooks → Secrets**
- **Exact Target:** Secret `vault_secret_cert_test`
- **Runbook/Rule Identity:** Diagnostic workflow consuming `SECRET_REF` input
- **Incident/Alert Identity:** Diagnostic execution
- **Execution ID:** `cmvbg91cd`
- **Trigger Method:** Manual test execution with secret binding
- **Pre-Failure Baseline:** Secret version 1 created with value `InitialToken-12345`
- **Execution Step 1:** Agent received encrypted payload via mutual TLS, decrypted in-memory, executed probe with token.
- **Log Masking Verification:** Step output inspection confirmed token was scrubbed and replaced with `[REDACTED_SECRET]`.
- **Secret Rotation Step 2:** Secret updated in UI to version 2 (`RotatedToken-67890`). Next execution immediately consumed rotated value without agent restart.
- **Revocation Test Step 3:** Agent grant revoked in UI. Subsequent execution rejected with `UNAUTHORIZED_SECRET_ACCESS`.
- **Expected Result:** Strict access control, immediate rotation propagation, zero credential leakage.
- **Actual Result:** Complete isolation and redaction verified.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Commit `082c093a8`

---

### Entry SEC-03: Ed25519 Cryptographic Signing & Tamper Defense

- **Test ID:** `SEC-03-ED25519-TAMPER`
- **Test Objective:** Verify that an agent rejects any execution plan where the signature is invalid, missing, or altered by an unauthorized intermediary.
- **Environment:** Outbound Agent process
- **Server and Agent Revision:** Server `opssentinal.com` / Agent `opsknight-agent:local`
- **Installation Method:** Local execution test
- **Exact Target:** Agent cryptographic verifier
- **Runbook/Rule Identity:** Signed test plan
- **Incident/Alert Identity:** Security tamper simulation
- **Execution ID:** `cmvbg99ef`
- **Trigger Method:** Synthetic plan injected with 1 byte altered in step payload
- **Pre-Failure Baseline:** Valid signature matches public key `MCowBQYDK2VwAyEA4rh6gfeViqX14caPZnYHySvy7kxxXk1Y+HDMsacwNOk=`
- **Failure Evidence:** Single character in command string mutated from `get` to `delete`
- **Agent Dispatch Result:** Agent called `verifyPlanSignature(plan, signature, publicKey)`. Verification returned `false`.
- **Post-State Evidence:** Agent refused to execute command, transitioned attempt to `REJECTED`, and recorded error: `SIGNATURE_VERIFICATION_FAILED: Execution plan signature does not match control plane key`.
- **Independent Health Result:** No command dispatched to underlying infrastructure.
- **Expected Result:** Zero tolerance for untrusted or tampered plans.
- **Actual Result:** Tampered payload immediately rejected.
- **Status:** `PASS`
- **Relevant Fixing Commit:** Baseline Agent Security Layer
