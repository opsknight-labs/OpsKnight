/**
 * Central password policy shared by every credential-setting flow.
 *
 * Passwords are treated as opaque user secrets: we do not trim or normalize the
 * value before hashing. NFKC/case folding is used only for compromised/default
 * password comparisons so creation and authentication retain identical bytes.
 */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 64;
export const PASSWORD_MAX_UTF8_BYTES = 72;

/**
 * Request/HTML transport guard only. JavaScript and browser maxLength count
 * UTF-16 code units, not Unicode code points, so this must be deliberately
 * larger than PASSWORD_MAX_LENGTH. validatePasswordStrength() owns the semantic
 * 64-code-point and bcrypt-byte limits.
 */
export const PASSWORD_TRANSPORT_MAX_CODE_UNITS = 256;

export type PasswordValidationContext = {
  email?: string | null;
  displayName?: string | null;
  organizationName?: string | null;
  hostname?: string | null;
};

/**
 * Versioned local denylist. This is intentionally offline so credential
 * mutation never depends on a third-party availability/privacy boundary.
 * Entries focus on defaults and long/common values that could otherwise pass
 * the minimum-length rule. The API is deliberately stable so this can be
 * replaced by a compact versioned Bloom filter / breached-password corpus.
 */
export const PASSWORD_BLOCKLIST_VERSION = '2026-09-11.1';
const COMPROMISED_PASSWORDS = new Set([
  '123456789012345',
  '1234567890123456',
  '12345678901234567',
  '123456789012345678',
  '1234567890123456789',
  '12345678901234567890',
  '111111111111111',
  '000000000000000',
  'passwordpassword',
  'passwordpassword1',
  'password123456789',
  'password1234567890',
  'password12345678',
  'password1234567',
  'password123456',
  'password12345',
  'password1234password',
  'qwertyqwertyqwerty',
  'qwerty123456789',
  'qwertyuiopasdfgh',
  'qwertyuiop123456',
  'asdfghjkl123456',
  'asdfasdfasdfasdf',
  'zxcvzxcvzxcvzxcv',
  'letmeinletmeinletmein',
  'letmein123456789',
  'adminadminadmin',
  'adminadminadmin1',
  'administrator123',
  'administrator1234',
  'administrator12345',
  'welcome123456789',
  'welcome1234567890',
  'welcome123welcome',
  'changemechangeme',
  'changeme123456789',
  'changeme12345678',
  'defaultpassword',
  'defaultpassword1',
  'defaultpassword123',
  'temporarypassword',
  'temporarypassword1',
  'temporarypassword123',
  'temp password 123',
  'newpassword123456',
  'newpassword1234567',
  'newpassword12345678',
  'mynewpassword123',
  'mypassword123456',
  'mypassword1234567',
  'mypassword12345678',
  'correcthorsebatterystaple',
  'correct horse battery staple',
  'trustnoone123456',
  'iloveyouiloveyou',
  'iloveyou123456789',
  'sunshinesunshine',
  'princessprincess',
  'footballfootball',
  'baseballbaseball',
  'basketballbasketball',
  'monkeymonkeymonkey',
  'dragon123456789',
  'master123456789',
  'superman123456789',
  'starwars123456789',
  'whateverwhatever',
  'freedom123456789',
  'passphrase123456',
  'securepassword123',
  'securepassword1234',
  'strongpassword123',
  'strongpassword1234',
  'companypassword123',
  'companypassword1234',
  'opsknightopsknight',
  'opsknight123456789',
  'opsknightpassword',
  'opsknightpassword1',
  'opsknightadmin123',
  'incidentresponse123',
  'incidentresponse1234',
  'devopsdevopsdevops',
  'devops1234567890',
  'kubernetes1234567',
  'kubernetes12345678',
  'terraform123456789',
  'production123456',
  'production1234567',
  'productionpassword',
  'stagingpassword123',
  'securitypassword123',
  'security123456789',
  'authentication123',
  'authentication1234',
  'thisisapassword',
  'thisismypassword',
  'this is a password',
  'this is my password',
  'pleasechangeme123',
  'pleasechangeme1234',
  'pleasechangethis',
  'passwordforwork123',
  'workpassword123456',
  'officepassword1234',
  'companyname123456',
  'username123456789',
  'firstname123456789',
  'lastname1234567890',
]);

function comparisonForm(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

/** Unicode code-point length. This intentionally does not mutate the secret. */
export function getPasswordCharacterLength(password: string): number {
  return Array.from(password).length;
}

export function getPasswordUtf8Length(password: string): number {
  return new TextEncoder().encode(password).length;
}

function identityCandidates(context?: PasswordValidationContext): Set<string> {
  const candidates = new Set<string>();
  if (!context) return candidates;

  const add = (value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized) return;
    candidates.add(comparisonForm(normalized));
  };

  add(context.displayName);
  add(context.organizationName);
  add(context.hostname);
  add(context.email);
  if (context.email) add(context.email.split('@')[0]);
  return candidates;
}

/**
 * Offline compromised/default-password abstraction. Keep network lookups out of
 * credential mutation paths; the backing corpus can later be replaced by a
 * versioned Bloom filter or hashed breach corpus without changing callers.
 */
export function isCompromisedPassword(
  password: string,
  context?: PasswordValidationContext
): boolean {
  const candidate = comparisonForm(password);
  if (COMPROMISED_PASSWORDS.has(candidate)) return true;

  // Reject secrets that are exactly a user/instance identifier. Avoid broad
  // substring checks, which cause surprising false positives for passphrases.
  return identityCandidates(context).has(candidate);
}

/** @deprecated Prefer isCompromisedPassword. */
export function isCommonPassword(password: string): boolean {
  return isCompromisedPassword(password);
}

export function validatePasswordStrength(
  password: string,
  context?: PasswordValidationContext
): string | null {
  if (typeof password !== 'string') return 'Password is required.';

  const characterLength = getPasswordCharacterLength(password);
  if (characterLength < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (characterLength > PASSWORD_MAX_LENGTH) {
    return `Password must not exceed ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (getPasswordUtf8Length(password) > PASSWORD_MAX_UTF8_BYTES) {
    return `Password is too long for the current password hashing backend (maximum ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes).`;
  }
  if (password.includes('\u0000')) {
    return 'Password contains an unsupported null character.';
  }
  if (isCompromisedPassword(password, context)) {
    return 'Choose a password that is not a commonly used, default, or account-identifying password.';
  }
  return null;
}
