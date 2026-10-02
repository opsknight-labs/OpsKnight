# Documentation certification

Run `npm run docs:certify` after discovery, reference generation, integration
generation, and runtime journeys. The command executes the documentation
contracts and writes exact counts to
`generated/docs-certification/current.json`.

The report deliberately distinguishes a passing documentation corpus from a
published release. `docs/versions.json` lists 2.0.0 as released, so current
certification records must report `releaseState: released`. Website builds
remain gated to versions declared in that file.

Runtime journey status refers to the committed evidence set produced by
`npm run docs:journeys`. CI or a release operator must rerun that command against
the intended immutable image before changing the release state.
