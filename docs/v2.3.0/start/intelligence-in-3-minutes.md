---
title: Set up Intelligence in three minutes
description: Start Intelligence in Watch only mode, connect your alerts, optionally add an AI model, and switch suggestions on when you are ready.
type: tutorial
product_area: intelligence
audience: [administrator]
reader:
  status: SOURCE_VERIFIED
  task: Turn on Intelligence so it only watches, then show suggestions to your team and apply noise controls once there is evidence.
verification:
  level: test
  verified_at: 2026-11-28
  evidence:
    - src/app/(app)/settings/intelligence/setup/page.tsx
    - src/components/settings/IntelligenceSetupGuide.tsx
    - src/components/settings/IntelligenceSetupChecklist.tsx
    - src/lib/intelligence/settings/setup.ts
    - tests/integration/intelligence/setup-preset.test.ts
    - tests/components/settings/IntelligenceSetup.test.tsx
---

# Set up Intelligence in three minutes

Intelligence learns from your incidents to find similar past incidents, likely causes and noisy alerts. It
starts by **only watching**: nobody's paging changes, no alert is held back, and your team sees nothing new
until you decide. You need the administrator role.

## Before you begin

At least one service and one integration, so there are incidents to learn from. Without them the guide still
works, and tells you what to add.

## 1. Start watching

1. Open **Settings → Intelligence → Get started** (or select **Get started** on the Intelligence page).
2. Select **Start watching**.

This turns on the Intelligence engine, the operations insights and the small helpers, sets the global policy
to **Watch only**, and puts noise controls in **Watch only** with merging repeats, quieting flapping alerts and
grouping storms recorded. Nothing is applied: it records which pages it could have prevented.

## 2. Connect your alerts

The guide shows how many services and incidents Intelligence is learning from. If there are none, it links to
**Services** so you can add a service and an integration.

## 3. Add an AI model (optional)

Squire answers from your incident data without a model. A model lets it write summaries and answer in full
sentences.

1. Choose a provider, paste the API key and choose what the model may read:
   - **Incident text and names** lets it read titles, notes and who wrote them. Summaries and drafts need this.
   - **Titles and service names only** is more private; summaries and drafts are not available.
2. Select **Add and test**. The guide saves the provider, turns AI on and checks the connection.

The key is stored encrypted and is not shown again. Select **Skip for now** to do this later under
**Settings → Intelligence → Assistant**.

## 4. Switch on, after about a week

**Settings → Intelligence** shows where you are:

| Stage    | What it means                                                                                 |
| -------- | --------------------------------------------------------------------------------------------- |
| Learning | Watching. Nothing changes for your team.                                                      |
| Showing  | Your team sees similar incidents, likely causes and triage hints. Noise controls still watch. |
| Acting   | Noise controls are applied before anyone is paged. High-urgency alerts always page.           |

While learning, the page shows how many decisions it has watched against the 50 it needs. Select **Show
suggestions to my team** at any time: suggestions never change who is paged. When there is enough evidence
(at least 50 watched decisions in 7 days, and at most 2% marked wrong), the same button also turns noise
controls on. Until then noise controls stay in Watch only.

## Verify it worked

- **Settings → Intelligence → Setup status** shows the stage you chose and, under **What is on**, each switch.
- After **Start watching**, the global policy is Watch only and noise controls are Watch only.
- After **Show suggestions to my team**, open an incident: **Insights** shows similar incidents.

## Change or undo

Every change is a versioned policy. Open **Orchestration versions** (noise controls) or **Policy history**
(Engine) and select **Roll back**. To stop everything, turn off the Intelligence master switch under
**Engine → General**.

## Next steps

- [Noise controls](../operate/intelligence/noise-controls)
- [Roll out Intelligence to production](../operate/intelligence/production)
