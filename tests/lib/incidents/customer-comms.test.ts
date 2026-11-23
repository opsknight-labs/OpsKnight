import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COMMS_POST_LIMIT,
  nextUpdateText,
  shapeCustomerComms,
  type CommsPage,
  type CustomerCommsRows,
} from '@/lib/incidents/customer-comms';

const now = new Date(Date.UTC(2026, 10, 23, 12, 0));
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const page = (over: Partial<CommsPage> = {}): CommsPage => ({
  id: 'page-public',
  name: 'Public Status',
  enabled: true,
  privacyMode: 'PUBLIC',
  requireAuth: false,
  slug: 'status',
  isDefault: true,
  subdomain: null,
  customDomain: null,
  updateCadenceMinutes: null,
  ...over,
});
const privatePage = page({ id: 'page-private', name: 'Partner Status', requireAuth: true });

const post = (
  id: string,
  createdMinutesAgo: number,
  over: Partial<CustomerCommsRows['posts'][number]> = {}
) => ({
  id,
  title: `Title ${id}`,
  message: `\n  First line ${id}\nSecond line`,
  type: 'INCIDENT',
  isActive: true,
  startDate: minutesAgo(createdMinutesAgo),
  endDate: null,
  publishAt: minutesAgo(createdMinutesAgo),
  createdAt: minutesAgo(createdMinutesAgo),
  statusPage: page(),
  ...over,
});

const rows = (over: Partial<CustomerCommsRows> = {}): CustomerCommsRows => ({
  incident: { id: 'inc 1', status: 'OPEN', visibility: 'PUBLIC' },
  posts: [],
  components: [],
  openUrgencies: [],
  ...over,
});

const reader = { canReadPages: true, canPublish: false };
const admin = { canReadPages: true, canPublish: true };
const outsider = { canReadPages: false, canPublish: false };
const url = (p: CommsPage) => `https://status.example/${p.slug}`;

describe('nextUpdateText', () => {
  it('matches the command bar wording', () => {
    expect(nextUpdateText(new Date(now.getTime() + 12 * 60_000), now)).toEqual({
      text: 'Next update in 12m',
      overdue: false,
    });
    expect(nextUpdateText(now, now)).toEqual({ text: 'Update due now', overdue: true });
    expect(nextUpdateText(minutesAgo(65), now)).toEqual({
      text: 'Update overdue by 1h 5m',
      overdue: true,
    });
  });
});

