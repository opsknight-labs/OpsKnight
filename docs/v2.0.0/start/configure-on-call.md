---
title: Configure on-call for your first service
description: Create verified coverage, build a paging policy, and attach it to the service.
type: tutorial
product_area: getting-started
audience: [administrator]
keywords: [configure on-call, on-call schedule, responder rotation, escalation policy]
reader:
  status: READER_COMPLETE
  task: Configure and verify on-call coverage and escalation for the first service.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/app/(app)/schedules/actions.ts
    - src/app/(app)/policies/actions.ts
    - src/components/service/ServiceGeneralSettings.tsx
---

# Configure on-call for your first service

This tutorial creates a one-responder schedule for a safe first alert. Expand it into a production rotation only after the end-to-end test succeeds.

## Before you begin

Complete [Create your first team and service](./create-first-service). The responder must be active and should have at least one usable personal notification destination.

## 1. Create continuous test coverage

1. Open **Schedules** and expand **Create Schedule**.
2. Name it after the test service, for example `Checkout API Primary`.
3. Select the time zone that owns handoffs, then create and open it.
4. Under **Rotation layers**, select **Add Layer**.
5. Name the layer `Primary`, set the handoff interval to `168` hours, and leave **This layer is active for** empty.
6. Set **First responder starts** to a time in the past.
7. Leave the end date and repeating coverage restrictions empty for 24×7 coverage.
8. Add the test responder and save.

Check **Current coverage**. It must show the test responder. If it shows no coverage, do not continue; use the [schedule troubleshooting steps](../guides/on-call/build-schedule).

## 2. Create the escalation policy

1. Open **Escalation Policies** and select **Create Policy**.
2. Name it `Checkout API Paging` and describe its test purpose.
3. Open the policy and select **Add Escalation Step**.
4. Choose **Schedule (On-Call)** and select the schedule.
5. Set **Delay** to `0`.
6. Leave conditions empty so the first test incident matches.
7. Select only the personal channels already configured for the test responder.
8. Add the step.

Expected result: step 1 targets the schedule immediately. A selected channel is only an allow-list; the responder must also enable it and have valid destination data.

## 3. Attach the policy to the service

1. Open **Services → Checkout API**.
2. Open the service's general settings.
3. Select `Checkout API Paging` under **Escalation Policy**.
4. Save the settings.
5. Return to the policy and confirm the service appears under **Linked Services**.

The route is now `service → policy → schedule → current responder → enabled personal channel`.

## 4. Preflight the route

Before sending an alert, verify every link:

- the service shows the correct policy;
- the policy has a zero-minute first step;
- the schedule shows current coverage;
- the responder is active;
- the selected channel is enabled in the responder's notification preferences;
- the corresponding provider is healthy.

Continue with [Receive your first alert](./receive-first-alert).

For multiple responders, restrictions, daylight-saving behavior, gaps, and overrides, use [Build an on-call schedule](../guides/on-call/build-schedule), [Schedule overrides](../guides/on-call/overrides), and [Configure an escalation policy](../guides/escalation/configure-policy).
