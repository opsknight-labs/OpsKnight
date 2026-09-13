# SBOM and release artifact handling

OpsKnight has distinct source and container inventories. Never substitute a source SBOM for evidence of what an image contains.

## Source inventory validation

[SBOM artifact validation](../../.github/workflows/sbom-validation.yml) generates CycloneDX 1.5 JSON with the maintained CycloneDX npm generator on Node 20, omitting development dependencies. Lockfile-only mode describes resolved production/optional dependencies, including platform alternatives; it is not a byte-for-byte inventory of an installed image. Components are flattened because the current lockfile's deduplicated peer graph otherwise emits references without matching components. `--ignore-npm-errors` tolerates peer-dependency diagnostics while the schema and reference validator still gates the resulting artifact. Install scripts are not executed by this job.

The [validator](../../scripts/compliance/validate-sbom.mjs) canonicalizes npm's `git+https://` repository spelling to the equivalent schema-valid `https://` URL, then checks the vendored CycloneDX schema, non-empty component list, package names/versions/PURLs, unique references, dependency references and root identity against `package.json`. On version tags it also checks `v<package version>`. The manifest records full source SHA/ref, product version, scope and SHA-256 of the exact normalized SBOM bytes. Validation failure fails this job, without adding a dependency-vulnerability severity gate.

Reproduce from the checked-out commit:

```sh
npm ci --legacy-peer-deps --ignore-scripts
mkdir -p reports
npx --no-install cyclonedx-npm --package-lock-only --ignore-npm-errors --omit dev --flatten-components --output-format JSON --spec-version 1.5 --output-file reports/source-sbom.cdx.json
SBOM_SOURCE_SHA="$(git rev-parse HEAD)" node scripts/compliance/validate-sbom.mjs > reports/source-sbom-manifest.json
```

Download `source-sbom-<full SHA>` from the successful workflow's Actions artifacts. GitHub authentication may be required. Retention is requested for 90 days, subject to repository/organization limits and deletion. This is not a permanent public release archive. Release owners must preserve the artifact and manifest in an approved durable release/evidence store and document customer access before claiming ongoing availability. A PR artifact is associated with its tested merge SHA, not automatically the released source.

## Existing scanning SBOM

The [Security Suite](../../.github/workflows/security.yml) also uses Anchore/Syft to generate `reports/bom.json` as CycloneDX, uploaded as `sbom`. Those steps remain best-effort. Do not apply the npm-root validator to this filesystem inventory or assume its format/version and scope equal the source artifact above. Existing scan artifact retention follows repository defaults unless explicitly configured.

## Container SBOM and provenance

The version-tag release step in [docker-image.yml](../../.github/workflows/docker-image.yml) requests BuildKit SBOM attestations and `provenance: mode=max` for the multi-platform image. Development/main channel builds explicitly disable these. The resulting attestations are associated with the OCI image in the registry, not necessarily GitHub release attachments. Verify their presence and digest association after each release; a workflow setting is not proof of successful publication.

Record: released tag, source SHA, workflow run, registry/repository, immutable image index digest, per-platform digests, source SBOM SHA-256, image attestation references, provenance and scan result locations. Use registry tooling (for example Buildx imagetools inspect) against the immutable digest, not a mutable tag. Registry retention and image deletion can remove attestations; the release owner must retain required evidence separately. Inspect provenance for unintended sensitive build metadata before making it available.

The source manifest deliberately does not invent an image digest or claim signed provenance. The manual [release checklist](release-security-checklist.md) connects the two workflows. Automated cross-workflow artifact bundling, permanent public archives and enforceable vulnerability exceptions remain later work.
