'use client';

import * as React from 'react';
import { Bell, Keyboard, Key, Link, Settings, Shield, User } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/shadcn/command';
import { useRouter } from 'next/navigation';

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

  const runCommand = React.useCallback((command: () => unknown) => {
    setOpen(false);
    command();
  }, []);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runCommand(() => router.push('/settings/profile'))}>
              <User className="mr-2 h-4 w-4" />
              <span>Profile</span>
              <CommandShortcut>g p</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push('/settings/security'))}>
              <Shield className="mr-2 h-4 w-4" />
              <span>Security</span>
              <CommandShortcut>g s</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push('/settings/integrations/slack'))}
            >
              <Link className="mr-2 h-4 w-4" />
              <span>Slack Integration</span>
              <CommandShortcut>g s</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push('/settings/integrations/jira'))}
            >
              <Link className="mr-2 h-4 w-4" />
              <span>Jira Integration</span>
              <CommandShortcut>g j</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push('/settings/api-keys'))}>
              <Key className="mr-2 h-4 w-4" />
              <span>API Keys</span>
              <CommandShortcut>g a</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push('/settings/notifications'))}>
              <Bell className="mr-2 h-4 w-4" />
              <span>Notifications</span>
              <CommandShortcut>g n</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Settings">
            <CommandItem onSelect={() => runCommand(() => router.push('/settings/profile'))}>
              <Settings className="mr-2 h-4 w-4" />
              <span>Preferences</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Help">
            <CommandItem
              onSelect={() => {
                setOpen(false);
                // Trigger keyboard shortcut legend
                const event = new KeyboardEvent('keydown', {
                  key: '?',
                  shiftKey: true,
                  bubbles: true,
                });
                document.dispatchEvent(event);
              }}
            >
              <Keyboard className="mr-2 h-4 w-4" />
              <span>Keyboard Shortcuts</span>
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
