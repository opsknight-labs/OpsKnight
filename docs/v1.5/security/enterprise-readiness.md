# Enterprise readiness and assurance

OpsKnight is designed to support enterprise deployments, but software features alone do not
constitute SOC 2, ISO 27001, HIPAA, PCI DSS, or other third-party certification. Certification
also depends on the deploying organization's people, processes, infrastructure, evidence period,
and independent audit. Do not describe a deployment as certified unless the applicable auditor
has issued that certification.

## Technical control baseline

An enterprise production deployment must meet all of the following requirements.

### Identity and access

- Configure OIDC/SSO for workforce access and enforce MFA at the identity provider.
- Grant the least-privileged OpsKnight role and review ADMIN assignments regularly.
- Use a trusted reverse proxy and overwrite forwarded client-IP headers at the edge.
- Rotate credentials and terminate active sessions when access is revoked.

### Secrets and encryption

- Configure a stable `ENCRYPTION_KEY`; OpsKnight refuses new provider-secret writes when
  encryption is unavailable.
- Store application, database, OIDC, webhook, and notification credentials in a managed secret
  store. Do not commit them to source control or bake them into container images.
- Use TLS for users, integrations, webhooks, and database connections.
- Test key and credential rotation in a non-production environment before production rollout.

### Data integrity and retention

- Back up PostgreSQL on a documented schedule and perform regular restore drills.
- Apply Prisma migrations before starting a new application version.
- Retain incident history for auditability. A service with incident history must not be deleted;
  archive or disable it instead.
- Define retention periods for audit logs, incidents, alerts, notifications, and backups according
  to contractual and regulatory requirements.

### Network and integrations

- Restrict outbound network access to approved integration destinations where the platform allows.
- Use signed webhooks, unique integration credentials, and regular credential rotation.
- Explicitly map services to public status pages. Private incidents are never eligible for public
  status-page webhook delivery.
- Treat DNS and proxy configuration as a security boundary; block private and metadata networks at
  the infrastructure layer in addition to application SSRF checks.

### Reliability and operations

- Run at least two application replicas for high availability and use PostgreSQL-backed shared
  coordination for rate limits and background work.
- Monitor `/api/health`, authenticated metrics, job failures, notification failures, database
  capacity, and external-provider latency.
- Alert on failed migrations, exhausted background-job retries, notification backlog, and backup
  or restore failures.
- Maintain incident response, disaster recovery, rollback, vulnerability management, and change
  management procedures with named owners.

## Release evidence gate

Before promoting a release, retain evidence that all required checks passed for the exact commit:

1. TypeScript typecheck and lint.
2. Unit and database integration suites.
3. Production container build and vulnerability scan.
4. Static security analysis and secret scanning.
5. Migration test against a representative backup.
6. Backup restore and rollback rehearsal for material schema changes.
7. Manual smoke tests for login, incident creation, acknowledgement, escalation, resolution,
   status-page visibility, notifications, schedules, and administrative changes.

## Shared-responsibility boundary

OpsKnight supplies application controls. The operator remains responsible for identity-provider
policy, network segmentation, host and cluster hardening, database availability, backup custody,
log export and retention, monitoring coverage, employee lifecycle controls, vendor management,
security training, incident response, and audit evidence. These responsibilities should be mapped
to the chosen assurance framework before an external readiness assessment.
