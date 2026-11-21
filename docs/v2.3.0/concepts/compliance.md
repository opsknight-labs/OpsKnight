---
title: Compliance control evidence
description: Controls, evaluations, framework mappings, drift, and evidence packages.
type: concept
product_area: compliance
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/compliance, docs/compliance/README.md]
---

# Compliance control evidence

The control center maps product controls to framework requirements and records
evaluations, evidence snapshots, monitoring runs, and drift. Product-generated
evidence supports an operator's compliance program; it is not an automatic
certification. Framework scope, shared responsibility, and external evidence
remain deployment responsibilities.

A control definition states the expected condition. An evaluation records the
result at a point in time, and its evidence snapshot explains why that result
was reached. Framework mappings reuse that result across requirements without
claiming that one product control satisfies an entire external obligation.

Monitoring runs create new observations. Drift means the observed condition no
longer matches the accepted baseline; acknowledging drift records ownership but
does not make the control compliant. Remediation should produce a later passing
evaluation with independently reviewable evidence.

Exports are sensitive audit artifacts. Apply least privilege, retention, and
external storage controls to them, and record the evaluation time and product
revision so reviewers can distinguish historical evidence from current state.

## Data-processing inventory

The data-processing inventory (`docs/compliance/data-processing-inventory.yaml`)
now has entries for five more areas: intelligence, AI assistant, Squire memory,
operations insights and escalation step attempts. Each states the data it
holds, its purpose, its current retention and deletion behaviour and the target
state. The on-call entry also lists daily coverage seconds. These entries
match the privacy data registry; see [Privacy requests and retention](./privacy.md#intelligence-and-assistant-data).
