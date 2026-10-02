# Documentation certification

Run `npm run docs:certify` after discovery, reference generation, integration
generation, and runtime journeys. The command executes the documentation
contracts and writes exact counts to
`generated/docs-certification/current.json`.

The report deliberately distinguishes a passing documentation corpus from a
published release. While `docs/versions.json` lists this release as upcoming,
the website build remains release-gated and certification must not claim that
the documentation is publicly released.

Runtime journey status refers to the committed evidence set produced by
`npm run docs:journeys`. CI or a release operator must rerun that command against
the intended immutable image before changing the release state.
