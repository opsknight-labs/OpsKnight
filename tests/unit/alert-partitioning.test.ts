// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  COPY_BATCH_SQL,
  monthsBetween,
  partitionMonth,
  partitionName,
  partitionedIndexSql,
  planConversion,
  planMaintenance,
  type ConversionInput,
} from '@/lib/alerts/partitioning';

const input = (overrides: Partial<ConversionInput> = {}): ConversionInput => ({
  indexes: [
    {
      name: 'Alert_pkey',
      definition: 'CREATE UNIQUE INDEX "Alert_pkey" ON public."Alert" USING btree (id)',
      unique: true,
      primary: true,
    },
    {
      name: 'idx_alert_by_service',
      definition:
        'CREATE INDEX idx_alert_by_service ON public."Alert" USING btree ("serviceId", "createdAt")',
      unique: false,
      primary: false,
    },
  ],
  ownForeignKeys: [
    {
      name: 'Alert_serviceId_fkey',
      table: 'Alert',
      definition:
        'FOREIGN KEY ("serviceId") REFERENCES "Service"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
  ],
  referencingForeignKeys: [
    {
      name: 'AlertFingerprint_alertId_fkey',
      table: 'AlertFingerprint',
      definition: 'FOREIGN KEY ("alertId") REFERENCES "Alert"(id) ON DELETE CASCADE',
    },
  ],
  oldest: new Date('2026-09-15T00:00:00Z'),
  now: new Date('2026-11-21T10:00:00Z'),
  monthsAhead: 2,
  ...overrides,
});

describe('alert partition naming', () => {
  it('round-trips month names and ignores the default and foreign tables', () => {
    const month = new Date(Date.UTC(2026, 0, 1));
    expect(partitionName(month)).toBe('Alert_p202601');
    expect(partitionMonth('Alert_p202601')).toEqual(month);
    expect(partitionMonth('Alert_pdefault')).toBeNull();
    expect(partitionMonth('Alert_p202613')).toBeNull();
  });

  it('spans whole months across a year boundary', () => {
    expect(
      monthsBetween(new Date('2026-11-30T23:59:59Z'), new Date('2027-01-01T00:00:00Z')).map(
        partitionName
      )
    ).toEqual(['Alert_p202611', 'Alert_p202612', 'Alert_p202701']);
  });
});

describe('planConversion', () => {
  const plan = planConversion(input());

  it('prepares a partitioned shadow with a composite key, monthly ranges, a default and the mirror', () => {
    expect(plan.prepare[0]).toMatch(
      /^CREATE TABLE "Alert_partitioned" \(LIKE "Alert" .*PARTITION BY RANGE \("createdAt"\)$/
    );
    expect(plan.prepare[1]).toContain('PRIMARY KEY ("id", "createdAt")');
    const partitions = plan.prepare.filter(sql =>
      /PARTITION OF "Alert_partitioned" FOR VALUES/.test(sql)
    );
    // September (oldest) through January (now + 2 months).
    expect(partitions).toHaveLength(5);
    expect(partitions[0]).toContain(
      `"Alert_p202609" PARTITION OF "Alert_partitioned" FOR VALUES FROM ('2026-09-01 00:00:00') TO ('2026-10-01 00:00:00')`
    );
    expect(plan.prepare).toContain(
      'CREATE TABLE IF NOT EXISTS "Alert_pdefault" PARTITION OF "Alert_partitioned" DEFAULT'
    );
    expect(plan.prepare).toContain(
      'CREATE INDEX "idx_alert_by_service_p" ON public."Alert_partitioned" USING btree ("serviceId", "createdAt")'
    );
    expect(plan.prepare.some(sql => sql.includes('Alert_serviceId_fkey'))).toBe(true);
    expect(plan.prepare.at(-1)).toMatch(
      /CREATE TRIGGER alert_partition_mirror_forward AFTER INSERT OR UPDATE OR DELETE ON "Alert"/
    );
    // No statement touches the live table's data or structure during prepare.
    expect(
      plan.prepare.some(sql =>
        /ALTER TABLE "Alert" |DROP|TRUNCATE|DELETE FROM "Alert"/.test(sql.split('$mirror$')[0])
      )
    ).toBe(false);
  });

  it('swaps under one lock, moves the fingerprint key to the composite and mirrors back', () => {
    expect(plan.swap.slice(0, 2)).toEqual([
      "SET LOCAL lock_timeout = '5s'",
      'LOCK TABLE "Alert" IN ACCESS EXCLUSIVE MODE',
    ]);
    const order = (needle: string) => plan.swap.findIndex(sql => sql.includes(needle));
    expect(order('RENAME TO "Alert_unpartitioned"')).toBeLessThan(
      order('ALTER TABLE "Alert_partitioned" RENAME TO "Alert"')
    );
    expect(plan.swap).toContain(
      'ALTER TABLE "AlertFingerprint" ADD CONSTRAINT "AlertFingerprint_alertId_fkey" FOREIGN KEY ("alertId", "alertCreatedAt") REFERENCES "Alert"("id", "createdAt") ON DELETE CASCADE NOT VALID'
    );
    expect(plan.swap).toContain(
      'ALTER INDEX "idx_alert_by_service_p" RENAME TO "idx_alert_by_service"'
    );
    expect(plan.swap.at(-1)).toContain('alert_partition_mirror_reverse');
  });

  it('rollback restores the original names and the single-column fingerprint key', () => {
    expect(plan.rollback).toContain('ALTER TABLE "Alert_unpartitioned" RENAME TO "Alert"');
    expect(plan.rollback).toContain(
      'ALTER INDEX "idx_alert_by_service_unpart" RENAME TO "idx_alert_by_service"'
    );
    expect(plan.rollback.at(-1)).toBe(
      'ALTER TABLE "AlertFingerprint" ADD CONSTRAINT "AlertFingerprint_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE NOT VALID'
    );
  });

  it('finalize validates the key and retires, never drops, the old table', () => {
    expect(plan.finalize).toContain(
      'ALTER TABLE "AlertFingerprint" VALIDATE CONSTRAINT "AlertFingerprint_alertId_fkey"'
    );
    expect(plan.finalize.at(-1)).toBe(
      'ALTER TABLE "Alert_unpartitioned" RENAME TO "Alert_unpartitioned_retired"'
    );
    expect(plan.finalize.some(sql => /DROP TABLE/.test(sql))).toBe(false);
  });

  it('refuses shapes it cannot convert', () => {
    expect(() =>
      planConversion(
        input({
          indexes: [
            {
              name: 'Alert_dedup_key',
              definition:
                'CREATE UNIQUE INDEX "Alert_dedup_key" ON public."Alert" USING btree ("dedupKey")',
              unique: true,
              primary: false,
            },
          ],
        })
      )
    ).toThrow(/does not include "createdAt"/);
    expect(() =>
      planConversion(
        input({ referencingForeignKeys: [{ name: 'x_fkey', table: 'Other', definition: '' }] })
      )
    ).toThrow(/Unsupported foreign key/);
    expect(() => planConversion(input({ monthsAhead: 0 }))).toThrow(/monthsAhead/);
    expect(() =>
      partitionedIndexSql({
        name: 'x',
        definition: 'CREATE INDEX x ON "Other" (a)',
        unique: false,
        primary: false,
      })
    ).toThrow(/Unrecognised/);
  });

  it('starts at the current month on an empty table', () => {
    const empty = planConversion(input({ oldest: null }));
    expect(empty.prepare.filter(sql => /FOR VALUES FROM/.test(sql))).toHaveLength(3);
  });

  it('copies in keyset batches that lock source rows and never overwrite mirrored ones', () => {
    expect(COPY_BATCH_SQL).toContain('("createdAt", "id") > ($1::timestamp(3), $2::text)');
    expect(COPY_BATCH_SQL).toContain('FOR SHARE');
    expect(COPY_BATCH_SQL).toContain('ON CONFLICT DO NOTHING');
  });
});

describe('planMaintenance', () => {
  const now = new Date('2026-11-21T00:00:00Z');

  it('creates only the missing current and future months', () => {
    const plan = planMaintenance({
      existing: ['Alert_p202611', 'Alert_pdefault'],
      now,
      monthsAhead: 2,
      retentionMonths: 0,
    });
    expect(plan.create).toEqual([
      `CREATE TABLE IF NOT EXISTS "Alert_p202612" PARTITION OF "Alert" FOR VALUES FROM ('2026-12-01 00:00:00') TO ('2027-01-01 00:00:00')`,
      `CREATE TABLE IF NOT EXISTS "Alert_p202701" PARTITION OF "Alert" FOR VALUES FROM ('2027-01-01 00:00:00') TO ('2027-02-01 00:00:00')`,
    ]);
    expect(plan.detach).toEqual([]);
  });

  it('detaches months that ended before the retention cutoff, never the default', () => {
    const plan = planMaintenance({
      existing: [
        'Alert_p202608',
        'Alert_p202607',
        'Alert_p202609',
        'Alert_pdefault',
        'Alert_p202611',
      ],
      now,
      monthsAhead: 1,
      retentionMonths: 2,
    });
    // Cutoff is 2026-09-01: July and August ended on or before it, September did not.
    expect(plan.detach).toEqual([
      'ALTER TABLE "Alert" DETACH PARTITION "Alert_p202607"',
      'ALTER TABLE "Alert" DETACH PARTITION "Alert_p202608"',
    ]);
  });
});
