# README visual workflow

The repository homepage uses real OpsKnight surfaces captured from the isolated documentation runtime. It does not use customer data, production credentials, or recreated product UI.

Run `npm run readme:refresh` to capture and compose the assets.

`readme:capture` starts the pinned documentation image, seeds synthetic fixtures, and captures desktop Chromium plus iPhone/WebKit routes into `generated/readme-captures/`. `readme:assets` composes those captures with the repository logo into `public/readme/hero.webp` and `public/readme/mobile.webp`.

The committed workflow consists of `playwright.readme.config.ts`, `tests/readme/`, `scripts/readme/compose-assets.mjs`, and `public/readme/`. After a material UI change, refresh and visually inspect the assets before committing. The product, deployment manifests, and 2.0 documentation remain authoritative; README claims should stay stable and link to those sources for operational detail.
