import { describe, expect, it } from 'vitest';
import { MCP_CATALOG, MCP_OPERATION_MAP, isMcpApprovalGated } from '@/lib/mcp/catalog';
import {
  beforeReadFor,
  mcpOperationDigest,
  reviewDiff,
  reviewSummary,
} from '@/lib/mcp/approvals/operation';

describe('approval review summary', () => {
  it('shows every digest-bound input, including query parameters', () => {
    const summary = reviewSummary('setTeamLead', {
      path: { id: 'cabc123456789012345678901' },
      query: { dryRun: false, note: 'x'.repeat(500) },
      body: { userId: 'cabc123456789012345678902' },
      ifMatch: '"3"',
    });
    expect(summary.query).toEqual([
      ['dryRun', 'false'],
      ['note', 'x'.repeat(300)],
    ]);
    expect(summary.targets).toEqual({ id: 'cabc123456789012345678901' });
    expect(summary.ifMatch).toBe('"3"');
    expect(summary.changes).toEqual([['userId', 'cabc123456789012345678902']]);
  });
  it('defaults to no query parameters and withholds secret-like body fields', () => {
    const summary = reviewSummary('createStatusPageAnnouncement', {
      path: { id: 'p' },
      body: { title: 'T', message: 'M', apiToken: 'sk-secret-value' },
    });
    expect(summary.query).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain('sk-secret-value');
  });
  it('documents which gated operations accept query inputs so none is reviewed blind', () => {
    const withQuery = MCP_CATALOG.filter(isMcpApprovalGated).filter(
      operation =>
        Object.keys(
          ((operation.inputSchema as { properties: { query?: { properties?: object } } }).properties
            .query?.properties ?? {}) as object
        ).length > 0
    );
    // Today none do. If one is added, the summary above already displays its query inputs.
    expect(withQuery.map(operation => operation.operationId)).toEqual([]);
  });
});

describe('UX-6 before/after view of a reviewed change', () => {
  const operation = (id: string) =>
    MCP_OPERATION_MAP.get(id)! as unknown as Parameters<typeof beforeReadFor>[0];

  it('reads updates against the plain GET of the same target, never deletes or creates', () => {
    expect(beforeReadFor(operation('updateService'))).toBe('getService');
    expect(beforeReadFor(operation('updateTeam'))).toBe('getTeam');
    expect(beforeReadFor(operation('updateEscalationPolicy'))).toBe('getEscalationPolicy');
    expect(beforeReadFor(operation('createService'))).toBeNull();
    // Destructive changes already carry their reviewed impact preview.
    expect(beforeReadFor(operation('deleteService'))).toBeNull();
  });

  it('marks each field changed, unchanged or not in view, redacted like the changes', () => {
    const changes = reviewSummary('updateService', {
      path: { id: 's1' },
      body: { name: 'New name', description: 'Same', tier: 'gold', apiToken: 'sk-new' },
    }).changes;
    const diff = reviewDiff(changes, {
      id: 's1',
      name: 'Old name',
      description: 'Same',
      apiToken: 'sk-old',
    });
    expect(diff).toEqual([
      { field: 'name', before: 'Old name', after: 'New name', status: 'changed' },
      { field: 'description', before: 'Same', after: 'Same', status: 'unchanged' },
      { field: 'tier', before: null, after: 'gold', status: 'not_in_view' },
      // A withheld secret may have changed: never filed under "unchanged".
      { field: '.apiToken', before: '[withheld]', after: '[withheld]', status: 'not_compared' },
    ]);
    expect(JSON.stringify(diff)).not.toMatch(/sk-(old|new)/);
    expect(reviewDiff(changes, null)).toEqual([]);
  });

  it('never calls a cut-short value unchanged', () => {
    const long = 'x'.repeat(400);
    const changes = reviewSummary('updateService', {
      path: { id: 's1' },
      body: { description: `${long}new` },
    }).changes;
    expect(reviewDiff(changes, { description: `${long}old` })).toEqual([
      expect.objectContaining({ field: 'description', status: 'not_compared' }),
    ]);
  });

  it('lists the members a shorter replacement list drops, and an emptied list as changed', () => {
    const changes = reviewSummary('updateEscalationPolicy', {
      path: { id: 'p1' },
      body: { steps: [{ targetId: 'u1', delay: 5 }], tags: [] },
    }).changes;
    const diff = reviewDiff(changes, {
      steps: [
        { targetId: 'u1', delay: 5 },
        { targetId: 'u2', delay: 10 },
      ],
      tags: ['prod', 'db'],
    });
    expect(diff).toEqual([
      { field: 'steps[0].targetId', before: 'u1', after: 'u1', status: 'unchanged' },
      { field: 'steps[0].delay', before: '5', after: '5', status: 'unchanged' },
      { field: 'tags', before: '[0]: prod\n[1]: db', after: '[]', status: 'changed' },
      { field: 'steps[1]', before: '.targetId: u2\n.delay: 10', after: null, status: 'removed' },
    ]);
  });

  it('keeps the diff out of the digest', () => {
    const frozen = { path: { id: 's1' }, body: { name: 'New name' } };
    const digest = mcpOperationDigest('updateService', frozen);
    reviewDiff(reviewSummary('updateService', frozen).changes, { name: 'Old' });
    expect(mcpOperationDigest('updateService', frozen)).toBe(digest);
  });
});

describe('what the reviewer is shown, against what the digest binds', () => {
  it('says how many list members are not shown, and flags the summary as cut short', () => {
    const summary = reviewSummary('setTeamLead', {
      path: { id: 'team_1' },
      body: { userIds: Array.from({ length: 50 }, (_, index) => `user_${index}`) },
    } as never);
    expect(summary.changes.at(-1)).toEqual(['userIds[…]', '[10 more items not shown]']);
    expect(summary.truncated).toBe(true);
    expect(summary.changes.length).toBeLessThan(80);
  });

  it('never calls an edit unchanged when the only difference sits in a redacted part', () => {
    const changes = reviewSummary('updateService', {
      path: { id: 'svc_1' },
      body: { webhook: 'https://hooks.example.com/x?key=ATTACKER', name: 'Same' },
    } as never).changes;
    // The stored value differs only in the query string the redaction pass strips.
    const diff = reviewDiff(changes, {
      webhook: 'https://hooks.example.com/x?key=OLD',
      name: 'Same',
    });
    const webhook = diff.find(row => row.field === 'webhook')!;
    expect(webhook.status).toBe('not_compared');
    expect(webhook.after).toContain('[part not shown]');
    expect(diff.find(row => row.field === 'name')!.status).toBe('unchanged');
  });
});
