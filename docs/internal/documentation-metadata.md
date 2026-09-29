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
verification:
  level: draft
---
```

`type` describes the reader's intent, not the owning team. `product_area` is a
stable capability-map key. `audience` identifies the roles the page is written
for.

`verification.level` is `draft`, `source`, `test`, or `runtime`. Every level
other than `draft` requires `verified_at` and at least one evidence entry.
Source verification proves that a contract exists in source; test verification
proves an executable test; runtime verification requires captured browser or
runtime evidence. A materially changed page returns to `draft` until recertified.

Generated files such as `capabilities.yaml`, JSON schemas, and evidence metadata
do not use page frontmatter.

## Reader completeness

`verification` proves accuracy; it does not prove that a reader can complete a
task. Task pages use the separate `reader` record defined in the
[authoring standard](documentation-authoring-standard.md):

```yaml
reader:
  status: READER_COMPLETE
  task: A new administrator connects Slack and sends a controlled test incident
  evidence: []
```

Pages without `reader` metadata remain `MAPPED` in the audit. Human and runtime
states require reviewer/revision/evidence fields and must never be inferred by
automation.
