'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
  useMemo,
  useRef,
} from 'react';
import { getDefaultAvatar } from '@/lib/avatar';

// Maximum number of avatar entries to cache (LRU eviction beyond this)
const MAX_CACHE_SIZE = 500;

type AvatarCacheEntry = {
  avatarUrl: string | null;
  gender: string | null;
  name: string | null;
  lastAccessed: number; // Timestamp for LRU tracking
};

type UserAvatarContextType = {
  currentUserId: string | null;
  getAvatar: (
    userId: string,
    gender?: string | null,
    fallbackName?: string | null,
    avatarUrlProp?: string | null
  ) => string;
  updateAvatar: (userId: string, newAvatarUrl: string | null) => void;
  invalidateAvatar: (userId: string) => void;
  preloadAvatars: (
    users: Array<{
      id: string;
      avatarUrl?: string | null;
      gender?: string | null;
      name?: string | null;
    }>
  ) => void;
  updateCurrentUser: (avatarUrl: string | null, gender?: string | null) => void;
};

const UserAvatarContext = createContext<UserAvatarContextType | undefined>(undefined);

type UserAvatarProviderProps = {
  children: ReactNode;
  currentUserId?: string | null;
  currentUserAvatar?: string | null;
  currentUserGender?: string | null;
  currentUserName?: string | null;
  initialUsers?: Array<{
    id: string;
    avatarUrl?: string | null;
    gender?: string | null;
    name?: string | null;
  }>;
};

