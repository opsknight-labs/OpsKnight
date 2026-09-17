import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { scalingFeatureEnabled } from '@/lib/scaling-feature-flags';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { logger } from '@/lib/logger';

/**
 * Why the stored payload may or may not be served.
 *
 * `revoked` alone cannot distinguish "a disclosure was retracted" from "a rebuild is in flight",
 * and those need opposite handling: the first must withhold everything, the second should keep
 * serving the last good projection. `FAIL_CLOSED` is the safe interpretation of anything unknown.
 */
export type StatusPageServingState = 'LIVE' | 'STALE_OK' | 'FAIL_CLOSED' | 'DISABLED';

/**
 * Why a caller is withdrawing a publication.
 *
 * Required rather than optional so a new call site cannot silently inherit the old
 * withhold-everything behaviour without stating its intent.
 */
export type StatusPageRevocationReason =
  /** A narrowed disclosure. Withhold everything until the replacement is published. */
  | 'PRIVACY'
  /** The page was turned off. Withhold everything; the payload is discarded on rebuild. */
  | 'DISABLED'
  /** A benign change is being republished. The previous projection stays servable. */
  | 'SUPERSEDED'
  /** The page is gone. Withhold everything and drop the payload. */
  | 'DELETED';

export interface StatusServingManifest {
  pageId: string;
  revision: string;
  enabled: boolean;
  revoked: boolean;
  snapshotKey: string;
  publishedAt: string;
  schemaVersion: number;
  integrityHash: string;
  /** Absent on manifests written before serving states existed; read as FAIL_CLOSED. */
  servingState?: StatusPageServingState;
  /** Pointer to the last successfully published projection, preserved across SUPERSEDED. */
  lastGoodRevision?: string | null;
  lastGoodSnapshotKey?: string | null;
  lastGoodIntegrityHash?: string | null;
}

/** A legacy manifest carries no decision, so it must not unlock stale serving. */
export function manifestServingState(
  manifest: Pick<StatusServingManifest, 'servingState'>
): StatusPageServingState {
  switch (manifest.servingState) {
    case 'LIVE':
    case 'STALE_OK':
    case 'FAIL_CLOSED':
    case 'DISABLED':
      return manifest.servingState;
    default:
      return 'FAIL_CLOSED';
  }
}

export interface StatusServingRoute {
  pageId: string;
  slug: string | null;
  requireAuth: boolean;
  revision: string;
}

function isSafeStatusSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value.split('-').every(part => part.length > 0 && /^[a-z0-9]+$/.test(part))
  );
}

const routeSchema = z
  .object({
    pageId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    slug: z.string().refine(isSafeStatusSlug).nullable(),
    requireAuth: z.boolean(),
    revision: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();

const snapshotKeySchema = z.string().regex(/^\d+\.json$/);

const manifestSchema = z.object({
  pageId: z.string(),
  revision: z.string(),
  enabled: z.boolean(),
  revoked: z.boolean(),
  snapshotKey: z.string(),
  publishedAt: z.string().datetime({ offset: true }),
  schemaVersion: z.number().int().positive(),
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/),
  servingState: z.enum(['LIVE', 'STALE_OK', 'FAIL_CLOSED', 'DISABLED']).optional(),
  lastGoodRevision: z
    .string()
    .regex(/^-?\d+$/)
    .nullish(),
  lastGoodSnapshotKey: snapshotKeySchema.nullish(),
  lastGoodIntegrityHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullish(),
});

export function statusSnapshotIntegrity(snapshot: Prisma.JsonValue) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export interface StatusPageServingStore {
  publishRoute(routeKey: string, route: StatusServingRoute): Promise<void>;
  /**
   * Idempotent. Must not remove a key that has since been claimed by another page, otherwise
   * renaming a slug back and forth can take an unrelated page dark.
   */
  removeRoute(routeKey: string, expectedPageId: string): Promise<void>;
  resolveRoute(routeKey: string): Promise<StatusServingRoute | null>;
  publishManifest(manifest: StatusServingManifest): Promise<void>;
  publishSnapshot(pageId: string, revision: string, snapshot: Prisma.JsonValue): Promise<void>;
  readManifest(pageId: string): Promise<StatusServingManifest | null>;
  readSnapshot(pageId: string, revision: string): Promise<Prisma.JsonValue | null>;
  /**
   * The last successfully published projection, and only while the serving state says it is
   * safe to show. Integrity is verified here so callers cannot forget to.
   */
  readLastGoodSnapshot(
    pageId: string
  ): Promise<{ revision: string; payload: Prisma.JsonValue } | null>;
  revoke(pageId: string, reason: StatusPageRevocationReason): Promise<void>;
}

async function observed<T>(operation: string, task: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await task();
  } catch (error) {
    addOperationalMetric('opsknight_status_serving_store_errors_total', 1, { operation });
    throw error;
  } finally {
    observeOperationalHistogram(
      'opsknight_status_serving_store_latency_seconds',
      (performance.now() - startedAt) / 1_000,
      { operation }
    );
  }
}

