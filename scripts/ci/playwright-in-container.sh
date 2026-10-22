#!/usr/bin/env bash
# Linux CI: installed package, browser binaries and Ubuntu libraries must match.
set -euo pipefail
PLAYWRIGHT_IMAGE_VERSION=$(node -p "require('@playwright/test/package.json').version")
docker run --rm --init --ipc=host --network host \
  -e CI=true -e DATABASE_URL -e DIRECT_URL -e NEXTAUTH_URL -e NEXT_PUBLIC_APP_URL \
  -e NEXTAUTH_SECRET -e API_KEY_SECRET -e ENCRYPTION_KEY -e AUTH_TRUST_HOST \
  -e PLAYWRIGHT_PRODUCTION_SERVER -e TRUST_PROXY_HEADERS -e HUSKY \
  -v "$PWD:/work" -w /work \
  "mcr.microsoft.com/playwright:v${PLAYWRIGHT_IMAGE_VERSION}-noble" \
  npx playwright test "$@"