export function UserAvatarProvider({
  children,
  currentUserId = null,
  currentUserAvatar = null,
  currentUserGender = null,
  currentUserName = null,
  initialUsers = [],
}: UserAvatarProviderProps) {
  const [avatarCache, setAvatarCache] = useState<Map<string, AvatarCacheEntry>>(() => {
    const cache = new Map<string, AvatarCacheEntry>();
    const now = Date.now();

    // Initialize with current user if provided
    if (currentUserId) {
      cache.set(currentUserId, {
        avatarUrl: currentUserAvatar,
        gender: currentUserGender,
        name: currentUserName,
        lastAccessed: now,
      });
    }

    // Initialize with any provided initial users (limit to MAX_CACHE_SIZE)
    const usersToCache = initialUsers.slice(0, MAX_CACHE_SIZE - (currentUserId ? 1 : 0));
    usersToCache.forEach(user => {
      cache.set(user.id, {
        avatarUrl: user.avatarUrl ?? null,
        gender: user.gender ?? null,
        name: user.name ?? null,
        lastAccessed: now,
      });
    });

    return cache;
  });

  // Keep cache synced with current user props when they change
  useEffect(() => {
    if (!currentUserId) return;
    setAvatarCache(prev => {
      const existing = prev.get(currentUserId);
      if (
        existing &&
        existing.avatarUrl === currentUserAvatar &&
        existing.gender === currentUserGender &&
        existing.name === currentUserName
      ) {
        return prev;
      }
      const newCache = new Map(prev);
      newCache.set(currentUserId, {
        avatarUrl: currentUserAvatar,
        gender: currentUserGender,
        name: currentUserName,
        lastAccessed: Date.now(),
      });
      return newCache;
    });
  }, [currentUserId, currentUserAvatar, currentUserGender, currentUserName]);

  // Helper to evict LRU entries when cache exceeds max size
  const evictLRU = useCallback(
    (cache: Map<string, AvatarCacheEntry>, protectedId?: string | null) => {
      if (cache.size <= MAX_CACHE_SIZE) return cache;

      // Convert to array and sort by lastAccessed (oldest first)
      const entries = Array.from(cache.entries())
        .filter(([id]) => id !== protectedId) // Never evict current user
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

      // Remove oldest entries until we're under the limit
      const toRemove = cache.size - MAX_CACHE_SIZE;
      for (let i = 0; i < toRemove && i < entries.length; i++) {
        cache.delete(entries[i][0]);
      }

      return cache;
    },
    []
  );

  // Get avatar URL for a user, using cache or falling back to default
  const getAvatar = useCallback(
    (
      userId: string,
      gender?: string | null,
      _fallbackName?: string | null,
      avatarUrlProp?: string | null
    ): string => {
      const cached = avatarCache.get(userId);
      const effectiveAvatarUrl = avatarUrlProp || cached?.avatarUrl;

      if (effectiveAvatarUrl) {
        return effectiveAvatarUrl;
      }

      // Use cached gender if available, otherwise use provided gender
      const effectiveGender = cached?.gender ?? gender;

      // Generate default avatar using consistent userId seed
      return getDefaultAvatar(effectiveGender, userId || 'user');
    },
    [avatarCache]
  );

  // Update a user's avatar in the cache
  const updateAvatar = useCallback(
    (userId: string, newAvatarUrl: string | null) => {
      setAvatarCache(prev => {
        const newCache = new Map(prev);
        const existing = newCache.get(userId);
        newCache.set(userId, {
          avatarUrl: newAvatarUrl,
          gender: existing?.gender ?? null,
          name: existing?.name ?? null,
          lastAccessed: Date.now(),
        });
        return evictLRU(newCache, currentUserId);
      });
    },
    [evictLRU, currentUserId]
  );

  // Invalidate (remove) a user's avatar from cache to force refetch
  const invalidateAvatar = useCallback((userId: string) => {
    setAvatarCache(prev => {
      const newCache = new Map(prev);
      newCache.delete(userId);
      return newCache;
    });
  }, []);

  // Preload multiple users' avatars into cache
  const preloadAvatars = useCallback(
    (
      users: Array<{
        id: string;
        avatarUrl?: string | null;
        gender?: string | null;
        name?: string | null;
      }>
    ) => {
      setAvatarCache(prev => {
        const newCache = new Map(prev);
        const now = Date.now();
        users.forEach(user => {
          // Only update if not already in cache or if new data has more info
          const existing = newCache.get(user.id);
          if (!existing || user.avatarUrl) {
            newCache.set(user.id, {
              avatarUrl: user.avatarUrl ?? existing?.avatarUrl ?? null,
              gender: user.gender ?? existing?.gender ?? null,
              name: user.name ?? existing?.name ?? null,
              lastAccessed: now,
            });
          }
        });
        return evictLRU(newCache, currentUserId);
      });
    },
    [evictLRU, currentUserId]
  );

  // Update current user's avatar and optionally gender
  const updateCurrentUser = useCallback(
    (avatarUrl: string | null, gender?: string | null) => {
      if (!currentUserId) return;

      setAvatarCache(prev => {
        const newCache = new Map(prev);
        const existing = newCache.get(currentUserId);
        newCache.set(currentUserId, {
          avatarUrl: avatarUrl,
          gender: gender ?? existing?.gender ?? null,
          name: existing?.name ?? null,
          lastAccessed: Date.now(),
        });
        return newCache;
      });
    },
    [currentUserId]
  );

  const value = useMemo(
    () => ({
      currentUserId,
      getAvatar,
      updateAvatar,
      invalidateAvatar,
      preloadAvatars,
      updateCurrentUser,
    }),
    [currentUserId, getAvatar, updateAvatar, invalidateAvatar, preloadAvatars, updateCurrentUser]
  );

  return <UserAvatarContext.Provider value={value}>{children}</UserAvatarContext.Provider>;
}

export function useUserAvatarContext() {
  const context = useContext(UserAvatarContext);
  if (!context) {
    throw new Error('useUserAvatarContext must be used within a UserAvatarProvider');
  }
  return context;
}

// Safe version that returns defaults when outside provider (for public pages)
export function useUserAvatarContextSafe() {
  const context = useContext(UserAvatarContext);
  if (!context) {
    return {
      currentUserId: null,
      getAvatar: (userId: string, gender?: string | null, fallbackName?: string | null) =>
        getDefaultAvatar(gender, userId || fallbackName || 'user'),
      updateAvatar: () => {},
      invalidateAvatar: () => {},
      preloadAvatars: () => {},
      updateCurrentUser: () => {},
    };
  }
  return context;
}
