---
title: Maintain data and retention
description: Plan retention, cleanup, and storage maintenance without losing required evidence.
type: how-to
product_area: data
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/retention-policy.ts, prisma/schema.prisma]
---

# Maintain data and retention

## Before you begin

Approve retention requirements with security, privacy, compliance, and database
owners, and verify a recent backup through a restore drill.

1. Inventory record classes, storage growth, holds, and deletion requirements.
2. Configure the supported retention policy and exclusions.
3. Preview or inspect eligible records before cleanup executes.
4. Verify protected records remain and cleanup evidence is recorded.

Set retention according to incident, audit, privacy, compliance, and legal-hold
requirements. Retention cleanup is destructive: validate scope, exclusions, and
backup recoverability before enabling or changing it.

Monitor database growth, attachment/object storage, queue tables, audit volume,
and cleanup failures. Run database-native maintenance using your PostgreSQL
provider’s guidance and schedule intensive work away from paging peaks.

A legal or retention hold takes precedence over normal deletion. After a policy
change, verify eligible records, protected records, job progress, storage
reclamation, and audit evidence. Never use manual SQL deletion as routine
retention automation.
