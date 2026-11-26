import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  createTestIncident,
  linkServiceToStatusPage,
} from '../helpers/test-db';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { getStatusResponse } from '@/app/api/status/handler';
import { getStatusHistoryResponse } from '@/app/api/status/history/handler';
import { getStatusRssResponse } from '@/lib/status-pages/rss';
import { getUptimeExportResponse } from '@/app/api/status/uptime-export/route';

vi.mock('@/lib/sla-server', () => ({ calculateMultiServiceUptime: vi.fn().mockResolvedValue({}) }));

describe('showMembers=false does not leak member services (P2)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function fixture() {
    const slug = `hm-${Math.random().toString(36).slice(2, 8)}`;
    const page = await createTestStatusPage({
      enabled: true,
      enableUptimeExports: true,
      slug,
      serviceLayout: 'BUSINESS_EXPANDABLE',
      showAffectedServices: true,
    });
    const secret = await createTestService('Ledger Postgres Primary');
    const open = await createTestService('Public Website');
    await linkServiceToStatusPage(page.id, secret.id, { viaBusinessService: true });
    await linkServiceToStatusPage(page.id, open.id);
    const bs = await testPrisma.businessService.create({
      data: { name: 'Payments', members: { create: [{ serviceId: secret.id }] } },
    });
    await testPrisma.statusPageBusinessService.create({
      data: { statusPageId: page.id, businessServiceId: bs.id, order: 0, showMembers: false },
    });
    await createTestIncident('Ledger down', secret.id, { status: 'OPEN' });
    await publishStatusPageSnapshot(page.id);
    return { slug, secret, bs, open };
  }
  const req = (path: string) => new NextRequest(`http://localhost${path}`);

  it('keeps the hidden member out of the JSON status, history and RSS', async () => {
    const { slug, secret, bs, open } = await fixture();
    const json = await (await getStatusResponse(req(`/api/status?slug=${slug}`), slug)).json();
    const text = JSON.stringify(json);
    expect(text).not.toContain('Ledger Postgres Primary');
    expect(text).not.toContain(secret.id);
    expect(json.businessServices[0]).toMatchObject({ id: bs.id, memberServiceIds: [] });
    expect(json.services.map((s: { id: string }) => s.id)).toEqual([open.id]);

    const history = await (
      await getStatusHistoryResponse(req(`/api/status/history?slug=${slug}`), slug)
    ).text();
    expect(history).not.toContain('Ledger Postgres Primary');
    expect(history).not.toContain(secret.id);
    const direct = await getStatusHistoryResponse(
      req(`/api/status/history?slug=${slug}&serviceId=${secret.id}`),
      slug
    );
    expect(direct.status).toBe(404);
    const rss = await (
      await getStatusRssResponse(req(`/api/status/rss?slug=${slug}`), slug)
    ).text();
    expect(rss).not.toContain('Ledger Postgres Primary');
  });

  it('keeps the hidden member out of the uptime export', async () => {
    const { slug, secret } = await fixture();
    const response = await getUptimeExportResponse(
      req(`/api/status/uptime-export?slug=${slug}&format=csv`),
      slug
    );
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).not.toContain('Ledger Postgres Primary');
    expect(csv).not.toContain(secret.id);
    expect(csv).toContain('Public Website');
  });
});
