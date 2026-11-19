// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import type { McpBoundaryError } from '@/lib/mcp/core/errors';
import { toolErrorText } from '@/lib/mcp/protocol/server';
import { principal, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import { createTestIncident, createTestService, testPrisma as db } from '../helpers/test-db';

setupMcpReadDatabase();

const reads = ['incidents:read', 'services:read'];
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: Error) => error.message
  );
type Page = { data: { data: { id: string }[]; pagination: { nextCursor?: string } } };
const list = async (
  who: Awaited<ReturnType<typeof principal>>,
  operationId: string,
  query: Record<string, string | number>
) => (await callMcpOperation(who.ctx(), operationId, { query })) as unknown as Page;

describe('a NUL character or lone surrogate in a text argument', () => {
  it('is refused as invalid input instead of surfacing as a retryable internal error', async () => {
    const who = await principal('ADMIN', reads);
    for (const [operationId, query] of [
      ['listIncidents', { search: 'a\u0000b' }],
      ['listServices', { search: 'a\u0000b' }],
      ['listIncidents', { search: 'lone \ud800 surrogate' }],
    ] as const)
      expect(await fails(callMcpOperation(who.ctx(), operationId, { query })), operationId).toBe(
        'MCP_INVALID_ARGUMENTS'
      );
  });
});

describe('page cursors', () => {
  it('are tied to their operation and filters, and survive a change of page size', async () => {
    const who = await principal('ADMIN', reads);
    const service = await createTestService(
      `Cursor service ${Math.random().toString(36).slice(2)}`
    );
    for (const title of ['one', 'two', 'three'])
      await createTestIncident(`Cursor ${title}`, service.id, { urgency: 'LOW' });

    const first = await list(who, 'listIncidents', { limit: 1, urgency: 'LOW' });
    const cursor = first.data.pagination.nextCursor!;
    // Wrapped: it carries a fingerprint of the operation and filters.
    expect(cursor.startsWith('m1.')).toBe(true);

    // The same filters continue, and the page size may change between pages.
    const second = await list(who, 'listIncidents', { limit: 2, urgency: 'LOW', cursor });
    expect(second.data.data.length).toBeGreaterThan(0);
    expect(second.data.data.map(row => row.id)).not.toContain(first.data.data[0].id);

    // Other filters, or another list altogether, are refused with a usable message.
    for (const [operationId, query] of [
      ['listIncidents', { limit: 1, urgency: 'HIGH', cursor }],
      ['listServices', { limit: 1, cursor }],
    ] as const)
      expect(await fails(callMcpOperation(who.ctx(), operationId, { query })), operationId).toBe(
        'MCP_INVALID_ARGUMENTS'
      );
  });

  it('still accepts a cursor without the wrapper (issued before it existed)', async () => {
    const who = await principal('ADMIN', reads);
    const service = await createTestService(`Legacy cursor ${Math.random().toString(36).slice(2)}`);
    for (const title of ['a', 'b']) await createTestIncident(`Legacy ${title}`, service.id);
    const first = await list(who, 'listIncidents', { limit: 1 });
    const inner = first.data.pagination.nextCursor!.split('.').slice(2).join('.');
    const second = await list(who, 'listIncidents', { limit: 1, cursor: inner });
    expect(second.data.data.length).toBe(1);
  });
});

describe('common rejections', () => {
  it('say what to do, not only a code', async () => {
    const who = await principal('ADMIN', reads);
    const rejected = async (query: Record<string, string | number>) => {
      try {
        await callMcpOperation(who.ctx(), 'listIncidents', { query });
      } catch (error) {
        return error as McpBoundaryError;
      }
      throw new Error('expected a rejection');
    };
    // A cursor that is not one of ours reaches the API's own INVALID_PAGINATION_CURSOR.
    const cursor = await rejected({ cursor: 'not-a-real-cursor' });
    expect(cursor.code).toBe('MCP_DOMAIN_REJECTED');
    expect(cursor.domainCode).toBe('INVALID_PAGINATION_CURSOR');
    expect(cursor.hint).toContain('nextCursor');
    expect(toolErrorText(cursor)).toContain('same filters');
  });
});

describe('postmortem_list', () => {
  it('returns summaries, while postmortem_get still returns the whole body', async () => {
    const who = await principal('ADMIN', ['incidents:read', 'postmortems:read']);
    const service = await createTestService(
      `Postmortem service ${Math.random().toString(36).slice(2)}`
    );
    const incident = await createTestIncident('Postmortem incident', service.id, {
      status: 'RESOLVED',
    });
    const postmortem = await db.postmortem.create({
      data: {
        incidentId: incident.id,
        title: 'A postmortem title',
        summary: 'A short summary',
        rootCause: 'A long authored root cause',
        timeline: [{ id: 't1', title: 'A timeline entry', timestamp: new Date().toISOString() }],
      },
    });
    const listed = (await callMcpOperation(who.ctx(), 'listPostmortems', {
      query: { limit: 50 },
    })) as unknown as { data: { data: Record<string, unknown>[] } };
    const row = listed.data.data.find(item => item.id === postmortem.id)!;
    expect(row).toMatchObject({ title: 'A postmortem title', summary: 'A short summary' });
    expect(row).not.toHaveProperty('rootCause');
    expect(row).not.toHaveProperty('timeline');
    const whole = (await callMcpOperation(who.ctx(), 'getPostmortem', {
      path: { id: postmortem.id },
    })) as unknown as { data: { data: Record<string, unknown> } };
    expect(whole.data.data).toMatchObject({ rootCause: 'A long authored root cause' });
    expect(whole.data.data).toHaveProperty('timeline');
  });
});
