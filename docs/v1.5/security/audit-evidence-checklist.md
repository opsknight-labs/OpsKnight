# Audit evidence checklist

This checklist prepares evidence for a readiness assessment. It is not a certification or a
substitute for advice from the chosen auditor, customer, regulator, or legal counsel.

## Product and change assurance

- Preserve protected-branch configuration, required reviews, signed release metadata, CI results,
  security scan reports, dependency inventory/SBOM, migration review, and production approval.
- Link every deployed image digest to its source commit and retain rollback instructions.
- Record exceptions with owner, business justification, compensating control, and expiration date.

## Access control

- Export current administrators, responders, OIDC configuration, identity-provider MFA policy,
  joiner/mover/leaver samples, quarterly access reviews, and terminated-session evidence.
- Preserve evidence that production database, cluster, secret store, and CI access use separate
  least-privileged roles.

## Security operations

- Retain vulnerability scan results, remediation SLAs, penetration-test report, security incidents,
  tabletop exercises, dependency updates, and secret/key rotation records.
- Document inbound and outbound network boundaries, webhook signing, TLS, firewall policy, and
  alert ownership.

## Availability and recovery

- Retain monitoring availability reports, capacity alerts, load-test results, pod/node/database
  failover exercises, backup reports, restore-drill evidence, and achieved RPO/RTO measurements.
- Record the on-call owner and corrective actions for missed objectives.

## Data governance

- Document data classification, retention/deletion policy, customer export/deletion handling,
  backup retention, encryption-key custody, subprocessors, and data residency.
- Sample audit logs and incident history to prove actor attribution and retention behavior.

## Organizational controls still required

The repository cannot provide employee screening, security training, vendor review, risk committee
minutes, legal agreements, insurance, physical security, customer commitments, or an independent
auditor's opinion. Assign these controls to named organizational owners before claiming readiness
for SOC 2, ISO 27001, or another framework.
