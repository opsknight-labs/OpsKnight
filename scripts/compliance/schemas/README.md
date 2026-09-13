# CycloneDX validation schemas

Unmodified schemas from the CycloneDX specification's `1.5` tag:

- https://github.com/CycloneDX/specification/blob/1.5/schema/bom-1.5.schema.json
- https://github.com/CycloneDX/specification/blob/1.5/schema/spdx.schema.json
- https://github.com/CycloneDX/specification/blob/1.5/schema/jsf-0.82.schema.json

Upstream license is included in LICENSE. Vendoring makes CI validation independent of network schema lookup and prevents an SBOM from selecting an arbitrary remote schema. Only CycloneDX 1.5 is supported by this source-inventory validator. Review a generator/schema upgrade together. See [npm SBOM documentation](https://docs.npmjs.com/cli/v10/commands/npm-sbom/).
