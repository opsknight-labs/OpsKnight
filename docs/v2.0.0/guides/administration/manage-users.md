---
title: Manage users
description: Invite, activate, disable, and review user access safely.
type: how-to
product_area: users
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/users/admin-invariants.ts
    - src/lib/users/reference-policy.ts
---

# Manage users

Invite a user with the least-privileged role, add only required team membership,
and confirm activation through the intended identity path. Review access before
role changes and before disabling an account.

Administrator invariants prevent removing the last usable administrator.
Disabling a user must preserve historical references and may require reassignment
of schedules, incidents, teams, tokens, or operational ownership.

