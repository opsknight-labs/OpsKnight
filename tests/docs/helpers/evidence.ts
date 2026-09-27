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
