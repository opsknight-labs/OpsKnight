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

Include PostgreSQL, attachments or object storage used by the installation, and
the encryption key in the recovery inventory. Store the encryption key and
application secrets separately from the database backup while preserving a
controlled way to recover the matching versions.

Restore into an isolated environment, apply the intended application revision,
and verify migrations, sign-in, services, incidents, audit history, integrations,
and background processing. Record duration and evidence. A backup that has not
been restored is not a proven recovery plan.

Define a recovery point objective and recovery time objective, then schedule a
restore drill that demonstrates both. Validation should include encrypted
provider configuration, API authentication, queues, and one synthetic incident
workflow. For troubleshooting, preserve database and migration logs and avoid
overwriting the last known-good backup during a failed restore.
