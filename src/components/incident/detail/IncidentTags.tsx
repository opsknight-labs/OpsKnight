'use client';

import { logger } from '@/lib/logger';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import {
  addTagToIncident,
  removeTagFromIncident,
  getAllTags,
} from '@/app/(app)/incidents/tag-actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Plus, Tag as TagIcon, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type IncidentTagsProps = {
  incidentId: string;
  tags: Array<{ id: string; name: string; color?: string | null }>;
  canManage: boolean;
  variant?: 'bar' | 'card';
  className?: string;
};

// Beautiful theme-aware pastel color palettes for tags in dark & light modes
const TAG_PALETTES = [
  'bg-blue-50 text-blue-700 border-blue-200/80 hover:bg-blue-100/70 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/80',
  'bg-indigo-50 text-indigo-700 border-indigo-200/80 hover:bg-indigo-100/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/80',
  'bg-purple-50 text-purple-700 border-purple-200/80 hover:bg-purple-100/70 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/80',
  'bg-amber-50 text-amber-800 border-amber-200/80 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/80',
  'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/80',
  'bg-rose-50 text-rose-700 border-rose-200/80 hover:bg-rose-100/70 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/80',
  'bg-cyan-50 text-cyan-700 border-cyan-200/80 hover:bg-cyan-100/70 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800/80',
  'bg-slate-100 text-slate-700 border-slate-200/80 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
];

function getTagClass(name: string): string {
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return TAG_PALETTES[Math.abs(hash) % TAG_PALETTES.length];
}

export default function IncidentTags({
  incidentId,
  tags,
  canManage,
  variant = 'bar',
  className,
}: IncidentTagsProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [availableTags, setAvailableTags] = useState<Array<{ id: string; name: string }>>([]);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleAddTag = async (tagName: string) => {
    if (!tagName.trim()) return;
    startTransition(async () => {
      try {
        await addTagToIncident(incidentId, tagName.trim());
        showToast(`Added tag #${tagName.trim()}`, 'success');
        setSearchValue('');
        setOpen(false);
        router.refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to add tag', 'error');
      }
    });
  };

  const handleRemoveTag = async (tagId: string, tagName: string) => {
    setRemovingId(tagId);
    startTransition(async () => {
      try {
        await removeTagFromIncident(incidentId, tagId);
        showToast(`Removed tag #${tagName}`, 'success');
        router.refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to remove tag', 'error');
      } finally {
        setRemovingId(null);
      }
    });
  };

  const loadAvailableTags = async () => {
    try {
      const allTags = await getAllTags();
      setAvailableTags(allTags);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('Failed to load tags', { error: error.message });
      } else {
        logger.error('Failed to load tags', { error: String(error) });
      }
    }
  };

  // Filter out tags already added to this incident
  const filteredAvailableTags = availableTags.filter(
    at => !tags.some(t => t.name.toLowerCase() === at.name.toLowerCase())
  );

  // In 'bar' variant, show up to 3 tags directly, then "+N more" to keep bar sleek
  const maxDirectTags = 3;
  const visibleTags = variant === 'bar' ? tags.slice(0, maxDirectTags) : tags;
  const overflowTags = variant === 'bar' ? tags.slice(maxDirectTags) : [];

  const addTagPopover = canManage && (
    <Popover
      open={open}
      onOpenChange={isOpen => {
        setOpen(isOpen);
        if (isOpen) loadAvailableTags();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs rounded-md border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-400 gap-1 font-medium shadow-2xs transition-all"
        >
          <Plus className="h-3 w-3" />
          <span>{tags.length === 0 ? 'Add Tag' : 'Tag'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-64 shadow-lg border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search or create tag..."
            className="h-9 text-xs"
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList className="max-h-52">
            <CommandEmpty className="py-2.5 px-3 text-center">
              {searchValue.trim() ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full h-8 text-xs font-semibold gap-1.5"
                  onClick={() => handleAddTag(searchValue)}
                  disabled={isPending}
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Create &quot;{searchValue.trim()}&quot;
                </Button>
              ) : (
                <p className="text-xs text-slate-400">Type tag name...</p>
              )}
            </CommandEmpty>
            {filteredAvailableTags.length > 0 && (
              <CommandGroup heading="Existing Workspace Tags">
                {filteredAvailableTags.map(tag => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => handleAddTag(tag.name)}
                    className="text-xs cursor-pointer flex items-center justify-between py-1.5"
                  >
                    <span className="font-semibold">#{tag.name}</span>
                    <Plus className="h-3 w-3 text-slate-400 opacity-60" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap min-w-0', className)}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 select-none flex items-center gap-1 shrink-0">
        <TagIcon className="h-3 w-3" />
        Tags:
      </span>

      {/* Visible Tags */}
      {visibleTags.map(tag => {
        const isRemoving = removingId === tag.id;
        return (
          <span
            key={tag.id}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold border transition-all shadow-2xs group shrink-0',
              getTagClass(tag.name)
            )}
          >
            <span>#{tag.name}</span>
            {canManage && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  handleRemoveTag(tag.id, tag.name);
                }}
                disabled={isPending}
                aria-label={`Remove tag ${tag.name}`}
                className="opacity-50 hover:opacity-100 disabled:opacity-30 rounded hover:bg-black/10 dark:hover:bg-white/10 p-0.5 transition-opacity"
              >
                {isRemoving ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            )}
          </span>
        );
      })}

      {/* Overflow "+N more" badge with popover */}
      {overflowTags.length > 0 && (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs font-semibold text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 shadow-2xs hover:bg-slate-100"
            >
              +{overflowTags.length} more
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-3 w-56 shadow-lg border-slate-200 dark:border-slate-800 rounded-xl"
            align="start"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Additional Tags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {overflowTags.map(tag => (
                <span
                  key={tag.id}
                  className={cn(
                    'inline-flex items-center gap-1 h-6 px-2 rounded-md text-xs font-semibold border shadow-2xs',
                    getTagClass(tag.name)
                  )}
                >
                  <span>#{tag.name}</span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag.id, tag.name)}
                      disabled={isPending}
                      className="opacity-50 hover:opacity-100 p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Empty State */}
      {tags.length === 0 && !canManage && (
        <span className="text-xs text-slate-400 italic">None</span>
      )}

      {/* Add Tag Popover Trigger */}
      {addTagPopover}
    </div>
  );
}
