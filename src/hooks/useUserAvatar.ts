'use client';

import { useUserAvatarContext, useUserAvatarContextSafe } from '@/contexts/UserAvatarContext';

/**
 * Hook to get avatar URL for any user.
 * Must be used within UserAvatarProvider.
 */
export function useUserAvatar(
  userId: string,
  gender?: string | null,
  fallbackName?: string | null
): string {
  const { getAvatar } = useUserAvatarContext();
  return getAvatar(userId, gender, fallbackName);
}

/**
 * Hook to get avatar URL for the currently logged-in user.
 * Must be used within UserAvatarProvider.
 */
export function useCurrentUserAvatar(): string | null {
  const { currentUserId, getAvatar } = useUserAvatarContext();
  if (!currentUserId) return null;
  return getAvatar(currentUserId);
}

/**
 * Hook to get avatar update functions.
 * Use this when you need to update avatars after profile changes.
 */
export function useAvatarUpdater() {
  const { updateAvatar, invalidateAvatar, updateCurrentUser, preloadAvatars } =
    useUserAvatarContext();
  return { updateAvatar, invalidateAvatar, updateCurrentUser, preloadAvatars };
}

/**
 * Safe version of useUserAvatar that works outside of provider.
 * Returns default avatar when not in provider context.
 */
export function useUserAvatarSafe(
  userId: string,
  gender?: string | null,
  fallbackName?: string | null,
  avatarUrlProp?: string | null
): string {
  const { getAvatar } = useUserAvatarContextSafe();
  return getAvatar(userId, gender, fallbackName, avatarUrlProp);
}

/**
 * Hook to get the current user's ID from avatar context.
 */
export function useCurrentUserId(): string | null {
  const { currentUserId } = useUserAvatarContextSafe();
  return currentUserId;
}
