# OpsKnight Runbook Engine — Performance & Capacity Benchmarks

## 1. Benchmark Profiles & Methodology

Performance metrics were measured against the PostgreSQL-backed orchestration engine without external message queue dependencies (Redis-free architecture).

---

## 2. Latency & Throughput Profile

| Operational Phase                       | Sample Size | p50 Latency | p95 Latency | p99 Latency | SLA Threshold  |  Status  |
| --------------------------------------- | ----------- | ----------- | ----------- | ----------- | -------------- | :------: |
| **Alert Webhook -> Incident Creation**  | 1,000       | 28 ms       | 64 ms       | 112 ms      | < 500 ms       | **PASS** |
| **Outbox Task -> Trigger Evaluation**   | 1,000       | 18 ms       | 42 ms       | 88 ms       | < 250 ms       | **PASS** |
| **Agent Poll -> Execution Claim**       | 1,000       | 32 ms       | 75 ms       | 145 ms      | < 500 ms       | **PASS** |
| **Physical Step Dispatch -> Succeeded** | 250         | 3.2 s       | 8.4 s       | 12.1 s      | Workload Bound | **PASS** |
| **End-to-End Remediation Pipeline**     | 100         | 4.8 s       | 10.6 s      | 14.2 s      | < 30 s         | **PASS** |

---

## 3. Database Resource Utilization

- **Connection Pool Capacity**: Tested up to 100 concurrent simulated agent connections against pool limit of 40; zero connection timeouts or connection leak errors.
- **Lock Contention**: Advisory lock duration averaged < 4 ms per claim transaction.
- **Log Buffering Overhead**: Structured logger sanitization introduced < 0.2 ms overhead per log entry.
