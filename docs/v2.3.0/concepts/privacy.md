---
title: Privacy requests and retention
description: Data-subject workflows, retention controls, holds, export, and erasure boundaries.
type: concept
product_area: privacy
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/privacy/requests.ts, src/lib/retention-policy.ts, src/lib/privacy/erasure/audit-pseudonymise.ts]
---

# Privacy requests and retention

Privacy requests are identity-bound workflows with explicit status, verification,
assignment, export, and erasure evidence. Retention policies govern eligible data;
holds prevent selected records from being removed. Export availability does not
imply erasure eligibility, and erasure must preserve legally or operationally
required references and immutable audit evidence.

Verification establishes that the requester may act for the subject; assignment
establishes who owns the workflow. Neither is evidence that every discovered
record may be disclosed or deleted. Preview the affected resources and resolve
manual-review flags before executing erasure.

A retention hold takes precedence over scheduled cleanup for the resources in
scope. Releasing a hold restores normal eligibility but does not promise
immediate deletion. A hold on a user also keeps that person's audit trail through
retention cleanup: the audit entries they performed and the entries about their
account. Audit entries that are identified only by an email address (failed
sign-ins and other sign-in attempts) carry no user and are not covered by the
hold. Encryption-key retirement, database backups, third-party
systems, and exported artifacts each have their own lifecycle and must be
included in the deployment's privacy procedure.

Erasure keeps the audit trail but pseudonymises the person's own entries: the
ones they performed, the ones keyed by their email address (failed sign-ins), and
the ones about their account. Each keeps its action, entity type and timestamp;
the IP address is cleared, and their email, name, phone number and the IP
addresses seen on those entries are replaced with `[erased]` wherever they appear
in the entry's details. An entry keyed by the person's email address also loses
that address from its entity ID, so an audit search for the email finds nothing. Entries that a hold on another user protects are left as
they are (including their email columns), and a hold on the person blocks the erasure. Entries that only mention
the person inside someone else's free text, values written in a different form
(a misspelt name, a reformatted phone number), and logs outside the database
cannot be attributed and are covered by the manual-review step.

In incident text, erasure replaces the person's email, phone number and full name
(a space and at least 5 characters; a one-word name is never matched) in the notes
they wrote and in timeline entries on incidents they took part in: they wrote a
note, were the assignee or acknowledged it, watched it, held an incident role, or
were added to its war room. Email addresses match only when they are not the end
of a longer address. The scrub is bounded so the erasure always completes: at most
1,000 incidents (newest first) and 5,000 notes and 5,000 timeline entries per
erasure. If a bound is hit, the completion audit entry records
`incidentTextTruncated: true` and the rest needs manual review.

Preserve request transitions, operator decisions, export generation, erasure
results, and hold changes as audit evidence. Avoid copying subject data into
free-form notes when a stable record reference is sufficient.

## Intelligence and assistant data

The privacy data registry now lists the data the intelligence engine and the
assistant keep. Each area is off by default unless noted.

- **Intelligence** (fingerprints, correlation, findings, feedback, dependencies,
  change events, noise-control decisions, metric anomalies): derived data only;
  incidents and alerts are never modified. Retention is set per entity in the
  UI (defaults: fingerprints 730 days, correlation 365, findings and change
  events 365, feedback 730). Incident-linked rows are deleted with the
  incident, and a bounded sweep runs even while intelligence is off.
  Fingerprint templates are masked copies of incident titles and can still
  hold identifiers people typed.
- **AI assistant**: conversations stay in the browser unless an administrator
  turns on saved history. Saved history is encrypted, visible only to its
  owner, capped at 50 conversations per person, deleted after the idle
  retention (1–365 days, default 30), deleted when history is turned off and
  deleted with the person. Audit entries record metadata only, never prompts
  or answers. Text sent to the AI provider is redacted for credential-shaped
  values first.
- **Squire memory**: the knowledge index is a redacted, rebuildable copy of
  postmortem, note and published runbook text. Turning it off removes every
  derived chunk. Confirmed service facts stay until removed or the service is
  deleted; the approver link is cleared on user erasure.
- **Operations insights**: derived counts and short facts, recomputed daily and
  never sent to an external provider. Insights about a person and that
  person's daily page counts are deleted once the person is deleted.
- **Escalation step attempts**: always on, deleted with the incident, and read
  only by a daily rollup that stores counts per policy, step and hour, never
  user ids.

Stored alert payloads, labels and resource keys and on-call coverage days are
also listed. Alert payloads stay untrusted and follow alert retention.
