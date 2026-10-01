import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page, TestInfo } from '@playwright/test';

const GLOBAL_ERROR_TEXT = /Dashboard couldn't load|Try again|Analytics couldn't load|Something went wrong/i;
const VISIBLE_LOADING_SKELETON =
  '[role="status"][aria-label="Loading..."]:visible, .animate-pulse.bg-muted:visible';

export async function assertEvidenceReady(page: Page) {
  // The application keeps realtime event streams open, so `networkidle` never
  // settles. Feature-specific journey assertions establish data readiness;
  // this shared guard rejects generic loading and failure UI immediately
  // before pixels are persisted.
  await page.waitForLoadState('domcontentloaded');
  await page.locator(VISIBLE_LOADING_SKELETON).first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});

  const visibleSkeletons = await page.locator(VISIBLE_LOADING_SKELETON).count();
  if (visibleSkeletons > 0) {
    throw new Error(`Evidence capture rejected ${visibleSkeletons} visible loading skeleton(s) at ${page.url()}`);
  }

  const errorState = page.getByText(GLOBAL_ERROR_TEXT).filter({ visible: true });
  if (await errorState.count()) {
    throw new Error(`Evidence capture rejected a global error state at ${page.url()}: ${await errorState.first().innerText()}`);
  }
}

export async function captureEvidence(page: Page, testInfo: TestInfo, journey: string, name: string) {
  await assertEvidenceReady(page);
  const directory = resolve('generated/docs-evidence/current', journey);
  // Journey and artifact names are fixed in the committed test suite.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await mkdir(directory, { recursive: true });
  const image = resolve(directory, `${name}.png`);
  // Viewport captures preserve fixed navigation chrome. Full-page stitching can
  // omit the fixed sidebar while retaining its content gutter.
  await page.screenshot({ path: image, fullPage: false });
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const requestedImage = process.env.DOCS_OPSKNIGHT_IMAGE;
  if (!requestedImage?.includes('@sha256:')) {
    throw new Error('DOCS_OPSKNIGHT_IMAGE must be an immutable digest reference');
  }
  const imageInspection = JSON.parse(execFileSync(
    'docker',
    ['image', 'inspect', requestedImage],
    { encoding: 'utf8' }
  ))[0] as { RepoDigests?: string[]; Config?: { Labels?: Record<string, string> } };
  const runtimeSourceRevision = imageInspection.Config?.Labels?.['org.opencontainers.image.revision'];
  const runtimeDigest = imageInspection.RepoDigests?.find(value => value.includes('@sha256:'));
  if (!runtimeSourceRevision || !runtimeDigest) {
    throw new Error('Runtime image must expose an OCI source revision and repository digest');
  }
  if (!/^[0-9a-f]{40}$/.test(runtimeSourceRevision)) {
    throw new Error('Runtime image OCI revision must be a full 40-character Git SHA');
  }
  execFileSync('git', ['merge-base', '--is-ancestor', runtimeSourceRevision, sourceRevision]);
  const productChanges = execFileSync(
    'git',
    ['diff', '--name-only', `${runtimeSourceRevision}..${sourceRevision}`, '--', 'src', 'prisma', 'deploy', 'Dockerfile', 'next.config.ts'],
    { encoding: 'utf8' }
  ).trim();
  if (productChanges) {
    throw new Error(`Runtime image does not contain product changes:\n${productChanges}`);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify({
    release: 'current',
    sourceRevision,
    runtime: {
      requestedImage,
      digest: runtimeDigest,
      sourceRevision: runtimeSourceRevision,
    },
    route: new URL(page.url()).pathname,
    journey,
    browser: testInfo.project.name,
    viewport: page.viewportSize(),
    capturedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}