class PostgreSqlStatusPageServingStore implements StatusPageServingStore {
  // Routes are derived from StatusPage.slug/isDefault/customDomain/subdomain, so they switch
  // atomically with the configuration commit; there is no key store to write or clean up.
  async publishRoute(): Promise<void> {}
  async removeRoute(): Promise<void> {}
  async resolveRoute(routeKey: string): Promise<StatusServingRoute | null> {
    return observed('resolve_route', () => this.resolveRouteUncounted(routeKey));
  }

  private async resolveRouteUncounted(routeKey: string): Promise<StatusServingRoute | null> {
    const domain = routeKey.startsWith('domain:') ? routeKey.slice('domain:'.length) : null;
    const subdomain = routeKey.startsWith('subdomain:')
      ? routeKey.slice('subdomain:'.length)
      : null;
    const page = await prisma.statusPage.findFirst({
      where: domain
        ? { customDomain: domain }
        : subdomain
          ? {
              OR: [{ subdomain }, ...(subdomain === 'status' ? [{ isDefault: true }] : [])],
            }
          : routeKey === 'default'
            ? { isDefault: true }
            : { slug: routeKey },
      select: {
        id: true,
        slug: true,
        requireAuth: true,
        snapshot: { select: { publishedRevision: true } },
      },
    });
    return page
      ? {
          pageId: page.id,
          slug: page.slug,
          requireAuth: page.requireAuth,
          revision: page.snapshot?.publishedRevision.toString() ?? '-1',
        }
      : null;
  }
  async publishManifest(): Promise<void> {}
  async publishSnapshot(): Promise<void> {}

  async readManifest(pageId: string): Promise<StatusServingManifest | null> {
    return observed('read_manifest', async () => {
      const row = await prisma.statusPageSnapshot.findUnique({ where: { statusPageId: pageId } });
      if (!row) return null;
      return {
        pageId,
        revision: row.publishedRevision.toString(),
        enabled: row.servingState !== 'DISABLED',
        // Only ever adds a reason to withhold, so nothing dark today becomes visible from here.
        revoked:
          row.publishedRevision !== row.revision || !row.payload || row.servingState !== 'LIVE',
        snapshotKey: `${row.publishedRevision}.json`,
        publishedAt: row.generatedAt?.toISOString() ?? new Date(0).toISOString(),
        schemaVersion: 3,
        integrityHash: row.payload ? statusSnapshotIntegrity(row.payload) : '0'.repeat(64),
        servingState: row.servingState as StatusPageServingState,
        lastGoodRevision:
          row.publishedRevision >= BigInt(0) ? row.publishedRevision.toString() : null,
        lastGoodSnapshotKey:
          row.publishedRevision >= BigInt(0) ? `${row.publishedRevision}.json` : null,
        lastGoodIntegrityHash: row.payload ? statusSnapshotIntegrity(row.payload) : null,
      };
    });
  }

  async readSnapshot(pageId: string, revision: string): Promise<Prisma.JsonValue | null> {
    return observed('read_snapshot', async () => {
      const row = await prisma.statusPageSnapshot.findUnique({
        where: { statusPageId: pageId },
        select: { payload: true, publishedRevision: true, revision: true },
      });
      return row &&
        row.revision === row.publishedRevision &&
        row.publishedRevision.toString() === revision
        ? row.payload
        : null;
    });
  }

