# Release security checklist

Complete per release. Record release owner, independent reviewer, version/tag, source SHA, UTC date and evidence locations. A checked box must point to an observed result, not merely a workflow definition. This checklist is manual in phase one.

- [ ] Typecheck, changed-file lint and relevant tests pass.
- [ ] Applicable vulnerability/static/secret scans produced reviewable results.
- [ ] Known security findings, upstream advisories and accepted exceptions were reviewed.
- [ ] SBOM generated, validated, non-empty and associated with the source version/commit.
- [ ] Final container digest and available image SBOM/provenance were verified.
- [ ] Source SBOM and image SBOM are distinguished; they describe different inventories.
- [ ] Required release artifacts and scan results were retained in the approved evidence store.
- [ ] Supported-version documentation and any EOL decision are accurate.
- [ ] Security-relevant release notes, affected/fixed ranges and upgrade/rollback guidance are ready.
- [ ] Vulnerability disclosure timing, reporter credit and required communications were reviewed.
- [ ] Applicable CRA reporting and other notification decisions were recorded by the responsible owner.
- [ ] For database-affecting releases, restore and upgrade evidence was reviewed.

Record missing evidence as a gap with an owner and decision. Existing best-effort scanners do not establish a release gate. Phase two will address security finding enforcement and exception workflows.
