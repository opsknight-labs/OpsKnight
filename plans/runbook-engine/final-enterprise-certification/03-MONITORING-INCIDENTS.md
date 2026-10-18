# OpsKnight Runbook Engine — Phase 3: Monitoring & Incident Lifecycle Matrix

## 1. Monitoring & Ingestion Architecture

External monitoring alerts from Prometheus Alertmanager and synthetic Blackbox health probes are ingested through OpsKnight's authenticated Ingest Integration API (`/api/integrations/prometheus`).

```
[Target Workload / Probe]
           │ (HTTP /health Probe)
           ▼
[Prometheus / Alertmanager]
           │ (Authenticated Webhook POST)
           ▼
[OpsKnight Ingestion Gateway] ──► [HMAC / Key Auth Validation]
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
            [New Alert: "firing"]                       [Resolved Alert: "resolved"]
                       │                                           │
                       ▼                                           ▼
            [Compute dedupKey]                          [Match active dedupKey]
                       │                                           │
                       ▼                                           ▼
          [Auto-create Incident]                     [Set status = RESOLVED]
             (status = OPEN)                   (resolutionKind = SOURCE_RECOVERY)
```

---

## 2. Inbound Integration Security & Deduplication Contract

| Scenario                       | Input Condition                               | Expected Result                            | Live Server Status | Verification Receipt                                                                                   |
| ------------------------------ | --------------------------------------------- | ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------ |
| **1. Invalid Credentials**     | Request with invalid `integrationKey`         | `HTTP 401/403` Rejection                   | **PASS**           | Status `403 Forbidden` (`{"error":"Invalid integration key"}`), no incident created                    |
| **2. Malformed Payload**       | Non-JSON or broken payload                    | `HTTP 400 Bad Request`                     | **PASS**           | Status `400 Bad Request` (`{"error":"Malformed JSON"}`), unhandled exceptions prevented                |
| **3. Authenticated Firing**    | Valid firing alert for `cert3-k8s-api`        | `HTTP 202 Accepted`, Incident Created      | **PASS**           | Created incident `cmvcelqsh029j4qmqrmk64y61`, `status: OPEN`, `urgency: HIGH`                          |
| **4. Deduplication**           | Duplicate firing alert with identical labels  | Idempotent update, no duplicate incident   | **PASS**           | Handled under dedupKey `cmvc1j9zi0b4c11uz7hyxsupc:prometheus-4f51...`, duplicate count = 0             |
| **5. Cross-Service Isolation** | Firing alert delivered to Docker service      | Incident scoped strictly to Docker service | **PASS**           | Incident `cmvcelten02ad4qmqtwbuaak0` on Service `cmvbffoig07q614marj783x7f`, isolated from K8s service |
| **6. Browser UI Verification** | Live Incidents dashboard view                 | Real-time incident appearance              | **PASS**           | Rendered live in Chrome CDP at `https://opssentinal.com/incidents`                                     |
| **7. Resolved Alert Flow**     | Ingestion of `status: resolved` with `endsAt` | Automatic resolution via `SOURCE_RECOVERY` | **PASS**           | Incident `cmvcelqsh029j4qmqrmk64y61` transitioned to `RESOLVED`, `resolutionKind: SOURCE_RECOVERY`     |

---

## 3. SLA & Classification Rule Enforcement

1. **Classification Priority/Urgency Rules**:
   - `ALERT_SEVERITY:critical` mapped to `URGENCY: HIGH` and captured in incident metadata.
   - `slaAckTargetMs`: 900,000ms (15m SLA ack target).
   - `slaResolveTargetMs`: 7,200,000ms (120m SLA resolve target).
2. **Resolution Timestamp Recording**:
   - `resolvedAt`: Recorded at `2026-10-17T13:00:08.537Z`.
   - `slaResolveElapsedMs`: `22,789ms` automatically computed and logged.