  async readLastGoodSnapshot(pageId: string) {
    return observed('read_last_good_snapshot', async () => {
      const row = await prisma.statusPageSnapshot.findUnique({
        where: { statusPageId: pageId },
        select: { payload: true, publishedRevision: true, servingState: true },
      });
      return row?.servingState === 'STALE_OK' && row.payload && row.publishedRevision >= BigInt(0)
        ? { revision: row.publishedRevision.toString(), payload: row.payload }
        : null;
    });
  }

  async revoke(pageId: string, reason: StatusPageRevocationReason): Promise<void> {
    await observed('revoke', async () => {
      // SUPERSEDED deliberately leaves payload and publishedRevision alone: the pointer to the
      // last good projection is what makes serve-while-rebuilding possible. The fail-closed
      // reasons also reset publishedRevision so a reader predating servingState still withholds.
      const data: Prisma.StatusPageSnapshotUpdateManyMutationInput =
        reason === 'SUPERSEDED'
          ? { servingState: 'STALE_OK' }
          : reason === 'DISABLED'
            ? { servingState: 'DISABLED', publishedRevision: BigInt(-1) }
            : reason === 'DELETED'
              ? {
                  servingState: 'FAIL_CLOSED',
                  publishedRevision: BigInt(-1),
                  payload: Prisma.DbNull,
                }
              : { servingState: 'FAIL_CLOSED', publishedRevision: BigInt(-1) };
      await prisma.statusPageSnapshot.updateMany({ where: { statusPageId: pageId }, data });
      addOperationalMetric('opsknight_status_page_revocations_total', 1, { reason });
    });
  }
}

class HttpStatusPageServingStore implements StatusPageServingStore {
  private readonly origin: URL;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {
    const origin = new URL(baseUrl);
    if (origin.protocol !== 'https:' || origin.username || origin.password) {
      throw new Error('STATUS_PAGE_SERVING_STORE_URL must be an HTTPS origin without credentials');
    }
    this.origin = origin;
  }

  private async request(path: string, init?: RequestInit) {
    const url = new URL(path, this.origin.pathname.endsWith('/') ? this.origin : `${this.origin}/`);
    if (url.origin !== this.origin.origin)
      throw new Error('Serving store request escaped its origin');
    const { assertSafeOutboundUrl, safeOutboundFetch } = await import('@/lib/network-security');
    await assertSafeOutboundUrl(url.toString());
    const signal = init?.signal ?? AbortSignal.timeout(10_000);
    return safeOutboundFetch(url.toString(), {
      ...init,
      signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      cache: 'no-store',
    });
  }

  async publishRoute(routeKey: string, route: StatusServingRoute): Promise<void> {
    await observed('publish_route', async () => {
      const response = await this.request(`status-pages/routes/${encodeURIComponent(routeKey)}`, {
        method: 'PUT',
        body: JSON.stringify(route),
      });
      if (!response.ok) throw new Error(`Serving store route publish failed (${response.status})`);
    });
  }

