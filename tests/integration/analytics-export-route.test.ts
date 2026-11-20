import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { createAnalyticsContext, getAnalyticsSection, parseAnalyticsParams } from '@/lib/analytics';
import { resetAnalyticsCacheForTests } from '@/lib/analytics/cache';
import { METRICS } from '@/lib/analytics/definitions';
import { GET } from '@/app/api/insights/export/route';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn() }));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const DAY = 86_400_000;
const request = (query = '') => new NextRequest(`http://localhost/api/analytics/export${query}`);

async function signIn(role: 'ADMIN' | 'USER') {
  const user = await createTestUser({ role, timeZone: 'UTC' });
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: user.id, email: user.email },
    expires: 'never',
  } as never);
  return user;
}

describeIfRealDB('GET /api/insights/export', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
    resetAnalyticsCacheForTests();
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('rejects anonymous callers and users without REPORT_EXPORT', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    await signIn('USER');
    expect((await GET(request())).status).toBe(403);
  });

  it('writes the same totals as the page sections and escapes formula cells', async () => {
    const admin = await signIn('ADMIN');
    const service = await testPrisma.service.create({ data: { name: '@svc' } });
    const now = Date.now();
    await testPrisma.incident.createMany({
      data: [
        {
          title: '=HYPERLINK("http://evil")',
          serviceId: service.id,
          status: 'OPEN',
          urgency: 'HIGH',
          createdAt: new Date(now - DAY),
        },
        {
          title: 'normal',
          serviceId: service.id,
          status: 'RESOLVED',
          urgency: 'LOW',
          createdAt: new Date(now - 2 * DAY),
          resolvedAt: new Date(now - DAY),
        },
        {
          title: 'too old',
          serviceId: service.id,
          status: 'RESOLVED',
          urgency: 'LOW',
          createdAt: new Date(now - 400 * DAY),
          resolvedAt: new Date(now - 399 * DAY),
        },
      ],
    });

    const response = await GET(request('?range=30d'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="opsknight-analytics-30d-\d{4}-\d{2}-\d{2}\.csv"$/
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const csv = new TextDecoder().decode(bytes);

    const actor = { id: admin.id, role: 'ADMIN' as const, status: 'ACTIVE' as const, teamIds: [] };
    const context = await createAnalyticsContext(
      actor,
      parseAnalyticsParams({ range: '30d' }),
      'UTC'
    );
    const kpis = await getAnalyticsSection(context, 'kpis');
    expect(kpis.current.incidents).toBe(2);
    expect(csv).toContain(`\r\n${METRICS.incidents.label},${kpis.current.incidents},`);
    expect(csv).toContain(`\r\n${METRICS.openNow.label},${kpis.openNow},`);

    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",'@svc,");
    expect(csv).not.toContain('too old');
  });
});
