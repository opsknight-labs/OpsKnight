/**
 * Writes the generated MCP reference pages, or with --check fails when a committed page differs
 * from what the code generates. `npm run mcp:docs` / `npm run mcp:docs:check`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MCP_GENERATED_PAGES } from './docs-reference';

async function main() {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const page of MCP_GENERATED_PAGES) {
    const expected = await page.render();
    if (check) {
      let current = '';
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed docs paths
        current = readFileSync(page.path, 'utf8');
      } catch {
        current = '';
      }
      if (current !== expected) stale.push(page.path);
    } else {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed docs paths
      writeFileSync(page.path, expected);
      console.log(`wrote ${page.path}`);
    }
  }
  if (stale.length) {
    console.error(
      `Generated MCP docs are out of date: ${stale.join(', ')}. Run npm run mcp:docs and commit.`
    );
    process.exit(1);
  }
  if (check) console.log('Generated MCP docs are current.');
}

void main().catch(error => {
  console.error(error);
  process.exit(1);
});
