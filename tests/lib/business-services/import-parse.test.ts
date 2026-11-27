import { describe, expect, it } from 'vitest';
import {
  hasCycle,
  parseBusinessServiceImport,
  parseCriticality,
  parseCsv,
} from '@/lib/business-services/import';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and blank lines', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n"multi\nline",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });
  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('name\n"open')).toThrow(/unclosed quote/);
  });
});

describe('parseCriticality', () => {
  it('accepts tier spellings and nothing else', () => {
    expect(parseCriticality('TIER_0')).toBe('TIER_0');
    expect(parseCriticality('tier-2')).toBe('TIER_2');
    expect(parseCriticality('Tier 3')).toBe('TIER_3');
    expect(parseCriticality(1)).toBe('TIER_1');
    expect(parseCriticality('')).toBeNull();
    expect(parseCriticality(undefined)).toBeUndefined();
    expect(parseCriticality('constructor')).toBeUndefined();
    expect(parseCriticality('gold')).toBeUndefined();
  });
});

describe('parseBusinessServiceImport', () => {
  it('reads CSV columns, leaves blank cells unchanged and reports bad rows', () => {
    const { rows, issues } = parseBusinessServiceImport(
      'Name,Criticality,Owner Team,Members,Depends On\nCheckout,0,Payments,api; web ,Payments\n,1,,,\nOdd,gold,,,',
      'csv'
    );
    expect(rows[0]).toEqual({
      line: 2,
      name: 'Checkout',
      criticality: 'TIER_0',
      ownerTeam: 'Payments',
      members: ['api', 'web'],
      dependsOn: ['Payments'],
    });
    expect(rows[1]).toEqual({ line: 4, name: 'Odd' });
    expect(issues).toEqual([
      { line: 3, message: 'Every row needs a name.' },
      { line: 4, name: 'Odd', message: 'Unknown criticality "gold".' },
    ]);
  });

  it('reads custom attributes from attr.<key> columns and a YAML mapping, and flags bad ones', () => {
    const csv = parseBusinessServiceImport(
      'name,attr.cost_center,attr.pci\nCheckout,ops-42,true\nSearch,,\n',
      'csv'
    );
    expect(csv.rows[0].attributes).toEqual({ cost_center: 'ops-42', pci: true });
    expect(csv.rows[1].attributes).toBeUndefined();
    const yaml = parseBusinessServiceImport(
      '- name: Checkout\n  attributes:\n    tier_owner: ann\n    budget: 3\n- name: Bad\n  attributes: [1]\n',
      'yaml'
    );
    expect(yaml.rows[0].attributes).toEqual({ tier_owner: 'ann', budget: 3 });
    expect(yaml.issues).toEqual([
      expect.objectContaining({ name: 'Bad', message: expect.stringMatching(/Attributes/) }),
    ]);
  });

  it('reads YAML lists, where an empty list clears members', () => {
    const { rows } = parseBusinessServiceImport(
      '- name: Checkout\n  members: []\n  ownerTeam: null\n',
      'yaml'
    );
    expect(rows).toEqual([{ line: 1, name: 'Checkout', members: [], ownerTeam: null }]);
  });

  it('reads a Backstage catalog: systems, their components and system dependencies', () => {
    const { rows } = parseBusinessServiceImport(
      [
        'kind: System\nmetadata: { name: shop }\nspec: { dependsOn: [system:default/payments, component:x] }',
        'kind: System\nmetadata: { name: payments }',
        'kind: Component\nmetadata: { name: cart }\nspec: { system: shop }',
        'kind: Component\nmetadata: { name: ledger }\nspec: { system: system:default/payments }',
      ].join('\n---\n'),
      'backstage'
    );
    expect(rows).toEqual([
      { line: 1, name: 'shop', members: ['cart'], dependsOn: ['payments'] },
      { line: 2, name: 'payments', members: ['ledger'], dependsOn: [] },
    ]);
  });

  it('caps the row count', () => {
    const csv = ['name', ...Array.from({ length: 1001 }, (_, index) => `bs-${index}`)].join('\n');
    expect(() => parseBusinessServiceImport(csv, 'csv')).toThrow(/at most 1000/);
  });
});

describe('hasCycle', () => {
  it('finds loops and accepts trees', () => {
    expect(
      hasCycle(
        new Map([
          ['a', new Set(['b'])],
          ['b', new Set(['c'])],
        ])
      )
    ).toBeNull();
    expect(
      hasCycle(
        new Map([
          ['a', new Set(['b'])],
          ['b', new Set(['a'])],
        ])
      )
    ).not.toBeNull();
  });
});
