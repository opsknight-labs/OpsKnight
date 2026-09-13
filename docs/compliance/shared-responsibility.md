# Shared responsibility

OpsKnight is self-hosted software. Secure source code is only one part of a secure and lawful deployment. This model identifies the usual owner of work; contracts, deployment architecture and applicable law may assign additional duties.

## OpsKnight maintainers

Maintainers own secure development practices, supported source releases, vulnerability intake and remediation, accurate product documentation, release-associated SBOM/provenance where produced, secure defaults, dependency review, and a repository control catalogue. Maintainers must describe limitations without claiming that a customer's deployment is compliant, certified, continuously monitored or safely configured.

The project does not operate an installer's database, identity provider, ingress, backups, log sink or third-party integration accounts. Repository CI and documentation are not operating evidence for those systems.

## Self-hosted operator

The operator owns deployment and day-to-day technical controls: TLS and domain ownership; network segmentation and database security; secrets and encryption-key custody; OIDC/SCIM configuration and IdP-enforced MFA; least-privilege access and reviews; backup encryption, retention and restoration drills; monitoring and log storage; upgrades and vulnerability response; data location/residency; integration configuration and vendor access; effective retention configuration; availability and recovery targets; and preservation of deployment-specific evidence.

The operator must verify actual headers, cookie behavior, scans, SBOM/provenance publication, backups and recovery. Defaults and source settings do not prove effective operation behind a proxy or in a specific environment.

## Deploying organization

The organization acting as controller, processor, employer, customer or manufacturer determines applicability and owns governance: lawful basis and notices; contracts and processing instructions; records of processing; data-subject/privacy request handling; risk and impact assessments; vendor/subprocessor review; international transfers; employee access and training; retention and legal holds; breach and CRA reporting decisions; support-period commitments; security policies; customer communications; and independent assurance or certification.

OpsKnight's phase-one discovery returns direct relation counts. It does not fulfill access, portability, correction, objection or deletion requests. The organization must verify identity, define request scope, review exemptions and deliver results safely.

## Evidence handoff

For each relevant control, maintainers provide source/version references and known gaps; operators add deployment configuration and observed test results; organizations add approvals, applicability decisions, policies, contracts and communications. Store sensitive evidence in a restricted system with retention and legal-hold controls. A public repository path should contain no customer data, credentials, private reports or audit exports.

Review this split when architecture, hosting, contracts or law changes. Record disagreements and exceptions with an accountable owner and review date.
