---
title: Roll back an upgrade
description: Decide and execute a safe application or data recovery path.
type: deployment
product_area: upgrades
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - scripts/validate-migrations.cjs
    - deploy/swarm/scripts/rollback.sh
---

# Roll back an upgrade

Define rollback triggers before deployment. An application image rollback is
safe only when the older runtime is compatible with the migrated schema. Do not
reverse migrations ad hoc or use destructive database flags.

If schema compatibility is not guaranteed, stop writes and follow the tested
restore plan. After rollback, verify the same critical journeys and background
owners used for upgrade acceptance, then retain the failure and recovery evidence.

