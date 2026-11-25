'use client';

import { useEffect, useId, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Label } from '@/components/ui/shadcn/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { cn } from '@/lib/utils';

export type DependencyDraft = {
  dependentId: string;
  dependencyId: string;
  dependencyType: 'HARD' | 'SOFT';
  note: string;
  criticality: '' | 'LOW' | 'MEDIUM' | 'HIGH';
};

export const EMPTY_DRAFT: DependencyDraft = {
  dependentId: '',
  dependencyId: '',
  dependencyType: 'HARD',
  note: '',
  criticality: '',
};

type Option = { id: string; name: string };

/** A searchable single choice among up to a couple of thousand services (a combobox, not a long list). */
function ServicePicker({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly Option[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const selected = options.find(option => option.id === value);
  return (
    <div className="space-y-1.5">
      <Label id={labelId}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-labelledby={labelId}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">{selected?.name ?? 'Choose a service…'}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search services…" />
            <CommandList>
              <CommandEmpty>No service found.</CommandEmpty>
              <CommandGroup>
                {options.slice(0, 300).map(option => (
                  <CommandItem
                    key={option.id}
                    value={`${option.name} ${option.id}`}
                    onSelect={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn('h-4 w-4', option.id === value ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    <span className="truncate">{option.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Add or edit a dependency without dragging: the same connect action, with the edge's type, note and
 * criticality. Editing an existing edge is the same upsert with both ends fixed.
 */
export default function GraphDependencyDialog({
  open,
  onOpenChange,
  dependents,
  dependencies,
  initial,
  fixedEnds = false,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Services the viewer may change (the dependent decides who may edit). */
  dependents: readonly Option[];
  dependencies: readonly Option[];
  initial: DependencyDraft;
  fixedEnds?: boolean;
  saving: boolean;
  onSubmit: (draft: DependencyDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    if (open) setDraft(initial);
  }, [open, initial]);
  const noteId = useId();
  const valid =
    !!draft.dependentId && !!draft.dependencyId && draft.dependentId !== draft.dependencyId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{fixedEnds ? 'Edit dependency' : 'Add dependency'}</DialogTitle>
          <DialogDescription>
            The dependent service relies on the service it depends on. Adding a dependency that
            would create a cycle is rejected.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={event => {
            event.preventDefault();
            if (valid) onSubmit(draft);
          }}
        >
          <ServicePicker
            label="Dependent service"
            options={dependents}
            value={draft.dependentId}
            disabled={fixedEnds}
            onChange={dependentId => setDraft(current => ({ ...current, dependentId }))}
          />
          <ServicePicker
            label="Depends on"
            options={dependencies.filter(option => option.id !== draft.dependentId)}
            value={draft.dependencyId}
            disabled={fixedEnds}
            onChange={dependencyId => setDraft(current => ({ ...current, dependencyId }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dep-type">Type</Label>
              <Select
                value={draft.dependencyType}
                onValueChange={value =>
                  setDraft(current => ({ ...current, dependencyType: value as 'HARD' | 'SOFT' }))
                }
              >
                <SelectTrigger id="dep-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HARD">Hard: fails when it fails</SelectItem>
                  <SelectItem value="SOFT">Soft: degrades gracefully</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dep-criticality">Criticality</Label>
              <Select
                value={draft.criticality || 'none'}
                onValueChange={value =>
                  setDraft(current => ({
                    ...current,
                    criticality: value === 'none' ? '' : (value as DependencyDraft['criticality']),
                  }))
                }
              >
                <SelectTrigger id="dep-criticality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={noteId}>Note</Label>
            <Textarea
              id={noteId}
              maxLength={500}
              value={draft.note}
              onChange={event => setDraft(current => ({ ...current, note: event.target.value }))}
              placeholder="Why this dependency exists, or how it fails."
            />
            <p className="text-right text-2xs tabular-nums text-muted-foreground">
              {draft.note.length}/500
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {fixedEnds ? 'Save' : 'Add dependency'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
