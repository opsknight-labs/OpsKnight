---
title: Evaluate controls, investigate drift, and export evidence
description: Operate the Compliance Control Center without treating product evidence as automatic certification.
type: how-to
product_area: compliance
audience: [administrator, operator]
reader:
  status: READER_COMPLETE
  task: Evaluate compliance controls, investigate drift, and export verifiable evidence.
verification:
  level: source
  verified_at: 2026-10-01
  evidence: [src/components/settings/compliance/control-center/ComplianceControlCenter.tsx, src/components/settings/compliance/control-center/MonitoringStatusCard.tsx, src/components/settings/compliance/control-center/DriftDetailDrawer.tsx, src/components/settings/compliance/control-center/EvidenceView.tsx, src/components/settings/compliance/control-center/ExportEvidencePackageModal.tsx]
---

# Evaluate controls, investigate drift, and export evidence

## Before you begin

Use an authorized administrator/operator identity, define the audit scope, and
prepare a protected destination for evidence archives.

1. Review posture and monitoring recency.
2. Investigate failing controls and drift.
3. Inspect evidence integrity.
4. Preview and export only the required scope.

## Open the feature

Open **Settings -> Security & Compliance**.

## Configure and evaluate current posture

Open **Settings -> Security & Compliance**. On **Overview**, record the runtime
revision, monitoring recency, failing/unknown controls, open drift, and evidence
integrity warnings. Open **Controls**, select a control, and inspect its observed
state, evaluation time, supporting evidence, and framework mappings. A mapping
means the evidence is relevant; it does not satisfy an entire external standard.

Trigger a monitoring sweep only when authorized. Wait for the queued run to
finish, then compare its new evaluations to the earlier baseline. Do not report
a stale passing observation as current state.

## Investigate drift

Open **Control Drift**, select the episode, and compare baseline and current
evaluations, evidence, and mapped requirements. Assign remediation outside the
control center where appropriate. Acknowledge drift only to record that it was
seen; acknowledgment does not make the control compliant. Verify remediation
with a later passing evaluation and reviewable evidence.

## Inspect evidence integrity

Open **Evidence Ledger**. Search and filter by control, evidence type, and
integrity result. Review collection time, source, payload summary, and digest.
An integrity mismatch is an investigation condition: preserve the record,
restrict export, and inspect storage/key/runtime history rather than deleting it.

## How evaluation works

Evaluations capture observed technical state; evidence supports the observation,
and framework mappings relate it to requirements without granting certification.

## Export a package

Select **Export Evidence Package**. Choose all controls, selected controls, or a
framework; then choose a current snapshot or a historical date range. Preview
the counts and scope before export. The downloaded archive includes observed
technical state, mappings, supporting evidence, and SHA-256 integrity manifests.

Store the archive as sensitive audit material. Record the product revision,
export time, scope, retention owner, and external evidence that OpsKnight cannot
collect. Recalculate/verify digests in the review process; never interpret a
valid digest as proof that the underlying control passed.

## Verify the result

Confirm archive counts match the preview and that manifest, digests, revision,
scope, and evaluation window are present.

## Remove or undo

An export cannot be recalled. Quarantine an incorrectly scoped archive under
your evidence-handling policy and generate a corrected package.

## Troubleshooting

- **No controls/evidence:** verify authorization, runtime evaluation health, and
  monitoring completion.
- **Export unavailable:** the signed-in role lacks export capability.
- **Historical export is empty:** confirm time range and control/framework scope.
- **Integrity mismatch:** preserve evidence and investigate; do not regenerate
  an archive merely to hide the mismatch.
- **Drift remains after acknowledgment:** expected; only a later evaluation can
  demonstrate remediated state.

## Next steps

- [Compliance evidence concepts](../../concepts/compliance)
- [Audit Logs](../administration/audit-logs)
