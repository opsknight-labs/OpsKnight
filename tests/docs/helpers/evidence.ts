import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page, TestInfo } from '@playwright/test';

export async function captureEvidence(page: Page, testInfo: TestInfo, journey: string, name: string) {
  const directory = resolve('generated/docs-evidence/current', journey);
  // Journey and artifact names are fixed in the committed test suite.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(directory, { recursive: true });
  const image = resolve(directory, `${name}.png`);
  // Viewport captures preserve fixed navigation chrome. Full-page stitching can
  // omit the fixed sidebar while retaining its content gutter.
  await page.screenshot({ path: image, fullPage: false });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify({
    release: 'current',
    commit,
    route: new URL(page.url()).pathname,
    journey,
    browser: testInfo.project.name,
    viewport: page.viewportSize(),
    capturedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}
