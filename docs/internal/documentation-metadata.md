# Documentation metadata contract

Every Markdown page in `docs/v2.0.0` except machine-oriented companion files
must begin with YAML frontmatter validated by
[`metadata.schema.json`](../v2.0.0/metadata.schema.json).

## Required fields

```yaml
---
title: Acknowledge an incident
description: Acknowledge, assign, and begin responding to an incident.
type: how-to
product_area: incidents
audience:
  - responder
  - administrator
verified: false
---
```

`type` describes the reader's intent, not the owning team. `product_area` is a
stable capability-map key. `audience` identifies the roles the page is written
for.

`verified: true` is allowed only when `verified_at` and at least one `evidence`
entry identify current source, tests, configuration, or generated runtime
evidence. A page must return to `verified: false` when its claims materially
change and have not been recertified.

Generated files such as `capabilities.yaml`, JSON schemas, and evidence metadata
do not use page frontmatter.
