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
 * Generates a modern, serious, professional default avatar URL.
 * Uses local in-process @dicebear/collection 'initials' in SVG format.
 * Ensures the seed is always the actual user initials (e.g. "SA" for "System Admin")
 * so the rendered SVG matches fallback initials everywhere across the app.
 *
 * Supports both 2-argument signature (nameOrIdentifier, colorSeed) and
 * 3-argument legacy signature (gender, nameOrIdentifier, colorSeed).
 */
export const getDefaultAvatar = (
  arg1?: string | null,
  arg2?: string | null,
  arg3?: string | null
): string => {
  let nameOrIdentifier = arg1;
  let colorSeed = arg2;

  if (arg3 !== undefined) {
    nameOrIdentifier = arg2;
    colorSeed = arg3;
  }

  const initials = extractInitials(nameOrIdentifier) || 'U';
  const bgSeed = colorSeed || nameOrIdentifier || 'user';
  const bg = getDeterministicColor(bgSeed);

  return `/api/avatar?style=initials&seed=${encodeURIComponent(initials)}&backgroundColor=${bg}&radius=50`;
};

/**
 * Checks if an avatar URL is one of our default system-generated ones.
 * Returns true for default system avatars.
 */
export const isDefaultAvatar = (url: string | null | undefined): boolean => {
  if (!url) return true;

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
