---
title: Troubleshoot installation
description: Diagnose startup and first-run failures systematically.
type: concept
product_area: deployment
audience: [operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/instrumentation.ts, deploy/] }
---

# Troubleshoot installation

Begin with [Application startup fails](./startup-fails). Identify the failing container or runtime role, preserve its first error, then check configuration, secrets, database reachability, migrations, filesystem permissions, and dependency health in that order.

If the application responds but shows HTTP 421, use [Recover from Misdirected Request](./misdirected-request). It covers Application URL, environment origins, proxy trust, aliases, and safe recovery.
