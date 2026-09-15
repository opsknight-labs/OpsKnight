'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/shadcn/command';
import { SETTINGS_NAV_SECTIONS } from '@/components/settings/navConfig';
import { Settings, ArrowRight } from 'lucide-react';

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(open => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search settings, integrations, parameters..." />
      <CommandList>
        <CommandEmpty>No settings found.</CommandEmpty>
        {SETTINGS_NAV_SECTIONS.filter(sec => sec.id !== 'overview').map(section => (
          <CommandGroup key={section.id} heading={section.label}>
            {section.items.map(item => (
              <CommandItem
                key={item.id}
                value={`${item.label} ${item.description} ${(item.keywords || []).join(' ')}`}
                onSelect={() => runCommand(item.href)}
                className="flex items-center justify-between cursor-pointer py-2 px-3 rounded-lg"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1 rounded-md bg-muted text-muted-foreground shrink-0">
                    <Settings className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                      {item.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {item.description}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-2" />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
      </CommandList>
    </CommandDialog>
  );
}
