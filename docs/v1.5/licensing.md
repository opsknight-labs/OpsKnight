---
title: Licensing and source availability
description: Understand the AGPL-3.0-only development license, historical Apache releases, network source obligations, forks, and trademarks.
order: 2
---

# Licensing and source availability

OpsKnight's **v1.5/current development documentation line** corresponds to the codebase intended to move to **GNU Affero General Public License version 3 only (`AGPL-3.0-only`)** when the license transition is merged and released.

The repository [`LICENSE`](../../LICENSE) contains the controlling AGPLv3 text. [`LICENSE-TRANSITION.md`](../../LICENSE-TRANSITION.md) explains the transition boundary, and [`TRADEMARKS.md`](../../TRADEMARKS.md) covers the OpsKnight name and branding separately from the software license.

## Older releases stay under their original license

The transition is not retroactive. A release, tag, commit, container image, Helm chart, or source archive already distributed under Apache License 2.0 keeps the rights and conditions that accompanied that artifact.

For example, the published `v1.4.x` line remains Apache-2.0. Changing the license on the development branch does not rewrite the license of those historical artifacts.

The repository retains the historical Apache 2.0 license text at [`LICENSES/Apache-2.0.txt`](../../LICENSES/Apache-2.0.txt) so applicable redistribution and notice obligations for previously incorporated material remain available.

## What AGPL changes

AGPL-3.0-only remains an open-source license. Users may run, study, modify, and redistribute covered code subject to the license terms.

The important difference for a network application is **section 13**: if someone modifies the covered program and lets users interact with that modified version remotely over a computer network, that modified version must prominently offer those users an opportunity to obtain its Corresponding Source at no charge through a standard or customary means.

This means AGPL does **not** ban forks or competing services. Instead, it requires covered modifications used to provide network interaction to remain source-available to those remote users under the AGPL requirements.

## Source links must match the deployed build

A source link should identify the source corresponding to the version actually running.

Official OpsKnight releases should therefore point to an immutable release tag or source archive for that build. A downstream operator running a modified fork must not rely on a link to the upstream OpsKnight repository if that upstream source does not correspond to the deployed modified version.

Release engineering should keep these surfaces consistent:

- repository `LICENSE` and package SPDX metadata;
- release notes and source archives;
- Docker image legal files and OCI license/source labels;
- Helm and other deployment artifacts where license metadata is exposed;
- desktop, mobile, and other interactive product surfaces that provide legal/source information;
- website and documentation copy.

## Forks and the OpsKnight name

The software license and trademark rights are separate.

The AGPL does not grant a fork permission to present itself as the official OpsKnight project or to use OpsKnight branding in a misleading way. Forks and derivative distributions should use distinct product branding unless separate permission has been granted, while truthful descriptive or nominative references remain subject to applicable law.

See [`TRADEMARKS.md`](../../TRADEMARKS.md) for the project policy.

## Enterprise and commercial software

Code actually distributed under AGPL remains subject to AGPL. A separate proprietary Enterprise module or commercial offering must have its own license and a defensible separation from AGPL-covered code.

Simply naming a directory or repository "enterprise" does not by itself determine whether it is a legally separate work. Before shipping proprietary modules tightly integrated with the community codebase, obtain appropriate legal review.

Likewise, the current contribution terms allow new community contributions to be distributed under AGPL-3.0-only but do **not** automatically give OpsKnight a separate proprietary relicensing right over third-party contributions. If the project later wants to dual-license the same community code under AGPL and a proprietary commercial license, adopt an explicit contributor-rights model such as an appropriately reviewed CLA before relying on that capability.

## Before the first AGPL release

Do not publish the first AGPL release until the maintainers have completed the contributor/copyright provenance review described in [`LICENSE-TRANSITION.md`](../../LICENSE-TRANSITION.md) and confirmed that required historical notices and third-party license obligations are preserved.

This page is project documentation, not legal advice. The applicable license text controls if this explanation conflicts with it.
