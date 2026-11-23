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

1. Open **Settings → Intelligence → Assistant** (requires the Intelligence manage permission).
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

With the keyboard, Tab to the list heading or a step and press Enter or Space to expand or fold it. A
screen reader announces the step in progress and each read as it starts, then that the answer is
complete.

## Read the answer

- **Ranked hypotheses**, most likely first, each with a confidence (the model's estimate, not proof) and
  links to the evidence that supports it. Only sources read during this answer can be cited; an
  explanation that cited nothing it read is left out and counted.
- An **evidence level** for each hypothesis: speculation, matches a past pattern, supported by evidence,
  validated by system state, or validated with alternatives ruled out. The model is asked to try to
  disprove its leading hypothesis first.
- **Ruled out**: hypotheses the evidence contradicts, kept (struck through) so you can see what was
  checked.
- **Result: inconclusive** at the top when nothing read so far establishes a cause.
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

## Automatic investigations

Squire can start one investigation by itself when a high-urgency incident opens, so the diagnosis is
waiting when responders arrive. It is **off by default** and set per service:

1. Open the service's Squire settings (**Settings → Intelligence → Services →** the service **→ Squire**).
2. Select **Investigate high-urgency incidents automatically**, then **Save**. The change is audited with
   the service's other proactive settings; if someone saved them since you opened the page, refresh and
   try again.

It runs only while AI, the assistant and **Investigation mode** (above) are on, and a provider is cleared
for Personal data; otherwise nothing is written. The first investigation starts within 30 minutes of the
incident opening; after that it is only updated (see **Live updates**). Every run counts toward the
service's daily limit of AI-written proactive notes and the usual daily token budget.

**Whose permissions.** No person asked, so the investigation reads as a read-only member of the incident's
owning team (the incident's team, or its service's team): public incidents, services, metrics, schedules
and connections that team can see, nothing else, and it can never change anything. Private incidents and
incidents with no owning team are not investigated.

The result appears on the incident page as **Squire investigated this**, with the same diagnosis, evidence
levels and **Ruled out** section as a chat investigation. Each time someone opens the page, every source
the investigation read is checked again with that person's permissions; if they cannot open one of them,
the diagnosis is withheld from them. To dig further, use **Ask Squire** on the same card.

### Live updates

While the incident stays open, Squire looks at it again when something new happens: a new alert on the
incident, a new note, a status, urgency or escalation change, a runbook that finished or failed, or a new
deploy or change on its service. It then runs the investigation again with its previous conclusion as
context, re-rates the earlier hypotheses on the new evidence and replaces the diagnosis on the card.

- **When.** At most once every 10 minutes per incident, only after at least one new signal, and at most
  12 times per incident in any 24 hours (a run that produced nothing counts too, so a failing provider is
  not retried every minute). Each run uses the same service limit and token budget as the first one.
- **What changed.** Each update adds a short digest under **Updates** on the card: what triggered it, a new
  leading hypothesis, hypotheses that became more or less likely (10 points or more), ones newly ruled
  out or no longer supported, new evidence and new next checks. The card keeps the last 5 digests. A
  digest is shown only to people who can open every source behind both conclusions it compares.
- **When it stops.** Updates stop as soon as the incident is resolved, the service's switch is turned off,
  or Investigation mode or AI is switched off.

If the incident has a Slack or Microsoft Teams channel, the conclusion is posted there and edited in place
on each update, and each digest with something new in it is posted as a reply under it. The briefing is
posted to the channel the same way when it is written.

## Did the fix hold?

When you resolve an incident through Squire (an incident action, or the resolve change from the
operation catalog, on its own or in a plan) or start a runbook through Squire, Squire checks back 10
minutes later and writes the result on the incident:

- **Holding:** no new alerts in the window.
- **Not holding:** for example "3 new alerts since resolve, the incident reopened, new incident
  "Checkout down again"".

Squire counts new alerts on the incident itself, whether a resolved incident has reopened, and new alerts
and incidents on the same service that share the incident's dedup key or alert fingerprint. When the
incident has neither, any new alert or incident on the service counts. The check needs no AI, so it also
works in basic mode; it runs while intelligence is on for the service.

When the fix is not holding, the person who confirmed it gets an in-app notification that opens the
incident, and the incident's insights strip shows **Fix not holding**. The notification and the incident
card mention only incidents that the reader may open; the channel post gives counts only, never other
incidents' titles. A runbook check starts from when the runbook was started, not when it finished.

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
