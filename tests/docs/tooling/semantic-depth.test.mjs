import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import YAML from 'yaml';

const contract = YAML.parse(readFileSync('docs/internal/certification/semantic-requirements.yaml', 'utf8'));
test('semantic requirements occur in the mapped reader documentation', () => {
  for (const [feature, requirement] of Object.entries(contract.features)) {
    const text = requirement.pages.map(page => readFileSync(`docs/v2.0.0/${page}`, 'utf8')).join('\n').toLowerCase();
    for (const topic of requirement.required_topics) assert.ok(text.includes(topic.toLowerCase()), `${feature}: missing semantic topic "${topic}"`);
  }
});
