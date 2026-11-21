---
title: Postmortem operations
order: 1
description: Turn resolved incidents into reviewed learning records and owned follow-up work.
type: concept
product_area: postmortems
audience: [responder, administrator]
verification: { level: source, verified_at: 2026-10-01, evidence: [src/app/(app)/postmortems, src/components/postmortem, src/lib/action-items.ts] }
---

# Postmortems

A postmortem belongs to one resolved incident. It preserves the factual
timeline, impact, contributing conditions, resolution, lessons, and follow-up
work without changing the incident record.

Use [Create, review, and publish a postmortem](./create-review-publish) for the
complete workflow. Responders can draft postmortems for resolved incidents;
access to drafts and editing follows role, incident, team, assignee, and creator
authorization. Public publication is a separate decision from saving a draft.

Action items remain operational records after publication. Give each one a
clear owner, due date, priority, and verifiable completion condition, then track
it in **Action Items** or Jira when configured.
