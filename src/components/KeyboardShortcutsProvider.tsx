'use client';

import { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSequenceShortcut, useKeyboardShortcut } from '@/lib/hooks/use-keyboard-shortcut';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';

// Define all available shortcuts
export const KEYBOARD_SHORTCUTS = [
  // Global shortcuts
  { keys: ['⌘', 'K'], description: 'Open command palette', category: 'Global' },
  { keys: ['⌘', 'S'], description: 'Save current form', category: 'Global' },
  { keys: ['Esc'], description: 'Close modal/dialog', category: 'Global' },
  { keys: ['/'], description: 'Focus search', category: 'Global' },
  { keys: ['?'], description: 'Show keyboard shortcuts', category: 'Global' },
  { keys: ['r'], description: 'Refresh page', category: 'Global' },

  // Main Navigation shortcuts
  { keys: ['g', 'h'], description: 'Go to Dashboard', category: 'Navigation' },
  { keys: ['g', 'd'], description: 'Go to Dashboard', category: 'Navigation' },
  { keys: ['g', 'i'], description: 'Go to Incidents', category: 'Navigation' },
  { keys: ['g', 's'], description: 'Go to Services', category: 'Navigation' },
  { keys: ['g', 'u'], description: 'Go to Users', category: 'Navigation' },
  { keys: ['g', 't'], description: 'Go to Teams', category: 'Navigation' },

  // Settings shortcuts
  { keys: ['g', 'p'], description: 'Go to Profile', category: 'Settings' },
  { keys: ['g', 'e'], description: 'Go to Security', category: 'Settings' },
  { keys: ['g', 'a'], description: 'Go to API Keys', category: 'Settings' },
  { keys: ['g', 'n'], description: 'Go to Notifications', category: 'Settings' },
  { keys: ['g', 'w'], description: 'Go to Workspace', category: 'Settings' },
];

interface KeyboardShortcutsContextValue {
  openLegend: () => void;
  closeLegend: () => void;
  isLegendOpen: boolean;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

export function useKeyboardShortcutsContext() {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error('useKeyboardShortcutsContext must be used within KeyboardShortcutsProvider');
  }
  return context;
}

interface KeyboardShortcutsProviderProps {
  children: ReactNode;
}

export function KeyboardShortcutsProvider({ children }: KeyboardShortcutsProviderProps) {
  const router = useRouter();
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  const openLegend = useCallback(() => setIsLegendOpen(true), []);
  const closeLegend = useCallback(() => setIsLegendOpen(false), []);

  // Show legend on "?" key
  useKeyboardShortcut({
    key: '?',
    shift: true,
    callback: openLegend,
    description: 'Show keyboard shortcuts',
  });

  // Refresh on "r" key
  useKeyboardShortcut({
    key: 'r',
    callback: () => router.refresh(),
    description: 'Refresh page',
  });

  // Main Navigation shortcuts
  useSequenceShortcut(['g', 'h'], () => router.push('/'));
  useSequenceShortcut(['g', 'd'], () => router.push('/'));
  useSequenceShortcut(['g', 'i'], () => router.push('/incidents'));
  useSequenceShortcut(['g', 's'], () => router.push('/services'));
  useSequenceShortcut(['g', 'u'], () => router.push('/users'));
  useSequenceShortcut(['g', 't'], () => router.push('/teams'));

  // Settings shortcuts using sequences (g + letter)
  useSequenceShortcut(['g', 'p'], () => router.push('/settings/profile'));
  useSequenceShortcut(['g', 'e'], () => router.push('/settings/security'));
  useSequenceShortcut(['g', 'a'], () => router.push('/settings/api-keys'));
  useSequenceShortcut(['g', 'n'], () => router.push('/settings/notifications'));

  // Focus search on "/"
  useKeyboardShortcut({
    key: '/',
    callback: () => {
      const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]');
      searchInput?.focus();
    },
    description: 'Focus search',
  });

  return (
    <KeyboardShortcutsContext.Provider value={{ openLegend, closeLegend, isLegendOpen }}>
      {children}
      <KeyboardShortcutsLegend open={isLegendOpen} onOpenChange={setIsLegendOpen} />
    </KeyboardShortcutsContext.Provider>
  );
}

interface KeyboardShortcutsLegendProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function KeyboardShortcutsLegend({ open, onOpenChange }: KeyboardShortcutsLegendProps) {
  const categories = [...new Set(KEYBOARD_SHORTCUTS.map(s => s.category))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Use these shortcuts to navigate faster.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {categories.map(category => (
            <div key={category}>
              <h4 className="text-sm font-semibold text-muted-foreground mb-3">{category}</h4>
              <div className="space-y-2">
                {KEYBOARD_SHORTCUTS.filter(s => s.category === category).map((shortcut, index) => (
                  <div key={index} className="flex items-center justify-between py-1">
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIndex) => (
                        <kbd
                          key={keyIndex}
                          className="px-2 py-1 text-xs font-semibold bg-muted border border-border rounded"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
