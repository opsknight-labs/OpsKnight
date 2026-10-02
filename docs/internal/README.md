# Internal documentation

## Website preview

The website remains downstream. To sync the released documentation tree into a
local website checkout, run:

```sh
npm run docs:sync -- ../opsknight-website
```

Top-level section indexes carry numeric `order` metadata understood by the
website sidebar generator. Normal CI sync remains release-gated and publishes
versions listed in `releasedVersions` in `docs/versions.json`.

This tree indexes engineering, compliance, certification, and release material
that is not part of the public product documentation navigation.

The release-gated sync copies only directories listed in
`docs/versions.json`. It does not publish this tree.

## Audience boundaries

- [Architecture](./architecture/README.md) — implementation contracts and design decisions.
- [Compliance](./compliance/README.md) — control mappings and evidence contracts.
- [Certification](./certification/README.md) — generated release and quality evidence.
- [Engineering](./engineering/README.md) — contributor-only operating material.
- [Release](./release/README.md) — release readiness and transition records.

Historical versioned documents remain in place so old links remain valid. A
historical location does not make an audit or engineering record public product
guidance.
