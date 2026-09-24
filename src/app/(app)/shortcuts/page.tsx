'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import {
  Keyboard,
  ArrowLeft,
  Command,
  Sparkles,
  Flame,
  Compass,
  Sliders,
  Globe,
} from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '@/components/KeyboardShortcutsProvider';

const CATEGORY_META = new Map<
  string,
  { icon: React.ElementType; description: string; badgeColor: string }
>([
  [
    'Incident Triage',
    {
      icon: Flame,
      description: 'Hotkeys to quickly review, acknowledge, and resolve alerts',
      badgeColor: 'text-amber-500 border-amber-500/20 bg-amber-500/10',
    },
  ],
  [
    'Global',
    {
      icon: Globe,
      description: 'Universal hotkeys available across all views',
      badgeColor: 'text-primary border-primary/20 bg-primary/10',
    },
  ],
  [
    'Navigation',
    {
      icon: Compass,
      description: 'Jump directly to incidents, services, schedules, and teams',
      badgeColor: 'text-blue-500 border-blue-500/20 bg-blue-500/10',
    },
  ],
  [
    'Settings',
    {
      icon: Sliders,
      description: 'Fast access to profile, security, and integration settings',
      badgeColor: 'text-emerald-500 border-emerald-500/20 bg-emerald-500/10',
    },
  ],
]);

export default function ShortcutsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const categories = ['Incident Triage', 'Global', 'Navigation', 'Settings'];

  const normalizedQuery = searchQuery.toLowerCase().trim();
  const filteredShortcuts = !normalizedQuery
    ? KEYBOARD_SHORTCUTS
    : KEYBOARD_SHORTCUTS.filter(
        s =>
          s.description.toLowerCase().includes(normalizedQuery) ||
          s.category.toLowerCase().includes(normalizedQuery) ||
          s.keys.some(k => k.toLowerCase().includes(normalizedQuery))
      );

  return (
    <main className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6 container">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Keyboard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Keyboard Shortcuts</h1>
            </div>
          </div>
          <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
            Accelerate your incident response and operations with keyboard hotkeys. Press{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-mono font-semibold bg-muted border border-border rounded shadow-2xs">
              ?
            </kbd>{' '}
            anywhere in OpsKnight to launch the quick popup overlay.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
            className="gap-2 text-xs"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            Open Overlay
          </Button>
          <Button variant="ghost" asChild className="gap-2 text-xs">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl border border-border/70 bg-card/60">
        <div className="flex-1 max-w-md">
          <Input
            type="text"
            placeholder="Search shortcuts by key or action…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-9 px-3 text-xs bg-background"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono text-[10px]">
            {filteredShortcuts.length} of {KEYBOARD_SHORTCUTS.length} shortcuts
          </Badge>
          <span className="hidden sm:inline">&middot; Hotkeys are inactive in text fields</span>
        </div>
      </div>

      {/* Categories Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {categories.map(category => {
          const shortcuts = filteredShortcuts.filter(s => s.category === category);
          if (shortcuts.length === 0) return null;

          const meta = CATEGORY_META.get(category) || {
            icon: Command,
            description: `Hotkeys for ${category.toLowerCase()} workflows`,
            badgeColor: 'text-muted-foreground border-border bg-muted/20',
          };
          const IconComponent = meta.icon;

          return (
            <Card
              key={category}
              className="border-border/70 shadow-xs hover:border-border transition-colors"
            >
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <IconComponent className="h-4 w-4" />
                    </div>
                    {category} Shortcuts
                  </CardTitle>
                  <Badge variant="outline" className={`text-[10px] font-medium ${meta.badgeColor}`}>
                    {shortcuts.length} keys
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">{meta.description}</CardDescription>
              </CardHeader>
              <CardContent className="pt-3 divide-y divide-border/30">
                {shortcuts.map((shortcut, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 group"
                  >
                    <span className="text-xs sm:text-sm text-foreground/90 font-medium group-hover:text-foreground transition-colors">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {shortcut.keys.map((key, kIdx) => (
                        <kbd
                          key={kIdx}
                          className="min-w-[26px] h-6 px-1.5 flex items-center justify-center text-xs font-mono font-semibold text-foreground bg-muted border border-border/80 rounded shadow-2xs group-hover:border-border transition-colors"
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
