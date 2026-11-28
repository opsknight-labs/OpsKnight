---
title: Sync on-call to a Slack user group
order: 15
description: Keep a Slack user group equal to whoever is on call for a schedule, so an @oncall mention always reaches the right people.
type: how-to
product_area: chatops
audience: [administrator]
keywords: [Slack user group, on-call sync, oncall mention]
reader:
  status: READER_COMPLETE
  task: Map an on-call schedule to a Slack user group and verify the sync.
verification:
  level: test
  verified_at: 2026-11-28
  evidence:
    - src/lib/slack/oncall-sync.ts
    - src/app/api/slack/oncall-sync/route.ts
    - src/components/settings/SlackOnCallSyncCard.tsx
    - src/lib/cron-scheduler.ts
    - tests/lib/slackops-b-routing.test.ts
    - tests/components/settings/SlackOnCallSyncCard.test.tsx
---

# Sync on-call to a Slack user group

## Before you begin

User groups are a paid Slack feature. Create the user group in Slack first (for example `@oncall-platform`). The Slack app needs the `usergroups:write` scope, and `usergroups:read` if you want to pick the group from a list; see [permissions and scopes](./permissions-and-scopes). An app installed before 2.3.0 must have its manifest updated and be reconnected to get them.

## Map a schedule

1. Open **Settings → Integrations → Slack** and find **On-call user groups**.
2. Choose an on-call schedule and a Slack user group. If OpsKnight can't list user groups, type the group's id.
3. Save. Use **Pause** and **Resume** to stop and restart a mapping, or remove it.

![The On-call user groups card with a schedule picker, a Slack user group picker, and a Link button](/docs/v2.3.0/assets/slack-on-call-user-groups-card.png)

## What OpsKnight does

About once a minute OpsKnight works out who is on call for each mapped schedule, finds each person's Slack account by email, and sets the user group's members to those people. Slack replaces a group's whole membership, so OpsKnight never sends an empty list: if nobody is on call, or none of the on-call people matches a Slack account, the group keeps its previous members and the mapping shows the reason. At most 50 people are synced, people without a Slack match are skipped, and a Slack rate limit is retried on the next pass.

## Verify it worked

The mapping shows **synced** after a successful pass, or the error after a failed one (a missing scope, a disconnected workspace, or nobody to sync). In Slack, check that the user group's members are the people currently on call.

This feature needs a paid Slack plan, so it was covered by automated tests but not run against a live workspace.

## Next steps

- [Slack permissions and scopes](./permissions-and-scopes)
- [Operate war rooms](./war-rooms)
