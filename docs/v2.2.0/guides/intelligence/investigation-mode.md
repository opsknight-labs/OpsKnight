---
title: Investigate incidents with Squire and route models by task
description: Turn on investigation mode, choose which model handles planning and conclusions, and read an investigation answer.
type: how-to
product_area: intelligence
audience: [responder, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Enable investigation mode, configure per-capability model routing, and interpret ranked hypotheses.
verification:
  level: test
  verified_at: 2026-11-09
  evidence:
    [
      src/lib/intelligence/squire/investigation,
      src/lib/intelligence/squire/tools-incident.ts,
      src/lib/intelligence/ai/routing.ts,
      tests/unit/intelligence-squire-investigation.test.ts,
      tests/integration/intelligence/squire-investigation.test.ts,
      tests/integration/intelligence/squire-incident-tools.test.ts,
      tests/integration/intelligence/ai-routing.test.ts,
    ]
---

# Investigate incidents with Squire and route models by task

Investigation mode lets the assistant work through a diagnostic question in several steps: it decides
what to check, reads several sources at once, and answers with ranked hypotheses tied to the evidence it
read. It needs AI to be enabled with at least one provider cleared for Personal data. It is **off by
default**.

## Turn it on

1. Open **Settings → Intelligence → Assistant & AI** (requires the Intelligence manage permission).
2. In **Investigation and model routing**, select **Investigation mode**.
3. Optionally route capabilities (below), then select **Save investigation and routing**.

The change is audited as `intelligence.ai.routing.updated`. If someone else saved AI settings since you
opened the page, the save is refused; refresh and try again.

## Ask for an investigation

Ask a diagnostic question, usually on an incident page:

- "Why is checkout returning 500s?"
- "What caused this incident?"
- "Investigate the root cause."

Questions that ask for a fact or an action ("who is on call?", "acknowledge this") are answered the usual
way. A vague symptom question on an incident ("is the latency spike related to the deploy?") is checked by
a quick classification call first.

While it works, the assistant shows **Investigation · N steps** above the answer. Expand a step to see the
reads it ran; a read you are not permitted to make shows as failed. The list folds away when the answer
is complete.

## Read the answer

- **Ranked hypotheses**, most likely first, each with a confidence (the model's estimate, not proof) and
  links to the evidence that supports it. Only sources read during this answer can be cited; an
  explanation that cited nothing it read is left out and counted.
- **Next checks** to confirm or rule out the top hypotheses.

The assistant never changes anything during an investigation. To act, ask for the action afterwards and
confirm the card as usual.

### Partial answers

An investigation stops early when it reaches 12 steps, its per-question token budget (60,000 tokens, or a
tenth of the daily budget if that is smaller), or you cancel it. You then get **Investigation (partial)**:
what was checked, the evidence read, and suggested next checks. No cause is concluded from a partial
answer. If the model is unavailable before anything is read, you get a basic-mode answer instead.

Each planning step is a separate model request, so per-person request limits and daily budgets apply.

## What the assistant can read

Besides the existing tools, the assistant can read, always with your own permissions:

| Tool               | What it returns                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- |
| Alert payload      | One alert of an incident you can see, pruned, with credentials redacted             |
| Runbook steps      | Published steps of a runbook you can see (never step configuration)                 |
| Service objectives | Active objectives of a service you can see and their current attainment             |
| Incident analytics | Counts, mean time to acknowledge and resolve, noisiest services, over up to 30 days |
| Escalation policy  | Steps of a service's policy; schedules you cannot open stay anonymous               |

## Route models by task

Each capability can prefer one provider, and optionally a specific model on it:

| Capability                                | Used for                                              | Typical choice       |
| ----------------------------------------- | ----------------------------------------------------- | -------------------- |
| Assistant conversation                    | Ordinary answers                                      | Your default model   |
| Summaries                                 | Summarising earlier turns of long saved conversations | A small model        |
| Investigation conclusions                 | Ranked hypotheses                                     | Your strongest model |
| Postmortem drafts                         | Draft with AI                                         | A strong model       |
| Classification and investigation planning | Frequent, short planning calls                        | A small, fast model  |

Leave a capability on **Priority order** to use the provider list. A routed provider is tried first; if it
is unavailable, failing, or not cleared for the data in the request, the normal priority order takes
over. Routing never sends data to a provider whose data class, region or external-fallback settings would
not otherwise allow it. The model field is sent to the provider exactly as typed.

## Long conversations

With saved history on, the last ten turns are replayed as before. Earlier turns are now summarised (by the
Summaries route when AI is on, or by a short built-in digest) instead of being dropped. The incident
briefing always stays first.
