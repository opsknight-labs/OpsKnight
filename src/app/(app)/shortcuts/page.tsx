'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Keyboard, ArrowLeft, Command, Sparkles } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '@/components/KeyboardShortcutsProvider';

export default function ShortcutsPage() {
  const categories = ['Global', 'Navigation', 'Settings'];

  return (
    <main className="max-w-[1000px] mx-auto py-8 px-4 container">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Keyboard className="h-5 w-5" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Keyboard Shortcuts</h1>
          </div>
          <p className="text-muted-foreground text-base">
            Navigate OpsKnight faster and manage incidents with hotkeys. Press <kbd className="px-1.5 py-0.5 text-xs font-semibold bg-muted border border-border rounded shadow-sm">?</kbd> anywhere to toggle the quick overlay.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            Open Overlay
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {categories.map(category => {
          const shortcuts = KEYBOARD_SHORTCUTS.filter(s => s.category === category);
          if (shortcuts.length === 0) return null;

          return (
            <Card key={category} className="border-border/60 shadow-sm">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Command className="h-4 w-4 text-muted-foreground" />
                  {category} Shortcuts
                </CardTitle>
                <CardDescription>
                  Hotkeys for {category.toLowerCase()} workflows
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 divide-y divide-border/30">
                {shortcuts.map((shortcut, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <span className="text-sm text-foreground/90 font-medium">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, kIdx) => (
                        <kbd
                          key={kIdx}
                          className="min-w-[24px] h-6 px-1.5 flex items-center justify-center text-xs font-mono font-semibold text-foreground bg-muted border border-border rounded shadow-sm"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
