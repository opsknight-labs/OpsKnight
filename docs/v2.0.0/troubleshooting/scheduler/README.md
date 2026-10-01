---
title: Troubleshoot the scheduler
description: Diagnose maintenance and scheduled work that is not processing.
type: concept
product_area: scheduler
audience: [operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/runtime-role.ts] }
---

# Troubleshoot the scheduler

Use [Scheduler is not processing maintenance](./not-processing). Verify that exactly the intended scheduler role is running, its health and database lease are current, clocks agree, and queued work is eligible before forcing or duplicating execution.
