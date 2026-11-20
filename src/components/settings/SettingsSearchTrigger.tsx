'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { pageHeaderActionClass } from '@/components/patterns/PageHeader';
import { cn } from '@/lib/utils';

/** Opens the settings-only search (`CommandPalette`). ⌘K stays with the global console search. */
export const OPEN_SETTINGS_SEARCH_EVENT = 'opsknight:open-settings-search';

export default function SettingsSearchTrigger({
  tone = 'default',
  className,
}: {
  /** `inverse` for the always-dark PageHeader surface. */
  tone?: 'default' | 'inverse';
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_SEARCH_EVENT))}
      className={cn(
        'gap-2 text-muted-foreground hover:text-foreground',
        tone === 'inverse' && pageHeaderActionClass,
        className
      )}
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span className={cn(tone === 'default' && 'sr-only sm:not-sr-only')}>Search settings</span>
    </Button>
  );
}
