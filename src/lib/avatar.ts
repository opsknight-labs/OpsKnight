/**
 * Curated modern palette for default avatars (clean, accessible tones).
 */
export const MODERN_AVATAR_PALETTE = [
  '6366f1', // Indigo
  '3b82f6', // Blue
  '8b5cf6', // Violet
  '0d9488', // Teal
  '0284c7', // Sky
  'ec4899', // Pink
  '10b981', // Emerald
  'f59e0b', // Amber
  '64748b', // Slate
];

export function getDeterministicColor(seed: string): string {
  let hash = 0;
  const str = seed || 'user';
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % MODERN_AVATAR_PALETTE.length;
  return MODERN_AVATAR_PALETTE.at(index) ?? '6366f1';
}

/**
 * Extract clean 1-2 letter initials from a display name, email, or identifier.
 * e.g. "System Admin" -> "SA"
 * e.g. "admin@example.com" -> "AD"
 * e.g. "Dushyant" -> "DU"
 */
export function extractInitials(nameOrIdentifier: string | null | undefined): string {
  if (!nameOrIdentifier) return 'U';
  const clean = nameOrIdentifier.trim();

  // If email address, derive initials from the prefix before @
  if (clean.includes('@')) {
    const prefix = clean.split('@')[0];
    const parts = prefix.split(/[._-]/).filter(Boolean);
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return prefix.slice(0, 2).toUpperCase() || 'U';
  }

  // If cuid / database ID (e.g. cm7abcdef... or uuid) without user name
  if (/^[a-z0-9]{20,}$/i.test(clean) || /^[0-9a-f-]{36}$/i.test(clean)) {
    return 'U';
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || 'U';
}

/**
 * Bundled avatars a person gets until they pick their own: the friendly, professional knights and Squires
 * (no villains). Kept in step with public/avatars; tests check every file exists.
 */
export const AUTO_AVATAR_FILES = [
  'knight/sentinel',
  'knight/crusader',
  'knight/paladin',
  'knight/warden',
  'knight/ranger',
  'knight/vanguard',
  'knight/bastion',
  'knight/royal',
  'knight/direwolf',
  'knight/lion',
  'knight/stag',
  'knight/rose',
  'knight/sun',
  'knight/kingsguard',
  'knight/valkyrie',
  'knight/duchess',
  'knight/huntress',
  'knight/ice-queen',
  'knight/shield-maiden',
  'squire/squire',
  'squire/cheer',
  'squire/scout',
  'squire/thinker',
  'squire/victor',
  'squire/lady-squire',
  'squire/lady-aurora',
] as const;

/** Marks an avatar as assigned automatically, so an identity provider's photo may replace it and a pick may not. */
const AUTO_MARKER = '?auto=1';

/**
 * The avatar a person gets before choosing one: a knight or Squire picked from a hash of `seed`, so the same
 * person always gets the same one. Falls back to the first entry; never throws.
 */
export const getDefaultAvatar = (
  arg1?: string | null,
  arg2?: string | null,
  arg3?: string | null
): string => {
  // Supports the 2-argument form (name, seed) and the legacy 3-argument form (gender, name, seed).
  const nameOrIdentifier = arg3 !== undefined ? arg2 : arg1;
  const seed = (arg3 !== undefined ? arg3 : arg2) || nameOrIdentifier || 'user';
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const file = AUTO_AVATAR_FILES.at(hash % AUTO_AVATAR_FILES.length) ?? AUTO_AVATAR_FILES[0];
  return `/avatars/${file}.svg${AUTO_MARKER}`;
};

/**
 * Checks if an avatar URL is one of our default system-generated ones.
 * Returns true for default system avatars.
 */
export const isDefaultAvatar = (url: string | null | undefined): boolean => {
  if (!url) return true;
  if (url.startsWith('/avatars/') && url.endsWith(AUTO_MARKER)) return true;

  // Check if it's our proxy URL
  if (url.startsWith('/api/avatar')) {
    const isSystemDefault =
      (url.includes('style=initials') ||
        url.includes('style=shapes') ||
        url.includes('style=personas') ||
        url.includes('style=lorelei') ||
        url.includes('style=bottts')) &&
      (url.includes('radius=0') || url.includes('radius=50'));
    return isSystemDefault;
  }

  // Check if it's a direct DiceBear URL (legacy)
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'api.dicebear.com') {
      const pathname = urlObj.pathname;
      return (
        pathname.includes('initials') ||
        pathname.includes('shapes') ||
        pathname.includes('personas') ||
        pathname.includes('lorelei') ||
        pathname.includes('bottts')
      );
    }
    return false;
  } catch {
    return false;
  }
};
