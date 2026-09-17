'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Button } from '@/components/ui/shadcn/button';
import { Shield, ChevronsUpDown, Check, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EscalationPolicyOption {
  id: string;
  name: string;
  description?: string | null;
}

interface EscalationPolicyComboboxProps {
  policies: EscalationPolicyOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  placeholder?: string;
}

export default function EscalationPolicyCombobox({
  policies,
  value,
  onChange,
  disabled = false,
  name = 'escalationPolicyId',
  id = 'escalationPolicyId',
  className,
  placeholder = 'No Policy Attached (Unassigned)',
}: EscalationPolicyComboboxProps) {
  const [open, setOpen] = useState(false);

  const selectedPolicy = policies.find(p => p.id === value);

  return (
    <div className={cn('relative w-full', className)}>
      {/* Form-bound element for FormData collection & label association */}
      <input
        type="text"
        id={id}
        name={name}
        value={value}
        readOnly
        disabled={disabled}
        tabIndex={-1}
        className="sr-only"
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Choose policy"
            data-testid="escalation-policy-trigger"
            disabled={disabled}
            className={cn(
              'w-full h-9 justify-between font-normal text-xs bg-background shadow-xs hover:bg-accent/40 px-3',
              !selectedPolicy && 'text-muted-foreground'
            )}
          >
            <div className="flex items-center gap-2 truncate min-w-0">
              <div
                className={cn(
                  'w-5 h-5 rounded-md flex items-center justify-center shrink-0 border shadow-2xs',
                  selectedPolicy
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-muted text-muted-foreground border-border'
                )}
              >
                <Shield className="h-3 w-3" />
              </div>
              <span className="truncate font-medium text-foreground">
                {selectedPolicy ? selectedPolicy.name : placeholder}
              </span>
            </div>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0 shadow-lg rounded-xl border border-border/80"
          align="start"
        >
          <Command className="rounded-xl">
            <CommandInput
              placeholder="Search escalation policies..."
              className="text-xs h-9"
              aria-label="Search escalation policies"
            />
            <CommandList className="max-h-[260px] p-1">
              <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
                No escalation policies found.
              </CommandEmpty>

              <CommandGroup heading="Routing Option">
                <CommandItem
                  value="none unassigned no policy attached default"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                  className="text-xs flex items-center justify-between cursor-pointer py-2 px-2.5 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
                      <Shield className="h-3 w-3" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">No Policy Attached</div>
                      <div className="text-[10px] text-muted-foreground">
                        Alerts will not trigger automated on-call paging
                      </div>
                    </div>
                  </div>
                  {!value && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
                </CommandItem>
              </CommandGroup>

              {policies.length > 0 && (
                <CommandGroup heading={`Configured Policies (${policies.length})`}>
                  {policies.map(p => {
                    const isSelected = p.id === value;
                    return (
                      <CommandItem
                        key={p.id}
                        value={`${p.name} ${p.description || ''}`}
                        onSelect={() => {
                          onChange(p.id);
                          setOpen(false);
                        }}
                        className="text-xs flex items-center justify-between cursor-pointer py-2 px-2.5 rounded-lg"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0 border border-primary/20">
                            <Shield className="h-3 w-3" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground truncate">{p.name}</div>
                            {p.description && (
                              <div className="text-[10px] text-muted-foreground truncate max-w-[220px]">
                                {p.description}
                              </div>
                            )}
                          </div>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>

            <div className="p-2 border-t border-border/50 bg-muted/20 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {policies.length} total {policies.length === 1 ? 'policy' : 'policies'}
              </span>
              <Link
                href="/policies"
                className="text-[11px] text-primary hover:underline font-medium inline-flex items-center gap-1"
                onClick={() => setOpen(false)}
              >
                Manage policies <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
