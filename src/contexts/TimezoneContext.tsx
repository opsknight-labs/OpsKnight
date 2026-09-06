'use client';

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { getBrowserTimeZone } from '@/lib/timezone';

type TimezoneContextType = {
  userTimeZone: string;
  browserTimeZone: string;
  setUserTimeZone: (tz: string) => void;
};

const TimezoneContext = createContext<TimezoneContextType | undefined>(undefined);

export function TimezoneProvider({
  children,
  initialTimeZone = 'UTC',
}: {
  children: ReactNode;
  initialTimeZone?: string;
}) {
  const [userTimeZone, setUserTimeZone] = useState(initialTimeZone);
  const [browserTimeZone, setBrowserTimeZone] = useState('UTC');

  useEffect(() => {
    setBrowserTimeZone(getBrowserTimeZone());
  }, []);

  // Update user timezone when it changes (e.g., from preferences)
  useEffect(() => {
    setUserTimeZone(initialTimeZone);
  }, [initialTimeZone]);

  return (
    <TimezoneContext.Provider
      value={{
        userTimeZone,
        browserTimeZone,
        setUserTimeZone,
      }}
    >
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  const context = useContext(TimezoneContext);
  if (!context) {
    // Return default values if context is not available (for public pages)
    return {
      userTimeZone: 'UTC',
      browserTimeZone: typeof window !== 'undefined' ? getBrowserTimeZone() : 'UTC',
      setUserTimeZone: () => {},
    };
  }
  return context;
}

/**
 * Hook for public pages that should use browser timezone
 */
export function useBrowserTimezone() {
  const { browserTimeZone } = useTimezone();
  return browserTimeZone;
}
