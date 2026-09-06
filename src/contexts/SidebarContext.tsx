'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

type SidebarContextType = {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  isMobile: boolean;
  isMobileOpen: boolean;
  setIsMobileOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleMobile: () => void;
  closeMobile: () => void;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  // Initialize desktop collapsed state from localStorage (lazy initialization)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = localStorage.getItem('sidebarCollapsed');
      return saved === '1';
    } catch {
      return false;
    }
  });
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Screen size breakpoint detection (dynamic mobile/tablet/desktop)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const updateMobileState = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      // If expanding to desktop, close mobile drawer automatically
      if (!mobile) {
        setIsMobileOpen(false);
      }
    };

    updateMobileState();
    mq.addEventListener('change', updateMobileState);
    return () => mq.removeEventListener('change', updateMobileState);
  }, []);

  // Persist desktop collapse preference to localStorage
  useEffect(() => {
    if (isMobile) return;
    try {
      localStorage.setItem('sidebarCollapsed', isCollapsed ? '1' : '0');
    } catch {
      // Ignore write errors
    }
  }, [isCollapsed, isMobile]);

  const toggleSidebar = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  const toggleMobile = useCallback(() => {
    setIsMobileOpen(prev => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  // Keyboard shortcut listener (Cmd+B / Ctrl+B and Escape)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is currently typing in an input, textarea, or contentEditable element
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox')
      ) {
        return;
      }

      // Cmd+B or Ctrl+B
      if ((event.metaKey || event.ctrlKey) && (event.key === 'b' || event.key === 'B')) {
        event.preventDefault();
        if (isMobile) {
          setIsMobileOpen(prev => !prev);
        } else {
          setIsCollapsed(prev => !prev);
        }
      }

      // Escape key to close mobile drawer
      if (event.key === 'Escape' && isMobileOpen) {
        event.preventDefault();
        setIsMobileOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, isMobileOpen]);

  const value = useMemo(
    () => ({
      isCollapsed,
      setIsCollapsed,
      toggleSidebar,
      isMobile,
      isMobileOpen,
      setIsMobileOpen,
      toggleMobile,
      closeMobile,
    }),
    [isCollapsed, toggleSidebar, isMobile, isMobileOpen, toggleMobile, closeMobile]
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
