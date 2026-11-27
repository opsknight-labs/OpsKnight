import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword } from '@/lib/auth';
import { validatePasswordStrength } from '@/lib/passwords';

// Generated with bcryptjs 2.4.3 before the v3 upgrade. Keep these independent
// of the installed implementation so a hash-format regression cannot silently
// invalidate existing credentials. The cost of 4 is only for these fixtures.
const legacyCredentials = [
  {
    label: 'ASCII passphrase',
    password: 'a legacy local passphrase',
    hash: '$2a$04$abcdefghijklmnopqrstuuqm/4r2x8xBU5ChKfWF43Hj4TZDVhPkK',
  },
  {
    label: 'Unicode with decomposed accents and a supplementary character',
    password: 'Café e\u0301 🔒 legacy phrase',
    hash: '$2a$04$abcdefghijklmnopqrstuu0qAWWo8ULOTzzHVwC5wVs.EhpYhfbVu',
  },
  {
    label: '64-character boundary',
    password: 'x'.repeat(64),
    hash: '$2a$04$abcdefghijklmnopqrstuuI/zbVz7rMQrNxQD2FUlNoUjOA96U/ge',
  },
  {
    label: '72-byte UTF-8 boundary',
    password: 'é'.repeat(24) + 'z'.repeat(24),
    hash: '$2a$04$abcdefghijklmnopqrstuuzsig0EMPsCjNo9kzTWzPnjdWr6bXHSm',
  },
  {
    label: 'significant leading and trailing spaces',
    password: '  keep these spaces  ',
    hash: '$2a$04$abcdefghijklmnopqrstuuNhZEpE3ygIIvjx6Fd5./w.JrL/m7tle',
  },
];

describe('password hash upgrade compatibility', () => {
  it.each(legacyCredentials)(
    'preserves existing $label credentials',
    async ({ password, hash }) => {
      expect(await bcrypt.compare(password, hash)).toBe(true);
      // Change the first byte, rather than append a suffix beyond bcrypt's limit.
      expect(await bcrypt.compare(`!${password.slice(1)}`, hash)).toBe(false);
      expect(bcrypt.hashSync(password, bcrypt.getSalt(hash))).toBe(hash);
    }
  );

  it.each(['2b', '2y'])('still verifies the supported $%s$ hash prefix', async prefix => {
    const credential = legacyCredentials[0];
    const hash = credential.hash.replace('$2a$', `$${prefix}$`);
    expect(await bcrypt.compare(credential.password, hash)).toBe(true);
    expect(await bcrypt.compare('an incorrect passphrase', hash)).toBe(false);
  });

  it('does not normalize Unicode or trim existing passwords while verifying', async () => {
    const unicode = legacyCredentials[1];
    const spaced = legacyCredentials[4];
    expect(await bcrypt.compare(unicode.password.normalize('NFC'), unicode.hash)).toBe(false);
    expect(await bcrypt.compare(spaced.password.trim(), spaced.hash)).toBe(false);
  });

  it('keeps the application cost at 12 while generating the new $2b$ format', async () => {
    const password = 'a new local login passphrase';
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(bcrypt.getRounds(hash)).toBe(12);
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(await bcrypt.compare('incorrect local login passphrase', hash)).toBe(false);
  });

  it('rejects creation above 72 bytes instead of depending on silent bcrypt truncation', () => {
    const boundary = legacyCredentials[3].password;
    expect(Buffer.byteLength(boundary, 'utf8')).toBe(72);
    expect(validatePasswordStrength(boundary)).toBeNull();
    expect(validatePasswordStrength(`${boundary}z`)).toContain('72 UTF-8 bytes');
  });
});
