'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type MobileRefreshContextValue = {
  epoch: string;
  refresh: () => Promise<void>;
  isRefreshing: boolean;
};

const MobileRefreshContext = createContext<MobileRefreshContextValue | null>(null);

export function MobileRefreshEpochProvider({
  epoch,
  children,
}: {
  epoch: string;
  children: ReactNode;
}) {
  return (
    <MobileRefreshContext.Provider
      value={{
        epoch,
        refresh: async () => {},
        isRefreshing: false,
      }}
    >
      {children}
    </MobileRefreshContext.Provider>
  );
}

export function MobileRefreshProvider({
  value,
  children,
}: {
  value: MobileRefreshContextValue;
  children: ReactNode;
}) {
  return <MobileRefreshContext.Provider value={value}>{children}</MobileRefreshContext.Provider>;
}

export function useMobileRefresh() {
  return useContext(MobileRefreshContext);
}

export function useMobileRefreshEpoch() {
  const value = useContext(MobileRefreshContext);
  return value?.epoch ?? '';
}
