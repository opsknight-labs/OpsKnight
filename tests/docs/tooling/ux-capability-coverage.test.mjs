import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const registry = YAML.parse(readFileSync('docs/internal/certification/ux-capabilities.yaml', 'utf8'));

test('major cross-cutting UX capabilities have task-oriented documentation', () => {
  assert.equal(registry.schemaVersion, 1);
  assert.ok(registry.capabilities.length >= 6, 'UX registry must not silently shrink');
  const ids = new Set();
  for (const surface of registry.capabilities) {
    assert.ok(!ids.has(surface.id), `duplicate UX capability id: ${surface.id}`);
    ids.add(surface.id);
    assert.ok(surface.owner, `${surface.name}: missing owner`);
    assert.ok(surface.classification, `${surface.name}: missing classification`);
    for (const source of surface.sources) assert.ok(existsSync(source), `${surface.name}: missing source ${source}`);
    assert.ok(existsSync(surface.documentation), `${surface.name}: missing ${surface.documentation}`);
    const content = readFileSync(surface.documentation, 'utf8');
    for (const phrase of surface.requiredPhrases) {
      assert.ok(content.toLowerCase().includes(phrase.toLowerCase()), `${surface.name}: documentation missing ${phrase}`);
    }
  }
});
