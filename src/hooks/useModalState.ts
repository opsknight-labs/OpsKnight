'use client';

import { useEffect, useState, useCallback } from 'react';

// Global modal state to prevent conflicts
const globalModalState: {
  search: boolean;
  quickActions: boolean;
  userMenu: boolean;
  sidebarMobileMenu: boolean;
  notifications: boolean;
} = {
  search: false,
  quickActions: false,
  userMenu: false,
  sidebarMobileMenu: false,
  notifications: false,
};

type ModalName = 'search' | 'quickActions' | 'userMenu' | 'sidebarMobileMenu' | 'notifications';
const listeners = new Map<ModalName, Set<() => void>>();

function notifyListeners(modalName: ModalName) {
  const modalListeners = listeners.get(modalName);
  if (modalListeners) {
    modalListeners.forEach(listener => listener());
  }
  // Note: Removed broadcast to ALL listeners - it was causing unnecessary
  // re-renders of components like Sidebar during navigation
}

export function useModalState(modalName: ModalName) {
  const [isOpen, setIsOpenLocal] = useState(globalModalState[modalName]);

  useEffect(() => {
    if (!listeners.has(modalName)) {
      listeners.set(modalName, new Set());
    }
    const listener = () => {
      setIsOpenLocal(globalModalState[modalName]);
    };
    listeners.get(modalName)!.add(listener);

    // Sync initial state
    setIsOpenLocal(globalModalState[modalName]); // eslint-disable-line react-hooks/set-state-in-effect

    return () => {
      listeners.get(modalName)?.delete(listener);
    };
  }, [modalName]);

  const setIsOpen = useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      const newValue = typeof open === 'function' ? open(globalModalState[modalName]) : open;

      if (newValue) {
        // Close other modals
        Object.keys(globalModalState).forEach(key => {
          if (key !== modalName) {
            globalModalState[key as ModalName] = false;
            notifyListeners(key as ModalName);
          }
        });
      }
      globalModalState[modalName] = newValue;
      notifyListeners(modalName);
    },
    [modalName]
  );

  return [isOpen, setIsOpen] as const;
}
