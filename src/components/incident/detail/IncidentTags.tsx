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
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Check, ChevronsUpDown, Plus, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type IncidentTagsProps = {
  incidentId: string;
  tags: Array<{ id: string; name: string; color?: string | null }>;
  canManage: boolean;
};

export default function IncidentTags({ incidentId, tags, canManage }: IncidentTagsProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [availableTags, setAvailableTags] = useState<Array<{ id: string; name: string }>>([]);
  const [isPending, startTransition] = useTransition();

  const handleAddTag = async (tagName: string) => {
    startTransition(async () => {
      try {
        await addTagToIncident(incidentId, tagName.trim());
        showToast('Tag added successfully', 'success');
        setSearchValue('');
        setOpen(false);
        router.refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to add tag', 'error');
      }
    });
  };

  const handleRemoveTag = async (tagId: string) => {
    startTransition(async () => {
      try {
        await removeTagFromIncident(incidentId, tagId);
        showToast('Tag removed successfully', 'success');
        router.refresh();
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to remove tag', 'error');
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

  const getTagColor = (tagName: string) => {
    // Simple hash-based color generation
    const colors = [
      { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
      { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
      { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' },
      { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' },
      { bg: '#fce7f3', color: '#9f1239', border: '#fbcfe8' },
      { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
    ];
    const hash = tagName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  // Filter out tags already added to this incident
  const filteredAvailableTags = availableTags.filter(
    at => !tags.some(t => t.name.toLowerCase() === at.name.toLowerCase())
  );

  return (
    <div className="mb-6">
      <div className="mb-2">
        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          TAGS
        </h4>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {tags.map(tag => {
          const tagColors = getTagColor(tag.name);
          return (
            <Badge
              key={tag.id}
              variant="outline"
              size="xs"
              className="transition-all hover:shadow-sm"
              style={{
                backgroundColor: tagColors.bg,
                color: tagColors.color,
                borderColor: tagColors.border,
              }}
            >
              #{tag.name}
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag.id)}
                  disabled={isPending}
                  className="ml-1.5 hover:opacity-70 disabled:opacity-50 rounded-full p-0.5 hover:bg-black/5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          );
        })}

        {canManage && (
          <Popover
            open={open}
            onOpenChange={isOpen => {
              setOpen(isOpen);
              if (isOpen) loadAvailableTags();
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 rounded-full px-2 text-xs border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/50 bg-transparent"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Tag
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[200px]" align="start">
              <Command>
                <CommandInput
                  placeholder="Search/Create tag..."
                  className="h-9"
                  value={searchValue}
                  onValueChange={setSearchValue}
                />
                <CommandList>
                  <CommandEmpty className="py-2 px-2">
                    <p className="text-xs text-muted-foreground mb-2 text-center">
                      No existing tag found.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={() => handleAddTag(searchValue)}
                    >
                      Create "{searchValue}"
                    </Button>
                  </CommandEmpty>
                  <CommandGroup heading="Existing Tags">
                    {filteredAvailableTags.map(tag => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => handleAddTag(tag.name)}
                        className="text-xs"
                      >
                        {tag.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {tags.length === 0 && !canManage && (
        <p className="text-sm text-muted-foreground italic">No tags assigned</p>
      )}
    </div>
  );
}
