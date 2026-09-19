import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const forbidden = ['SLADefinition', 'SLASnapshot', 'generateDailySnapshot'];
const roots = ['src/lib/incident-sla', 'src/lib/incidents'];

function sourceFiles(root: string): string[] {
  // Repository-controlled roots and descendants only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(path)
        ? [path]
        : [];
  });
}

describe('incident SLA architecture boundary', () => {
  it('does not import legacy definition or snapshot symbols into incident SLA code', () => {
    const files = [...roots.flatMap(sourceFiles), 'src/lib/sla-breach-monitor.ts'];
    for (const file of files) {
      // Repository-controlled paths assembled above.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const imports = readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => /^import\s/.test(line.trim()))
        .join('\n');
      for (const symbol of forbidden)
        expect(imports, `${file} imports ${symbol}`).not.toContain(symbol);
    }
  });
});
