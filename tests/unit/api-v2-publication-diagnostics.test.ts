import { expect, it } from 'vitest';
import {
  safePublicationDiagnostic,
  safePublicationResult,
} from '@/lib/status-pages/publication-diagnostics';
it('normalizes errors without mutating the stored diagnostic', () => {
  const source = {
    status: 'FAILED',
    revision: '2',
    lastError: 'https://user:secret@internal.invalid',
  };
  expect(safePublicationDiagnostic(source)).toEqual({
    ...source,
    lastError: 'PUBLICATION_RECONCILIATION_FAILED',
  });
  expect(source.lastError).toContain('user:secret');
  expect(safePublicationResult({ revision: 4, publication: source })).toEqual({
    revision: 4,
    publication: { ...source, lastError: 'PUBLICATION_RECONCILIATION_FAILED' },
  });
});
it('preserves successful and absent diagnostics', () => {
  const live = { status: 'LIVE', revision: '3', lastError: null };
  expect(safePublicationDiagnostic(live)).toBe(live);
  expect(safePublicationResult({ publication: live }).publication).toBe(live);
});
