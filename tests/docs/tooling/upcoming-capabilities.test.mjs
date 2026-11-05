import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { loadCapabilityInventories } from '../../../scripts/docs/impact-inventories.mjs';

const root = process.cwd();
// Paths come from the checked-in catalog under test.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths only
const exists = path => existsSync(resolve(root, path));
const versions = JSON.parse(readFileSync('docs/versions.json', 'utf8'));

// DX-11: the impact gate sees MCP before v2.2.0 is the current release.
test('the impact gate also reads the upcoming catalog, which maps MCP', () => {
  const inventories = loadCapabilityInventories(root, versions);
  assert.deepEqual(
    inventories.map(inventory => inventory.version),
    [versions.currentRelease, versions.upcomingVersion]
  );
  const upcoming = new Map(inventories[1].capabilities);
  const mcp = upcoming.get('mcp_assistants');
  assert.ok(mcp, 'mcp_assistants is mapped');
  assert.ok(mcp.sources.includes('src/lib/mcp'));
});

test('every path the upcoming catalog maps exists', () => {
  const [, upcoming] = loadCapabilityInventories(root, versions);
  for (const [id, capability] of upcoming.capabilities) {
    const docs = [
      ...(capability.concepts ?? []),
      ...(capability.guides ?? []),
      ...(capability.reference ?? []),
    ];
    for (const path of docs)
      assert.ok(exists(`docs/${upcoming.version}/${path}`), `${id}: ${path}`);
    for (const path of [...(capability.tests ?? []), ...(capability.sources ?? [])])
      assert.ok(exists(path), `${id}: ${path}`);
  }
});

test('a capability already in the current catalog keeps its current mapping', () => {
  const inventories = loadCapabilityInventories(root, {
    ...versions,
    upcomingVersion: versions.currentRelease,
  });
  assert.equal(inventories.length, 1);
});
