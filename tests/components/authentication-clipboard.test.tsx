import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyAuthenticationText } from '@/components/settings/authentication/clipboard';
afterEach(() => vi.unstubAllGlobals());
describe('authentication clipboard fallback', () => {
  it('falls back when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyAuthenticationText('local-fixture')).toBe(false);
  });
  it('falls back after denied clipboard permission', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    expect(await copyAuthenticationText('local-fixture')).toBe(false);
  });
  it('copies only the explicitly requested value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyAuthenticationText('local-fixture')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('local-fixture');
  });
});
