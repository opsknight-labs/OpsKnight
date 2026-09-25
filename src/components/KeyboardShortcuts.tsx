'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { Keyboard, X, Sparkles, Command as CommandIcon, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import Link from 'next/link';

type Shortcut = {
  keys: string[];
  description: string;
  category: 'Incident Triage' | 'Navigation' | 'Actions';
};

const SHORTCUTS: Shortcut[] = [
  // Incident Triage
  { keys: ['J'], description: 'Next incident in list', category: 'Incident Triage' },
  { keys: ['K'], description: 'Previous incident in list', category: 'Incident Triage' },
  { keys: ['X'], description: 'Select / deselect incident', category: 'Incident Triage' },
  { keys: ['A'], description: 'Acknowledge focused incident', category: 'Incident Triage' },
  { keys: ['R'], description: 'Resolve focused incident (with note)', category: 'Incident Triage' },
  { keys: ['/'], description: 'Focus search bar', category: 'Incident Triage' },

  // Navigation
  { keys: ['G', 'D'], description: 'Go to Dashboard', category: 'Navigation' },
  { keys: ['G', 'I'], description: 'Go to Incidents', category: 'Navigation' },
  { keys: ['G', 'S'], description: 'Go to Services', category: 'Navigation' },
  { keys: ['G', 'T'], description: 'Go to Teams', category: 'Navigation' },
  { keys: ['G', 'U'], description: 'Go to Users', category: 'Navigation' },
  { keys: ['G', 'C'], description: 'Go to Schedules', category: 'Navigation' },
  { keys: ['G', 'P'], description: 'Go to Policies', category: 'Navigation' },
  { keys: ['G', 'A'], description: 'Go to Analytics', category: 'Navigation' },

  // Actions
  { keys: ['⌘', 'K'], description: 'Open command search', category: 'Actions' },
  { keys: ['⌘', 'N'], description: 'Create new incident', category: 'Actions' },
  { keys: ['⌘', 'R'], description: 'Refresh view data', category: 'Actions' },
  { keys: ['⌘', 'E'], description: 'Export CSV report', category: 'Actions' },
  { keys: ['?'], description: 'Toggle keyboard shortcuts', category: 'Actions' },
  { keys: ['Esc'], description: 'Close modal or overlay', category: 'Actions' },
];

const CATEGORIES: ('All' | Shortcut['category'])[] = [
  'All',
  'Incident Triage',
  'Navigation',
  'Actions',
];

export default function KeyboardShortcuts({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [filterCategory, setFilterCategory] = useState<'All' | Shortcut['category']>('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      // Prevent shortcut recursion while modal is open
      if (e.key === '?' || ((e.metaKey || e.ctrlKey) && e.key === '/')) {
        e.preventDefault();
      }
    };

    // Focus trap - keep focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (!modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleTab);

    // Auto-focus the close button or first element
    const timer = setTimeout(() => {
      const closeBtn = modalRef.current?.querySelector<HTMLElement>(
        'button[aria-label="Close dialog"]'
      );
      closeBtn?.focus();
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleTab);
    };
  }, [isOpen, onClose]);

  const filteredShortcuts = useMemo(() => {
    return SHORTCUTS.filter(shortcut => {
      const matchesCategory = filterCategory === 'All' || shortcut.category === filterCategory;
      if (!matchesCategory) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        shortcut.description.toLowerCase().includes(q) ||
        shortcut.category.toLowerCase().includes(q) ||
        shortcut.keys.some(k => k.toLowerCase().includes(q))
      );
    });
  }, [filterCategory, searchQuery]);

  const grouped = useMemo(() => {
    return filteredShortcuts.reduce(
      (acc, shortcut) => {
        if (!acc[shortcut.category]) {
          acc[shortcut.category] = [];
        }
        acc[shortcut.category].push(shortcut);
        return acc;
      },
      {} as Record<string, Shortcut[]>
    );
  }, [filteredShortcuts]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in-0 duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
    >
      <div
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border/70 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="keyboard-shortcuts-title"
                  className="text-lg font-semibold tracking-tight text-foreground"
                >
                  Keyboard Shortcuts
                </h2>
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                  {SHORTCUTS.length} keys
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Press{' '}
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-muted border border-border rounded">
                  Esc
                </kbd>{' '}
                anytime to dismiss
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close (Esc)"
            className="flex h-8.5 w-8.5 items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 active:bg-zinc-300 text-zinc-700 hover:text-zinc-950 border border-zinc-300/80 shadow-2xs transition-all duration-150 active:scale-95 cursor-pointer dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 dark:hover:text-white dark:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {/* Toolbar: Search & Category Filter Pills */}
        <div className="px-6 py-3.5 border-b border-border/60 bg-card/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1 max-w-sm">
            <Input
              type="text"
              placeholder="Filter shortcuts by key or action…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-9 px-3 text-xs bg-background"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {CATEGORIES.map(category => {
              const active = filterCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setFilterCategory(category)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {Object.keys(grouped).length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Keyboard className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No shortcuts found</p>
              <p className="text-xs text-muted-foreground/80 mt-1">
                Try searching for a different action or clearing filters
              </p>
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <CommandIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {category}
                    </h3>
                  </div>
                  <span className="text-[11px] text-muted-foreground/70 font-mono">
                    {items.length} {items.length === 1 ? 'shortcut' : 'shortcuts'}
                  </span>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-1">
                  {items.map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="group flex items-center justify-between px-3 py-2 rounded-xl border border-transparent hover:border-border/60 hover:bg-muted/40 transition-colors"
                    >
                      <span className="text-xs sm:text-sm font-medium text-foreground/90">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {shortcut.keys.map((key, keyIndex) => (
                          <kbd
                            key={keyIndex}
                            className="flex items-center justify-center min-w-[26px] h-6 px-1.5 text-xs font-mono font-semibold rounded-md border border-border/80 bg-muted text-foreground shadow-2xs group-hover:border-border"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-border/70 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Shortcuts are disabled when typing in inputs</span>
            <span className="sm:hidden">Disabled in input fields</span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/shortcuts"
              onClick={onClose}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Full guide
              <ArrowRight className="h-3 w-3" />
            </Link>
            <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-xs px-2.5">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
