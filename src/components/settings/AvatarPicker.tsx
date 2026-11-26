'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, Upload } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { buildAvatarLibrary, isSameAvatar } from '@/lib/avatar-presets';
import { cn } from '@/lib/utils';

interface AvatarPickerProps {
  currentAvatarUrl?: string | null;
  /**
   * Saves the picked avatar. Return false (or throw) when it could not be saved: the dialog then stays open
   * so another one can be tried; anything else closes it.
   */
  onSelect: (avatarUrl: string) => Promise<boolean | void> | boolean | void;
  userName: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onUploadClick?: () => void;
}

export function AvatarPicker({
  currentAvatarUrl,
  onSelect,
  userName,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onUploadClick,
}: AvatarPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen || (() => {}) : setInternalOpen;
  // The tile being saved: all tiles wait for it, so two picks cannot race each other.
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const library = useMemo(() => buildAvatarLibrary(userName), [userName]);
  const currentCategory =
    library.find(category =>
      category.presets.some(preset => isSameAvatar(preset.url, currentAvatarUrl))
    )?.id ?? 'squire';
  const [category, setCategory] = useState<string | null>(null);

  const choose = async (url: string) => {
    if (pendingUrl) return;
    setPendingUrl(url);
    try {
      const saved = await onSelect(url);
      if (saved !== false) setOpen(false);
    } catch {
      // The caller reports the error; keep the dialog open.
    } finally {
      setPendingUrl(null);
    }
  };

  return (
    <>
      {trigger !== undefined ? (
        trigger ? (
          <div onClick={() => setOpen(true)} className="inline-flex cursor-pointer">
            {trigger}
          </div>
        ) : null
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
          Choose Avatar Style
        </Button>
      )}

      <Dialog open={open} onOpenChange={next => (pendingUrl ? undefined : setOpen(next))}>
        <DialogContent className="max-h-[88vh] max-w-5xl sm:max-w-5xl overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-6">
              <Avatar className="hidden h-12 w-12 shrink-0 ring-2 ring-primary/30 ring-offset-2 ring-offset-background sm:block">
                <AvatarImage src={currentAvatarUrl ?? undefined} alt="" className="object-cover" />
                <AvatarFallback className="text-xs font-semibold">
                  {userName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <DialogTitle>Choose your avatar</DialogTitle>
                <DialogDescription>
                  Shown on incidents, on-call schedules and team pages.
                </DialogDescription>
              </div>
              {onUploadClick && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={Boolean(pendingUrl)}
                  onClick={() => {
                    onUploadClick();
                    setOpen(false);
                  }}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                  Upload photo
                </Button>
              )}
            </div>
          </DialogHeader>

          <Tabs
            value={category ?? currentCategory}
            onValueChange={setCategory}
            className="md:flex md:items-start md:gap-6"
          >
            <TabsList className="flex h-auto w-full flex-wrap gap-1 bg-transparent p-0 md:sticky md:top-0 md:w-48 md:shrink-0 md:flex-col md:flex-nowrap md:items-stretch md:border-r md:pr-4">
              {library.map(item => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="min-w-[4.5rem] flex-1 gap-2 rounded-full border border-transparent px-3 py-1.5 text-xs data-[state=active]:border-primary/30 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none md:flex-none md:justify-start md:rounded-lg md:py-2 md:text-sm"
                >
                  <Avatar className="hidden h-6 w-6 md:block">
                    <AvatarImage src={item.presets[0]?.url} alt="" className="object-cover" />
                  </Avatar>
                  <span className="truncate">{item.label}</span>
                  <span
                    aria-hidden
                    className="hidden text-2xs tabular-nums text-muted-foreground md:ml-auto md:inline"
                  >
                    {item.presets.length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            {library.map(item => (
              <TabsContent
                key={item.id}
                value={item.id}
                className="mt-4 min-h-[24rem] min-w-0 flex-1 space-y-3 md:mt-0"
              >
                <p className="text-xs text-muted-foreground">{item.hint}</p>
                <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {item.presets.map(preset => {
                    const selected = isSameAvatar(preset.url, currentAvatarUrl);
                    const saving = pendingUrl === preset.url;
                    return (
                      <li key={preset.id}>
                        <button
                          type="button"
                          onClick={() => void choose(preset.url)}
                          disabled={Boolean(pendingUrl) && !saving}
                          aria-pressed={selected}
                          aria-label={`${preset.label}${selected ? ' (current)' : ''}`}
                          className="group flex w-full flex-col items-center gap-1.5 rounded-xl p-1.5 transition hover:bg-muted/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          <span
                            className={cn(
                              'relative rounded-full p-0.5 transition',
                              selected
                                ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                                : 'group-hover:ring-2 group-hover:ring-primary/40 group-hover:ring-offset-2 group-hover:ring-offset-background'
                            )}
                          >
                            <Avatar className="h-16 w-16 transition-transform group-hover:scale-105">
                              <AvatarImage src={preset.url} alt="" className="object-cover" />
                              <AvatarFallback className="bg-muted text-xs font-semibold">
                                {preset.label.slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            {saving && (
                              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                              </span>
                            )}
                            {selected && !saving && (
                              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                                <Check
                                  className="h-2.5 w-2.5 text-primary-foreground"
                                  aria-hidden
                                />
                              </span>
                            )}
                          </span>
                          <span className="max-w-full truncate text-xs text-muted-foreground group-hover:text-foreground">
                            {preset.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </TabsContent>
            ))}
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