describe('shapeCustomerComms', () => {
  it('shapes posts newest first with first line, kind and a public link', () => {
    const view = shapeCustomerComms(
      rows({ posts: [post('b', 5), post('a', 40)] }),
      reader,
      now,
      url
    );
    expect(view.linked).toBe(true);
    expect(view.posts.map(p => p.id)).toEqual(['b', 'a']);
    expect(view.posts[0]).toMatchObject({
      pageName: 'Public Status',
      kind: 'Incident',
      lifecycle: null,
      firstLine: 'First line b',
      href: 'https://status.example/status',
      at: minutesAgo(5).toISOString(),
    });
  });

  it('times the next update from the newest post and its page cadence', () => {
    const fresh = shapeCustomerComms(rows({ posts: [post('a', 18)] }), reader, now, url);
    expect(fresh.nextDue).toMatchObject({ text: 'Next update in 12m', overdue: false });

    const slow = page({ updateCadenceMinutes: 10 });
    const late = shapeCustomerComms(
      rows({ posts: [post('a', 15, { statusPage: slow })] }),
      reader,
      now,
      url
    );
    expect(late.nextDue).toMatchObject({ text: 'Update overdue by 5m', overdue: true });
  });

  it('has no cadence for resolved or private incidents, nor before the first post', () => {
    const resolved = rows({
      incident: { id: 'i', status: 'RESOLVED', visibility: 'PUBLIC' },
      posts: [post('a', 5)],
    });
    expect(shapeCustomerComms(resolved, admin, now, url)).toMatchObject({
      nextDue: null,
      postHref: null,
    });
    const priv = rows({
      incident: { id: 'i', status: 'OPEN', visibility: 'PRIVATE' },
      posts: [post('a', 5)],
    });
    expect(shapeCustomerComms(priv, admin, now, url).nextDue).toBeNull();
    const none = rows({
      components: [{ displayName: null, serviceName: 'API', statusPage: page() }],
    });
    expect(shapeCustomerComms(none, admin, now, url).nextDue).toBeNull();
  });

  it('offers Post update to publishers only, on the page last posted on', () => {
    const r = rows({
      posts: [post('a', 5, { statusPage: page({ id: 'page-b' }) })],
      components: [{ displayName: null, serviceName: 'API', statusPage: page({ id: 'page-a' }) }],
    });
    expect(shapeCustomerComms(r, admin, now, url).postHref).toBe(
      '/settings/status-pages/page-b?announce=inc%201'
    );
    expect(shapeCustomerComms(r, reader, now, url).postHref).toBeNull();
    // No post yet: the first page that shows the service.
    const first = rows({ components: r.components });
    expect(shapeCustomerComms(first, admin, now, url).postHref).toBe(
      '/settings/status-pages/page-a?announce=inc%201'
    );
  });

  it('hides private pages and unpublished posts from viewers without the status-page read', () => {
    const r = rows({
      posts: [
        post('draft', 1, { isActive: false }),
        post('private', 2, { statusPage: privatePage }),
        post('later', 3, { publishAt: new Date(now.getTime() + 60_000) }),
        post('public', 4),
      ],
      components: [{ displayName: null, serviceName: 'API', statusPage: privatePage }],
    });
    const outside = shapeCustomerComms(r, outsider, now, url);
    expect(outside.posts.map(p => p.id)).toEqual(['public']);
    expect(outside.components).toEqual([]);
    // The cadence follows what the viewer can see.
    expect(outside.nextDue?.at).toBe(new Date(minutesAgo(4).getTime() + 30 * 60_000).toISOString());

    const inside = shapeCustomerComms(r, reader, now, url);
    expect(inside.posts.map(p => [p.id, p.lifecycle])).toEqual([
      ['draft', 'Draft'],
      ['private', null],
      ['later', 'Scheduled'],
      ['public', null],
    ]);
    expect(inside.components).toHaveLength(1);
  });

  it('does not link posts on a disabled page', () => {
    const r = rows({ posts: [post('a', 5, { statusPage: page({ enabled: false }) })] });
    expect(shapeCustomerComms(r, reader, now, url).posts[0].href).toBeNull();
  });

  it('rates the component by the worst open public incident on the service', () => {
    const components = [
      { displayName: ' ', serviceName: 'Checkout API', statusPage: page() },
      {
        displayName: 'Payments',
        serviceName: 'Checkout API',
        statusPage: page({ id: 'p2', name: 'Two' }),
      },
    ];
    const ok = shapeCustomerComms(rows({ components }), reader, now, url).components;
    expect(ok).toEqual([
      {
        key: 'page-public',
        name: 'Checkout API',
        pageName: 'Public Status',
        label: 'Operational',
        tone: 'ok',
      },
      { key: 'p2', name: 'Payments', pageName: 'Two', label: 'Operational', tone: 'ok' },
    ]);
    const down = shapeCustomerComms(
      rows({ components, openUrgencies: ['LOW', 'HIGH'] }),
      reader,
      now,
      url
    ).components[0];
    expect(down).toMatchObject({ label: 'Major Outage', tone: 'critical' });
  });

  it('is unlinked with a set-up link for publishers only', () => {
    expect(shapeCustomerComms(rows(), admin, now, url)).toMatchObject({
      linked: false,
      setupHref: '/settings/status-pages',
      postHref: null,
    });
    expect(shapeCustomerComms(rows(), reader, now, url).setupHref).toBeNull();
  });

  it('flags a full read as truncated', () => {
    const many = Array.from({ length: CUSTOMER_COMMS_POST_LIMIT }, (_, i) => post(`p${i}`, i + 1));
    expect(shapeCustomerComms(rows({ posts: many }), reader, now, url).truncated).toBe(true);
    expect(shapeCustomerComms(rows({ posts: many.slice(1) }), reader, now, url).truncated).toBe(
      false
    );
  });
});
