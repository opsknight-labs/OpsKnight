---
title: Privacy requests and retention
description: Data-subject workflows, retention controls, holds, export, and erasure boundaries.
type: concept
product_area: privacy
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/privacy/requests.ts, src/lib/retention-policy.ts]
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
immediate deletion. Encryption-key retirement, database backups, third-party
systems, and exported artifacts each have their own lifecycle and must be
included in the deployment's privacy procedure.

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
