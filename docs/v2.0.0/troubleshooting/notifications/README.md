---
title: Troubleshoot notification delivery
description: Locate failures across routing, queues, providers, and recipient endpoints.
type: concept
product_area: notifications
audience: [operator, administrator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/notification-control-plane.ts] }
---

# Troubleshoot notification delivery

Use [Notifications are not delivered](./not-delivered). Trace one notification from routing decision to intent, queue claim, provider attempt, provider response, and recipient endpoint. Do not retry blindly until you know whether the prior attempt may already have reached the user.
