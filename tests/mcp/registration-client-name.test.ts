import { describe, expect, it } from 'vitest';
import { registrationSchema } from '@/lib/mcp/auth/registration';

const register = (client_name: unknown) =>
  registrationSchema.safeParse({
    client_name,
    redirect_uris: ['https://client.example.com/callback'],
  });

describe('a self-registered assistant name', () => {
  it('loses right-to-left overrides and zero-width characters, which could disguise it on the consent screen', () => {
    const parsed = register('Claude\u202e\u200b ' + 'evil');
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.client_name).toBe('Claude evil');
  });

  it('is refused when nothing visible is left', () => {
    expect(register('\u200b\u202e\u200d').success).toBe(false);
  });

  it('keeps ordinary non-Latin names', () => {
    const parsed = register('مساعد OpsKnight 日本語');
    expect(parsed.success && parsed.data.client_name).toBe('مساعد OpsKnight 日本語');
  });
});
