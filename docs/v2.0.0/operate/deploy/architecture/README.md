---
title: Deployment architecture
description: Choose runtime topology and size database connections before deployment.
type: concept
product_area: deployment
audience: [operator, administrator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/runtime-role.ts, deploy/] }
---

# Deployment architecture

Start with the [current architecture diagrams](./diagrams) and [integrated versus split runtime](./integrated-vs-split), then review [runtime roles](./runtime-roles) and [database connection planning](./database-connections). Choose one topology deliberately and document role replicas, worker lanes, connection budgets, health probes, and rollback ownership before rollout.
