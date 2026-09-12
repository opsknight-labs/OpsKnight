# OpsKnight License Transition

OpsKnight's current development line is intended to be distributed under the **GNU Affero General Public License version 3 only (`AGPL-3.0-only`)** beginning with the first release that explicitly ships this license. The complete AGPL terms are in [`LICENSE`](LICENSE).

## Release boundary

This change is **not retroactive**. OpsKnight `v1.x` releases and any other release, tag, commit, container image, chart, or source archive that was distributed under Apache License 2.0 keep the rights and conditions that accompanied that artifact.

In particular, a released `v1.4.0` or `v1.4.0-hotfix` artifact does not become AGPL merely because the `main` development branch later adopts AGPL.

The first AGPL release should use a new version boundary and its release notes, source archive, container metadata, package metadata, documentation, and website must all identify `AGPL-3.0-only` consistently.

## Material received under Apache-2.0

OpsKnight historically received and distributed material under Apache License 2.0. Apache 2.0 is a permissive license with redistribution conditions that must continue to be respected for material received under it.

For that reason, the historical Apache 2.0 license text is retained at [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt). Keeping that text does **not** make Apache-2.0 an alternative license for new material contributed after this transition; it preserves the notices and terms relevant to material previously received under Apache-2.0.

Any copyright, patent, trademark, attribution, or other notices that must be retained for incorporated material must remain intact. If provenance review identifies a third-party `NOTICE` requirement or other attribution obligation, that notice must also be carried forward in source and release artifacts as required by its license.

## Why AGPL-3.0-only

OpsKnight is network server software. AGPLv3 keeps the community edition open source while requiring operators of modified versions that users interact with over a network to offer those users the corresponding source code as required by section 13 of the license.

`AGPL-3.0-only` is intentional: this repository does not automatically opt into future versions of the GNU Affero General Public License.

## Source availability for network deployments

A modified network deployment covered by AGPLv3 section 13 must prominently offer remote users access to the Corresponding Source of that deployed version. Operators of forks must ensure that any source-code link or offer points to the source corresponding to **their deployed build**, not merely to the upstream OpsKnight repository.

Official OpsKnight release artifacts should therefore link to an immutable release/tag or source archive that corresponds to the shipped build. Container images should also carry the applicable license and source-repository metadata, and the license files must be present in distributed artifacts where appropriate.

## Commercial and enterprise software

The AGPL license in this repository applies only to material actually distributed under it. Separate enterprise modules, hosted services, trademarks, brand assets, support agreements, or other commercial offerings are not automatically licensed under AGPL merely because they interoperate with OpsKnight.

However, calling a module "enterprise" or putting it in another repository does not by itself determine whether it is a separate work for copyright/license purposes. If OpsKnight later offers proprietary modules or a commercial alternative license for the same codebase, the project should obtain legal review of the architecture and contributor-rights model before shipping it.

Any separately distributed commercial software must state its own license terms.

## Trademarks

Software licensing and trademark rights are separate. See [`TRADEMARKS.md`](TRADEMARKS.md) for the OpsKnight name and branding policy.

## Contributions and future dual licensing

New contributions are accepted under the contribution terms in [`CONTRIBUTING.md`](CONTRIBUTING.md). Those terms permit distribution under `AGPL-3.0-only`; they do not transfer contributor copyright or automatically grant OpsKnight a separate proprietary relicensing right.

If the project expects to **dual-license the same community code** in the future (for example, AGPL Community plus a proprietary commercial license), it should adopt an explicit contributor agreement or other rights model before relying on that ability for third-party contributions. A CLA is a separate governance decision and should not be implied by this transition.

## Pre-merge rights review

Before this transition is merged and released, the maintainers should review contribution provenance and confirm that the project has the rights needed for the intended distribution while continuing to satisfy the conditions of licenses under which existing material was received. Contributor consent may or may not be necessary depending on the provenance and applicable grants; this document does not make that legal determination.

This document is explanatory only and is not legal advice. If it conflicts with an applicable license, the applicable license controls.
