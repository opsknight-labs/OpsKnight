import { readFileSync as fsRead, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Repository paths only: CI workflows, package.json, scripts and test files.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths only
const readFileSync = (path: string) => fsRead(path, 'utf8');

const PREFIX_RUN =
  'vitest run -c vitest.int.config.ts --no-file-parallelism --maxWorkers=1 --exclude tests/integration/mcp-fault-child.test.ts --exclude tests/integration/mcp-load-worker.test.ts tests/integration/mcp-';

describe('CERT-03: every MCP database suite runs, without hand-kept lists', () => {
  const scripts = new Map(
    Object.entries(
      (JSON.parse(readFileSync('package.json')) as { scripts: Record<string, string> }).scripts
    )
  );

  it('selects the suites by path prefix in npm, CI and the local check', () => {
    expect(scripts.get('test:mcp:db')).toBe(PREFIX_RUN);
    const workflow = readFileSync('.github/workflows/mcp-certification.yml');
    expect(workflow).toContain('npm run test:mcp:db');
    // No suite is named one by one any more, so none can be forgotten.
    expect(workflow).not.toMatch(/tests\/integration\/mcp-[a-z-]+\.test\.ts/);
    const local = readFileSync('scripts/mcp/local-check.cjs');
    expect(local).toContain("'tests/integration/mcp-',");
    // Only the two excluded harnesses may be named.
    expect(
      [...local.matchAll(/'tests\/integration\/(mcp-[a-z-]+\.test\.ts)'/g)].map(match => match[1])
    ).toEqual(['mcp-fault-child.test.ts', 'mcp-load-worker.test.ts']);
  });

  it('keeps the child-process harnesses out of the suite (CERT-04): their parents start them', () => {
    const files = readdirSync('tests/integration').filter(file => file.startsWith('mcp-'));
    expect(files).toEqual(
      expect.arrayContaining(['mcp-fault-child.test.ts', 'mcp-load-worker.test.ts'])
    );
    expect(files.length).toBeGreaterThan(40);
  });

  it('runs every MCP integration suite under the Node runtime, as the route does (CERT-12)', () => {
    for (const file of readdirSync('tests/integration').filter(
      name => name.startsWith('mcp-') && name.endsWith('.test.ts')
    ))
      expect(readFileSync(`tests/integration/${file}`).split('\n')[0], file).toBe(
        '// @vitest-environment node'
      );
  });
});

describe('CERT-01: REST route and routing changes re-run MCP certification', () => {
  it('watches every API route (src/app/api/**), middleware, Next config and the browser suite config', () => {
    const workflow = readFileSync('.github/workflows/mcp-certification.yml');
    for (const pattern of [
      '|src/app/api/|',
      'src/middleware\\.ts$',
      'next\\.config\\.[cm]?[jt]s$',
      'playwright\\.mcp\\.config\\.ts$',
    ])
      expect(workflow).toContain(pattern);
  });

  it('checks route drift in the unit suite that runs on every pull request', () => {
    const tests = readFileSync('.github/workflows/tests.yml');
    expect(tests).toContain('test:ci:unit');
    expect(readFileSync('tests/mcp/catalog-route-drift.test.ts')).toContain('routeSha256');
  });
});
