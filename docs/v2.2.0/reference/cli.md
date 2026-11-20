---
title: Command-line reference
description: Create or update the initial local OpsKnight user from a trusted host.
type: reference
product_area: administration
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - scripts/OpsKnight.mjs
    - package.json
---

# Command-line reference

The `OpsKnight` command creates the first local user or updates an existing
local user's name, password, role, and active state. Run it only from a trusted
administration environment with `DATABASE_URL` set.

```sh
OpsKnight --user "Maya Chen" --email maya.chen@company.com \
  --password "$INITIAL_ADMIN_PASSWORD" --role admin
```

Required flags are `--user`, `--email`, and `--password`. `--role` accepts
`admin`, `responder`, or `user` and defaults to `user`. Add `--update` when the
email already exists. The command never prints the supplied password.

Use `OpsKnight --help` for the installed command contract. Prefer OIDC and SCIM
for ongoing identity lifecycle management after initial bootstrap.
