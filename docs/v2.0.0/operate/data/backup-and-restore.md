---
title: Back up and restore data
description: Protect PostgreSQL data and prove recoverability with restore drills.
type: deployment
product_area: data
audience: [operator, administrator]
keywords: [backup OpsKnight, restore backup, PostgreSQL backup, disaster recovery]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - deploy/scripts/drills/verify-backup-restore.sh
    - prisma/schema.prisma
---

# Back up and restore data

Back up PostgreSQL with a method appropriate to the database service, retention
policy, and recovery objectives. Protect encryption keys and application secrets
through a separate controlled process; database recovery without the matching
key material may leave encrypted configuration unusable.

Restore into an isolated environment, apply the intended application revision,
and verify migrations, sign-in, services, incidents, audit history, integrations,
and background processing. Record duration and evidence. A backup that has not
been restored is not a proven recovery plan.
