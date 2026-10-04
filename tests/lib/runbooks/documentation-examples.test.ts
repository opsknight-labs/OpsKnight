import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';

describe('Runbook documentation examples', () => {
  it('validates the 2.1.0 nested-check authoring example against the actual engine', () => {
    const guide = readFileSync('docs/v2.1.0/guides/runbooks/author.md', 'utf8');
    const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const definition = parseRunbookDefinition(JSON.parse(example[1]));
      expect(definition.steps[0].precheck?.steps).toHaveLength(1);
      expect(definition.steps[0].verification?.steps).toHaveLength(1);
    }
  });
});
