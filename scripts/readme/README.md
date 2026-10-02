# README visual workflow

The repository homepage uses real OpsKnight surfaces captured from the isolated documentation runtime. Captures contain only synthetic fixtures — no customer data or production credentials — and product UI is never redrawn by hand.

Run `npm run readme:refresh` to capture and compose every asset.

## Capture

`readme:capture` starts the pinned documentation image (or set `DOCS_OPSKNIGHT_IMAGE` to a locally built image of the current revision), seeds synthetic fixtures, and writes to `generated/readme-captures/`:

- `desktop/` — Chromium at 1600×1000 CSS px, 2× device scale: Command Center, incident list and detail, analytics, on-call schedule, escalation policy, service catalog.
- `mobile/light/` and `mobile/dark/` — WebKit iPhone 15 Pro in light and dark color schemes: home, incidents, incident detail, on-call, analytics. The viewport is 393×798 pt so that, with the 54 pt iOS status bar drawn by the composer, each screen matches the device's exact 393×852 aspect without cropping.

To reuse an already running runtime, set `DOCS_EXTERNAL_RUNTIME=true`.

## Compose

`readme:assets` renders HTML stages in Chromium at 1.5× and writes wide WebP images to `public/readme/`:

| Asset | Content |
| --- | --- |
| `hero.webp` | Command Center in a browser frame, flanked by the light and dark mobile PWA |
| `command-center.webp` | Annotated Command Center (numbered markers with connector callouts) |
| `incident-response.webp` | Annotated incident detail |
| `platform.webp` | Analytics, on-call schedule and escalation policy |
| `mobile.webp` | Five iPhone frames: light home and triage, lock-screen push notifications, dark incident response and on-call |

Annotation markers are declared in the 1600×1000 capture coordinate space in `compose-assets.mjs`; the stage script maps them onto the rendered frame and stacks label cards beside them. The lock-screen notifications mirror the Web Push title and body format built in `src/lib/push.ts`.

After a material UI change, refresh the assets, visually inspect every image, and keep README claims aligned with the 2.0 documentation, which remains authoritative.
