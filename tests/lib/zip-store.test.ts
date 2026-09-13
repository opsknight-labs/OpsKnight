import { describe, expect, it } from 'vitest';
import { buildStoredZip } from '@/lib/zip-store';

describe('buildStoredZip', () => {
  it('builds a deterministic ZIP with local, central, and end records', () => {
    const zip = buildStoredZip([
      { name: 'manifest.json', data: new TextEncoder().encode('{}') },
      { name: 'color.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 14, true)).toBe(2);
    expect(new TextDecoder().decode(zip)).toContain('manifest.json');
    expect(new TextDecoder().decode(zip)).toContain('color.png');
    expect(buildStoredZip([{ name: 'a', data: new Uint8Array([1]) }])).toEqual(buildStoredZip([{ name: 'a', data: new Uint8Array([1]) }]));
  });
});