  async removeRoute(routeKey: string, expectedPageId: string): Promise<void> {
    await observed('remove_route', async () => {
      // Another page may have claimed the key in the meantime; deleting it would take that
      // page dark. Leaving a surplus route pointing at a live page is the safer failure.
      const current = await this.resolveRoute(routeKey);
      if (!current || current.pageId !== expectedPageId) return;
      const response = await this.request(`status-pages/routes/${encodeURIComponent(routeKey)}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Serving store route removal failed (${response.status})`);
      }
    });
  }

  async resolveRoute(routeKey: string): Promise<StatusServingRoute | null> {
    return observed('resolve_route', async () => {
      const response = await this.request(`status-pages/routes/${encodeURIComponent(routeKey)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Serving store route lookup failed (${response.status})`);
      const parsed = routeSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    });
  }

  async publishManifest(manifest: StatusServingManifest): Promise<void> {
    await observed('publish_manifest', async () => {
      const response = await this.request(`status-pages/${manifest.pageId}/manifest`, {
        method: 'PUT',
        body: JSON.stringify(manifest),
      });
      if (!response.ok)
        throw new Error(`Serving store manifest publish failed (${response.status})`);
    });
  }

  async publishSnapshot(
    pageId: string,
    revision: string,
    snapshot: Prisma.JsonValue
  ): Promise<void> {
    await observed('publish_snapshot', async () => {
      const response = await this.request(`status-pages/${pageId}/${revision}.json`, {
        method: 'PUT',
        body: JSON.stringify(snapshot),
      });
      if (!response.ok)
        throw new Error(`Serving store snapshot publish failed (${response.status})`);
    });
  }

  async readManifest(pageId: string): Promise<StatusServingManifest | null> {
    return observed('read_manifest', async () => {
      const response = await this.request(`status-pages/${pageId}/manifest`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Serving store manifest read failed (${response.status})`);
      const parsed = manifestSchema.safeParse(await response.json());
      if (!parsed.success) {
        logger.error('status.serving_store.manifest_invalid', {
          pageId,
          issues: parsed.error.issues.map(issue => issue.path.join('.')),
        });
        return null;
      }
      return parsed.data;
    });
  }

  async readSnapshot(pageId: string, revision: string): Promise<Prisma.JsonValue | null> {
    return observed('read_snapshot', async () => {
      const response = await this.request(`status-pages/${pageId}/${revision}.json`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Serving store snapshot read failed (${response.status})`);
      return (await response.json()) as Prisma.JsonValue;
    });
  }

  async readLastGoodSnapshot(pageId: string) {
    return observed('read_last_good_snapshot', async () => {
      const manifest = await this.readManifest(pageId);
      if (!manifest || manifestServingState(manifest) !== 'STALE_OK') return null;
      const { lastGoodRevision, lastGoodSnapshotKey, lastGoodIntegrityHash } = manifest;
      if (!lastGoodRevision || !lastGoodSnapshotKey || !lastGoodIntegrityHash) return null;
      // The key is interpolated into a URL path, so it is validated rather than trusted.
      if (!snapshotKeySchema.safeParse(lastGoodSnapshotKey).success) return null;
      const response = await this.request(`status-pages/${pageId}/${lastGoodSnapshotKey}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Serving store snapshot read failed (${response.status})`);
      const payload = (await response.json()) as Prisma.JsonValue;
      return statusSnapshotIntegrity(payload) === lastGoodIntegrityHash
        ? { revision: lastGoodRevision, payload }
        : null;
    });
  }

  async revoke(pageId: string, reason: StatusPageRevocationReason): Promise<void> {
    const current = await this.readManifest(pageId);
    const base = {
      pageId,
      publishedAt: new Date().toISOString(),
      schemaVersion: 3,
    };
    if (reason === 'SUPERSEDED' && current) {
      // Preserve the body pointer. Blanking snapshotKey here is what previously made
      // serve-while-rebuilding impossible for this backend.
      await this.publishManifest({
        ...current,
        ...base,
        revoked: true,
        servingState: 'STALE_OK',
        lastGoodRevision: current.lastGoodRevision ?? current.revision,
        lastGoodSnapshotKey: current.lastGoodSnapshotKey ?? current.snapshotKey,
        lastGoodIntegrityHash: current.lastGoodIntegrityHash ?? current.integrityHash,
      });
    } else {
      await this.publishManifest({
        ...base,
        revision: '-1',
        enabled: reason !== 'DISABLED',
        revoked: true,
        snapshotKey: '',
        integrityHash: '0'.repeat(64),
        servingState: reason === 'DISABLED' ? 'DISABLED' : 'FAIL_CLOSED',
        lastGoodRevision: null,
        lastGoodSnapshotKey: null,
        lastGoodIntegrityHash: null,
      });
    }
    addOperationalMetric('opsknight_status_page_revocations_total', 1, { reason });
  }
}

export function getStatusPageServingStore(): StatusPageServingStore {
  const baseUrl = process.env.STATUS_PAGE_SERVING_STORE_URL?.trim();
  const token = process.env.STATUS_PAGE_SERVING_STORE_TOKEN?.trim();
  return scalingFeatureEnabled('STATUS_PAGE_EXTERNAL_SERVING_STORE') && baseUrl && token
    ? new HttpStatusPageServingStore(baseUrl, token)
    : new PostgreSqlStatusPageServingStore();
}
