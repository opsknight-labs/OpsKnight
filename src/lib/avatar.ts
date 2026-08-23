/**
 * Curated modern palette for default avatars (clean, accessible tones).
 */
const MODERN_AVATAR_PALETTE = [
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

function getDeterministicColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % MODERN_AVATAR_PALETTE.length;
  return MODERN_AVATAR_PALETTE[index];
}

/**
 * Generates a modern, professional default avatar URL based on gender or userId.
 * Uses DiceBear's 'personas' (clean illustrated tech professional avatars) in SVG format via our local API proxy.
 */
export const getDefaultAvatar = (
  gender: string | null | undefined,
  userId: string = 'user'
): string => {
  const genderLower = gender?.toLowerCase();
  const bg = getDeterministicColor(userId);

  switch (genderLower) {
    case 'male':
      return `/api/avatar?style=personas&seed=${encodeURIComponent(userId)}-male&backgroundColor=${bg}&radius=0&format=svg`;
    case 'female':
      return `/api/avatar?style=personas&seed=${encodeURIComponent(userId)}-female&backgroundColor=${bg}&radius=0&format=svg`;
    case 'non-binary':
      return `/api/avatar?style=personas&seed=${encodeURIComponent(userId)}-nb&backgroundColor=${bg}&radius=0&format=svg`;
    case 'other':
      return `/api/avatar?style=personas&seed=${encodeURIComponent(userId)}-other&backgroundColor=${bg}&radius=0&format=svg`;
    case 'prefer-not-to-say':
      return `/api/avatar?style=personas&seed=${encodeURIComponent(userId)}-neutral&backgroundColor=${bg}&radius=0&format=svg`;
    default:
      return `/api/avatar?style=personas&seed=${encodeURIComponent(userId)}&backgroundColor=${bg}&radius=0&format=svg`;
  }
};

/**
 * Checks if an avatar URL is one of our default system-generated ones.
 * Returns true for default system avatars (personas, lorelei, legacy big-smile, legacy bottts).
 * Custom chosen presets from AvatarPicker and uploaded avatars are NOT flagged as default.
 */
export const isDefaultAvatar = (url: string | null | undefined): boolean => {
  if (!url) return true;

  // Check if it's our proxy URL
  if (url.startsWith('/api/avatar')) {
    const isSystemDefault =
      (url.includes('style=personas') ||
        url.includes('style=lorelei') ||
        url.includes('style=big-smile') ||
        url.includes('style=bottts')) &&
      url.includes('radius=0');
    return isSystemDefault;
  }

  // Check if it's a direct DiceBear URL (legacy)
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'api.dicebear.com') {
      const pathname = urlObj.pathname;
      return (
        pathname.includes('personas') ||
        pathname.includes('lorelei') ||
        pathname.includes('big-smile') ||
        pathname.includes('bottts')
      );
    }
    return false;
  } catch {
    return false;
  }
};
