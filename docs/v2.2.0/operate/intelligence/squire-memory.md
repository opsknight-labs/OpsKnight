---
title: Squire knowledge memory and proactive help
description: Turn on Squire's knowledge index, curate learned service facts, and opt services into proactive briefings, stakeholder-update nudges and postmortem drafts.
type: how-to
product_area: intelligence
audience: [operator, administrator]
reader:
  status: SOURCE_VERIFIED
  task: Let Squire search what the organisation already learned and help responders proactively, and turn it off again.
verification:
  level: test
  verified_at: 2026-11-08
  evidence:
    [
      src/lib/intelligence/memory,
      src/lib/intelligence/squire/tools-knowledge.ts,
      tests/unit/intelligence-squire-knowledge.test.ts,
      tests/integration/intelligence/squire-knowledge.test.ts,
      tests/integration/intelligence/squire-proactive.test.ts,
      tests/components/squire/SquireMemoryUi.test.tsx,
    ]
---

# Squire knowledge memory and proactive help

Squire can search what your organisation already learned (postmortems, resolution notes, incident notes,
runbook steps and facts a person confirmed about a service) and can help responders without being asked:
a briefing when an incident opens, a reminder to update stakeholders, and a postmortem draft when it is
resolved. All of it is **off after upgrade** and works without an AI provider. Nothing here runs on the
paging path or changes an incident on its own.

Intelligence must be enabled (**Settings → Intelligence**) and the intelligence lane must be running.

## Turn on the knowledge index

1. Open **Settings → Intelligence → Assistant & AI → Knowledge memory**, or go to
   `/settings/intelligence/ai/memory`. You need the Intelligence manage capability.
2. Select **Build Squire's knowledge index** and save. The change is audited and uses a revision check, so
   two administrators cannot overwrite each other.
3. The intelligence lane fills the index in the background, about every 5 minutes, in small batches. The
   page shows how many passages of each kind are indexed.

What is indexed:

| Source           | What is kept                                                                    |
| ---------------- | ------------------------------------------------------------------------------- |
| Postmortems      | Summary, root cause, resolution and lessons, split into short passages          |
| Resolution notes | The note written when an incident was resolved                                  |
| Incident notes   | Notes of 20 characters or more                                                  |
| Runbooks         | Step names and descriptions of the published version (never step configuration) |
| Service facts    | Only facts a person confirmed (see below)                                       |

Credentials are removed before anything is stored. Services whose intelligence policy is **Off** are not
indexed, and passages from such services are removed. Incident-linked passages follow the fingerprint
retention.

### How search respects permissions

When Squire answers in AI mode it can call `search_knowledge`. Every passage is checked against the record
it came from (incident, postmortem, runbook or service) through the asking person's own permissions, and is
cited so the person can open the source. Search is lexical (full text, then trigram for typos) and always
works; when an embedding provider is configured under **Assistant & AI**, results are also re-ranked by
meaning.

### Turn it off

Clear the switch and save. Squire stops searching immediately, and the retention sweep removes every
derived passage in bounded batches. Confirmed service facts are kept until someone removes them.

## Learned service facts

During an AI investigation Squire may suggest remembering one durable fact about the incident's service,
for example "Failover to the secondary region takes about 4 minutes." The suggestion appears as a normal
proposal card and is saved only when you confirm it.

- Only people who may curate the service's knowledge see and can confirm the card: Intelligence managers,
  people who may update the service, and members of the owning team who may give intelligence feedback.
- Text that looks like a credential is refused, not saved.
- A service holds at most 50 facts.

To review or remove facts, open **Settings → Intelligence → Per-service policies**, expand the service and
choose **Squire: proactive help and learned facts** (`/settings/intelligence/services/<id>/squire`).
Removal is audited and works even while the index is off.

## Proactive Squire for a service

On the same per-service page, under **Proactive Squire**, choose any of:

| Switch                                   | What happens                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Briefing when an incident opens          | After the first analysis (or 5 minutes without it), a briefing appears on the incident page: summary, similar incidents, a likely change and a suggested runbook. Only for incidents opened in the last 6 hours.      |
| Stakeholder-update nudge after N minutes | When an open incident had no note or status-page update for N minutes (5 to 1440), the incident page shows a reminder with a draft update. One reminder per quiet period; it disappears when someone posts an update. |
| Postmortem draft on resolve              | When an incident is resolved and has no postmortem, a draft appears on the incident page. It is never saved or published; open the postmortem editor to use it.                                                       |

Every switch defaults off and applies only while the service's intelligence policy is not **Off**.

**With AI off** the content is written by fixed rules from the incident's own facts and the engine's
findings. **With AI on** the briefing and nudge use the incident summary prompt and the draft uses the
postmortem prompt, under the background identity `squire:proactive`, within the normal AI budgets; if the
model fails, the rule-based text is kept. AI text is shown only to viewers who may read every record the
model saw; everyone else sees the rule-based version.

### Why it is not a timeline note

Squire never writes to an incident except when a person confirms an action. Proactive output is therefore
shown in a **Squire** card on the incident page instead of being posted to the timeline, and it is removed
with finding retention.

## Monitor

| Metric                                                  | Meaning                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `opsknight_squire_knowledge_chunks_written_total{kind}` | Passages written or rewritten by the sync                |
| `opsknight_squire_proactive_notes_total{kind,mode}`     | Briefings, nudges and drafts written, by `BASIC` or `AI` |

The sync and proactive jobs appear in the intelligence work queue as `SYNC_KNOWLEDGE`,
`SQUIRE_PROACTIVE_SCAN` and `SQUIRE_PROACTIVE`, with the usual retries, dead letters and quarantine.

See also [Run OpsKnight Intelligence in production](./production.md) and
[Use Squire without an AI provider](../../guides/intelligence/basic-mode.md).
