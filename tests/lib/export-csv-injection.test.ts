// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { exportToCsv } from '@/lib/export-csv';

describe('exportToCsv', () => {
  it('neutralises spreadsheet formulas but keeps numbers', () => {
    let text = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          text = parts.join('');
        }
      }
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    exportToCsv(
      'events',
      [{ header: 'v', accessor: (r: { v: unknown }) => r.v as string }],
      [{ v: '=HYPERLINK("http://evil")' }, { v: -5 }]
    );
    vi.unstubAllGlobals();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain('"-5"');
  });
});
