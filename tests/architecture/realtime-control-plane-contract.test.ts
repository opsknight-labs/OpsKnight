import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => ts.sys.readFile(path.join(process.cwd(), relative)) ?? '';

describe('realtime event control-plane architecture', () => {
  it('uses transactional statement triggers and a bounded signal tail', () => {
    const migration = read(
      'prisma/migrations/20260905220000_add_realtime_change_feed/migration.sql'
    );
    expect(migration).toContain('FOR EACH STATEMENT');
    expect(migration).toContain('RETURNING "id" INTO change_id');
    expect(migration).toContain('change_id - 10000');
    expect(migration).toContain('SET search_path = pg_catalog, public');
  });

  it('keeps projection polling out of per-client dashboard and widget loops', () => {
    for (const route of [
      'src/app/api/realtime/stream/route.ts',
      'src/app/api/widgets/stream/route.ts',
    ]) {
      const source = read(route);
      expect(source).toContain('subscribeToRealtimeChanges');
      expect(source).not.toMatch(
        /setInterval\(async \(\) => \{[\s\S]*getCached(?:Dashboard|Widget)/
      );
    }
  });
});
