# Security advisory template

Maintainers can start a draft in the repository's GitHub Security → Advisories area. Use a private advisory fork for undisclosed fixes where available; verify access before adding collaborators. The public report form is usable only when private vulnerability reporting is enabled. Keep the fallback channel in [SECURITY.md](../../SECURITY.md) available.

Copy the fields below into a restricted draft. Remove private case notes before publishing.

- **Title and advisory/CVE ID:**
- **Description:** concise defect and affected component.
- **Affected versions:** exact tested ranges; distinguish confirmed and suspected.
- **Severity:** Critical / High / Medium / Low / None, with context.
- **CVSS:** version, vector, score and scoring rationale; pending if not assessed.
- **Attack requirements:** authentication, role, configuration, exposure and prerequisites.
- **Impact:** confidentiality, integrity and availability; identify uncertainty.
- **Exploitation:** confirmed / suspected / not observed; do not equate not observed with impossible.
- **Workaround:** steps, limits and operational impact, or explicitly none known.
- **Fixed versions:** exact releases, source commits and upgrade instructions.
- **Verification:** regression tests and release evidence references safe for publication.
- **Credit:** reporter's approved attribution, or anonymous.
- **Disclosure date:** UTC, agreed coordination timeline and references.
- **Contact:** private follow-up route from the security policy.

Restricted case fields: coordinator/backup, receipt and awareness times, deployment/customer evidence, applicability decisions, reporting deadlines and receipts, review approvals, artifact locations, retention owner and post-incident actions. Do not publish these automatically.
