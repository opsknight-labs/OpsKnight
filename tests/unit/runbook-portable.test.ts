import { describe, expect, it } from 'vitest';
import {
  MAX_PORTABLE_RUNBOOK_BYTES,
  PORTABLE_RUNBOOK_FORMAT,
  parsePortableRunbook,
  toPortableRunbook,
} from '@/lib/runbooks/portable';
import { RunbookDefinitionError } from '@/lib/runbooks/errors';

const definition = {
  description: '',
  steps: [
    {
      key: 'check_status',
      name: 'Check status',
      description: 'Look at the dashboard.',
      type: 'MANUAL',
      riskClass: 'READ_ONLY',
      config: {},
    },
  ],
};

const exported = toPortableRunbook(
  { name: 'Database failover', slug: 'db-failover', description: 'Fail over', tags: ['db'] },
  {
    definition,
    inputs: [
      {
        key: 'region',
        label: 'Region',
        type: 'SELECT',
        required: true,
        defaultValue: null,
        description: null,
        sequence: 1,
        options: ['us-east-1', 'eu-west-1'],
      },
      {
        key: 'reason',
        label: 'Reason',
        type: 'STRING',
        required: false,
        defaultValue: 'maintenance',
        description: 'Why',
        sequence: 0,
        options: [],
      },
    ],
  }
);

describe('portable runbook format', () => {
  it('exports a versioned, ordered document', () => {
    expect(exported).toMatchObject({
      format: PORTABLE_RUNBOOK_FORMAT,
      formatVersion: 1,
      name: 'Database failover',
      slug: 'db-failover',
      tags: ['db'],
    });
    expect(exported.inputs.map(input => input.key)).toEqual(['reason', 'region']);
    expect(exported.inputs[1]).toMatchObject({ options: ['us-east-1', 'eu-west-1'] });
    expect(exported.inputs[1]).not.toHaveProperty('defaultValue');
    expect(exported.inputs[0]).not.toHaveProperty('options');
  });

  it('round-trips through JSON text', () => {
    const parsed = parsePortableRunbook(JSON.stringify(exported));
    expect(parsed.slug).toBe('db-failover');
    expect(parsed.definition.steps[0].key).toBe('check_status');
    expect(parsed.inputs).toHaveLength(2);
  });

  it('rejects invalid JSON, wrong format and unsupported versions', () => {
    expect(() => parsePortableRunbook('{not json')).toThrow(/not valid JSON/);
    expect(() => parsePortableRunbook('[]')).toThrow(/JSON object/);
    expect(() => parsePortableRunbook({ ...exported, format: 'other' })).toThrow(
      /Unsupported file/
    );
    expect(() => parsePortableRunbook({ ...exported, formatVersion: 2 })).toThrow(/format version/);
  });

  it('rejects documents that fail schema validation', () => {
    expect(() => parsePortableRunbook({ ...exported, slug: 'Not A Slug!' })).toThrow(
      RunbookDefinitionError
    );
    expect(() => parsePortableRunbook({ ...exported, definition: { steps: 'nope' } })).toThrow(
      /invalid/
    );
  });

  it('enforces the size limit', () => {
    const oversized = JSON.stringify({
      ...exported,
      description: 'x'.repeat(MAX_PORTABLE_RUNBOOK_BYTES),
    });
    expect(() => parsePortableRunbook(oversized)).toThrow(/512 KiB/);
  });
});
