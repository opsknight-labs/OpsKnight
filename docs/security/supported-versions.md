# Supported versions and end of life

The existing project policy provides security updates for the **latest major version**. The checked-in package currently identifies the 1.x major line. Operators should install the latest stable patch in that supported major; versioned documentation and development branches are not support commitments.

- Current major (1.x): security maintenance targets the latest stable release in this line.
- Earlier major/pre-1.0 releases: unsupported under the existing policy; upgrade to the supported line.
- Older minors or patches in the supported major: upgrade is the normal remediation. No separate per-minor backport promise is established.
- Prereleases and source snapshots: development artifacts, without a stable-release support commitment.

Use the [published releases](https://github.com/opsknight-labs/OpsKnight/releases) and each security advisory to identify the actual latest release and affected/fixed versions. A branch name, container `latest` tag or package version alone is not evidence that a release has shipped.

## Release and EOL decisions

Before each major release, maintainers must review this policy and publish the supported line, support start/end decisions, update channel and any migration/backport limitations. Notify users of an EOL decision through release notes and security documentation, with migration guidance. Keep the decision and communications as evidence.

A fixed support duration, future EOL date and guaranteed multi-year backport program have **not** been established. This is an explicit CRA readiness gap. The responsible organization must determine any required support period for its product/distribution context; this repository policy does not override applicable law or a separate written support agreement.
