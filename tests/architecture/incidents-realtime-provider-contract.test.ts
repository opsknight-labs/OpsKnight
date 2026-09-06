import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('incidents realtime provider contract', () => {
  it('keeps the standalone incidents list inside a realtime provider', () => {
    const source = readFileSync('src/app/(app)/incidents/page.tsx', 'utf8');
    expect(source).toContain("import { RealtimeProvider } from '@/hooks/useRealtime'");
    expect(source).toMatch(
      /<RealtimeProvider>[\s\S]*<IncidentsListTable[\s\S]*<\/RealtimeProvider>/
    );
  });
});
