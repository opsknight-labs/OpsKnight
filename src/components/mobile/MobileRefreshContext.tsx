'use client';

import { createContext, useContext, type ReactNode } from 'react';

const MobileRefreshEpochContext = createContext<string | null>(null);

export function MobileRefreshEpochProvider({
  epoch,
  children,
}: {
  epoch: string;
  children: ReactNode;
}) {
  return (
    <MobileRefreshEpochContext.Provider value={epoch}>
      {children}
    </MobileRefreshEpochContext.Provider>
  );
}

export function useMobileRefreshEpoch() {
  const value = useContext(MobileRefreshEpochContext);
  if (!value) throw new Error('useMobileRefreshEpoch must be used within MobileRefreshEpochProvider');
  return value;
}
