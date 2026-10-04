---
title: Local development
description: Run an isolated OpsKnight development environment.
type: developer
product_area: engineering
audience: [developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [package.json, deploy/compose/docker-compose.dev.yml]
---

# Local development

OpsKnight requires the Node version declared in `package.json` and PostgreSQL.
Install with `npm ci`, copy only the required development configuration into a
local ignored environment file, and point `DATABASE_URL` at a disposable
database. Apply migrations before running `npm run dev`.

Never reuse production credentials, encryption keys, provider tokens, or a
production database. Use the development Compose overlay when containerized
dependencies are preferable, and stop it when the session ends.

Use repository-managed dependencies and synthetic data. Never connect local
documentation or test tooling to production databases, clusters, or provider
accounts.
