/**
 * Generates a default avatar URL based on gender or userId.
 * Uses DiceBear styles via our local API proxy.
 */
export const getDefaultAvatar = (
  gender: string | null | undefined,
  userId: string = 'user'
): string => {
  const genderLower = gender?.toLowerCase();

  // Use Big Smile for gendered avatars (professional/human-like)
  // Use 'bottts' (Robots) as the "random animal/creature" fallback for undefined gender
  // as requested by user ("random animal etc")

  switch (genderLower) {
    case 'male':
      return `/api/avatar?style=big-smile&seed=${userId}-male&backgroundColor=b91c1c&radius=0`;
    case 'female':
      return `/api/avatar?style=big-smile&seed=${userId}-female&backgroundColor=65a30d&radius=0`;
    case 'non-binary':
      return `/api/avatar?style=big-smile&seed=${userId}-nb&backgroundColor=7c3aed&radius=0`;
    case 'other':
      return `/api/avatar?style=bottts&seed=${userId}-other&backgroundColor=0891b2&radius=0`;
    case 'prefer-not-to-say':
      // Neutral robot
      return `/api/avatar?style=bottts&seed=${userId}-neutral&backgroundColor=6366f1&radius=0`;
    default:
      // Fallback for no gender: Random Robot
      return `/api/avatar?style=bottts&seed=${userId}&backgroundColor=84cc16&radius=0`;
  }
};

/**
 * Checks if an avatar URL is one of our default system-generated ones.
 * STRICT CHECK: Only returns true for default big-smile / bottts system avatars.
 * Custom chosen presets from AvatarPicker (avataaars, micah, etc.) and uploaded avatars are NOT flagged as default.
 */
export const isDefaultAvatar = (url: string | null | undefined): boolean => {
  if (!url) return true;

  // Check if it's our proxy URL
  if (url.startsWith('/api/avatar')) {
    const isSystemDefault =
      (url.includes('style=big-smile') || url.includes('style=bottts')) && url.includes('radius=0');
    return isSystemDefault;
  }

  // Check if it's a direct DiceBear URL (legacy)
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'api.dicebear.com') {
      const pathname = urlObj.pathname;
      return pathname.includes('big-smile') || pathname.includes('bottts');
    }
    return false;
  } catch {
    return false;
  }
};
