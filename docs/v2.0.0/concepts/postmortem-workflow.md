---
title: Postmortem workflow
description: Draft, review, action, and learning boundaries after resolution.
type: concept
product_area: postmortems
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/app/(app)/postmortems/actions.ts, src/lib/action-items.ts]
---

# Postmortem workflow

A postmortem is linked to a resolved incident and uses its timeline as evidence.
Draft visibility, review, publication, and action-item ownership are distinct
states. The workflow should identify contributing conditions and measurable
follow-up work without rewriting the incident record.

The incident timeline remains the factual source. A draft can add analysis,
impact, detection gaps, and contributing conditions, but corrections to the
operational record belong on the incident itself. Publication freezes a useful
learning artifact; it does not close unfinished action items.

Every action item needs one owner, a due date, and a verifiable outcome. Track
delivery separately from the narrative so overdue work remains visible after
the review meeting. If an action moves to Jira, retain the external key and URL
as the durable cross-system link.

Access follows the underlying incident and postmortem authorization rules.
Remove customer secrets and unnecessary personal data before publication or
export, while preserving evidence needed for audit and learning.
