---
title: Command Center
order: 1
description: Use the OpsKnight home dashboard to understand operational state and choose the next response action.
type: concept
product_area: analytics
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-10-25
  evidence: [src/app/(app)/page.tsx, src/components/dashboard/live/LiveCommandStrip.tsx, src/components/dashboard/live/LiveIncidentsPanel.tsx]
---

# Command Center

The Command Center at `/` is the signed-in operational home page. It shows the
current state of active incidents, a live incident feed that updates without a
refresh, the responder signals in **Ops Pulse**, and historical trends. A
chrome-free **Wallboard** at `/wallboard` shows the same live data on office TVs.
It is an operational view; use **Analytics** for deeper historical analysis and
**Reports** for saved executive dashboards.

Start with [Use the Command Center](./use-command-center) for a complete tour of
scope, metrics, the live feed, Ops Pulse, trends, the wallboard, and
troubleshooting.

