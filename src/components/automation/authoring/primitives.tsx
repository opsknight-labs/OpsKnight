'use client';
import {
  Children,
  forwardRef,
  isValidElement,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { AlertCircle, Check, ChevronDown, Search, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';

export const selectClass =
  'peer flex h-8.5 w-full min-w-0 appearance-none cursor-pointer rounded-lg border border-border/70 bg-background/90 py-1 pl-2.5 pr-8 text-xs font-medium text-foreground shadow-2xs transition-all duration-150 hover:border-border hover:bg-background focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/30 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30';

export const textareaClass =
  'flex w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface NativeSelectProps extends ComponentProps<'select'> {
  wrapperClassName?: string;
  iconClassName?: string;
  icon?: LucideIcon;
}

interface ParsedOptionItem {
  value: string;
  rawLabel: string;
  title: string;
  path?: string;
  badge?: string;
  disabled?: boolean;
  group?: string;
}

function getText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getText).join('');
  }
  if (isValidElement(node) && node.props && 'children' in (node.props as Record<string, unknown>)) {
    return getText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

function parseOptionText(raw: string): { title: string; path?: string; badge?: string } {
  const trimmed = raw.trim();

  // Pattern: "Title — path (BADGE)" or "Title — path"
  if (trimmed.includes(' — ')) {
    const [left, ...restParts] = trimmed.split(' — ');
    const right = restParts.join(' — ').trim();
    const badgeMatch = right.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (badgeMatch) {
      return {
        title: left.trim(),
        path: badgeMatch[1].trim(),
        badge: badgeMatch[2].trim(),
      };
    }
    return {
      title: left.trim(),
      path: right,
    };
  }

  // Pattern: "Title (BADGE)"
  const badgeMatch = trimmed.match(/^(.*?)\s*\(([^)]+)\)$/);
  if (badgeMatch) {
    return {
      title: badgeMatch[1].trim(),
      badge: badgeMatch[2].trim(),
    };
  }

  return { title: trimmed };
}

function extractOptions(children: ReactNode, currentGroup?: string): ParsedOptionItem[] {
  const items: ParsedOptionItem[] = [];

  Children.forEach(children, child => {
    if (!isValidElement(child)) return;

    if (child.type === 'option') {
      const childProps = child.props as {
        value?: string | number;
        disabled?: boolean;
        children?: ReactNode;
      };
      const value = String(
        childProps.value !== undefined ? childProps.value : (childProps.children ?? '')
      );
      const rawLabel = getText(childProps.children);
      const parsed = parseOptionText(rawLabel);
      items.push({
        value,
        rawLabel,
        title: parsed.title || rawLabel || value,
        path: parsed.path,
        badge: parsed.badge,
        disabled: childProps.disabled,
        group: currentGroup,
      });
    } else if (child.type === 'optgroup') {
      const groupProps = child.props as { label?: string; children?: ReactNode };
      const groupLabel = groupProps.label || '';
      const nested = extractOptions(groupProps.children, groupLabel);
      items.push(...nested);
    } else if (
      child.props &&
      typeof child.props === 'object' &&
      'children' in (child.props as Record<string, unknown>)
    ) {
      const nested = extractOptions(
        (child.props as { children?: ReactNode }).children,
        currentGroup
      );
      items.push(...nested);
    }
  });

  return items;
}

interface OptionItemProps {
  opt: ParsedOptionItem;
  isSelected: boolean;
  onSelect: (value: string) => void;
}

function OptionItemRow({ opt, isSelected, onSelect }: OptionItemProps) {
  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-disabled={opt.disabled}
      onClick={() => {
        if (!opt.disabled) {
          onSelect(opt.value);
        }
      }}
      className={cn(
        'relative flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer text-xs transition-colors select-none',
        isSelected
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
        opt.disabled && 'opacity-40 cursor-not-allowed pointer-events-none'
      )}
    >
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={cn('truncate', isSelected ? 'font-semibold text-primary' : 'font-medium')}
          >
            {opt.title}
          </span>
          {opt.badge && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.2 text-[9px] font-semibold tracking-wide uppercase border',
                opt.badge === 'EVENTS_API'
                  ? 'bg-sky-500/10 text-sky-500 border-sky-500/20'
                  : opt.badge === 'GITHUB'
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    : opt.badge === 'CLOUDWATCH'
                      ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                      : opt.badge === 'DATADOG'
                        ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                        : 'bg-muted text-muted-foreground border-border/60'
              )}
            >
              {opt.badge}
            </span>
          )}
        </div>
        {opt.path && (
          <div className="mt-0.5 flex items-center">
            <code className="font-mono text-[10px] text-muted-foreground/90 bg-muted/60 px-1 py-0.2 rounded border border-border/40 truncate max-w-full">
              {opt.path}
            </code>
          </div>
        )}
      </div>

      {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary ml-1.5" />}
    </div>
  );
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  (
    {
      className,
      wrapperClassName,
      iconClassName,
      icon: Icon = ChevronDown,
      children,
      disabled,
      value: controlledValue,
      defaultValue,
      onChange,
      ...props
    },
    ref
  ) => {
    const hasExplicitWidth = className && /\b(w-|flex-|grow|shrink|col-span-)/.test(className);
    const innerSelectRef = useRef<HTMLSelectElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [internalValue, setInternalValue] = useState<
      string | number | readonly string[] | undefined
    >(
      controlledValue !== undefined
        ? controlledValue
        : defaultValue !== undefined
          ? defaultValue
          : ''
    );

    const activeValue = controlledValue !== undefined ? controlledValue : internalValue;

    useImperativeHandle(ref, () => innerSelectRef.current as HTMLSelectElement);

    // Extract all parsed options and groups from children
    const options = useMemo(() => extractOptions(children), [children]);

    const selectedOption = useMemo(() => {
      return options.find(o => o.value === String(activeValue ?? ''));
    }, [options, activeValue]);

    // Filter options based on search query
    const filteredOptions = useMemo(() => {
      if (!searchQuery.trim()) return options;
      const q = searchQuery.toLowerCase().trim();
      return options.filter(opt => {
        const inTitle = opt.title.toLowerCase().includes(q);
        const inPath = opt.path?.toLowerCase().includes(q);
        const inBadge = opt.badge?.toLowerCase().includes(q);
        const inRaw = opt.rawLabel.toLowerCase().includes(q);
        const inValue = opt.value.toLowerCase().includes(q);
        return inTitle || inPath || inBadge || inRaw || inValue;
      });
    }, [options, searchQuery]);

    // Group options by group label
    const groupedOptions = useMemo(() => {
      const groups: { name?: string; items: ParsedOptionItem[] }[] = [];
      const map = new Map<string, ParsedOptionItem[]>();

      for (const opt of filteredOptions) {
        const key = opt.group || '';
        if (!map.has(key)) {
          map.set(key, []);
          groups.push({ name: opt.group, items: map.get(key)! });
        }
        map.get(key)!.push(opt);
      }
      return groups;
    }, [filteredOptions]);

    const handleSelectOption = useCallback(
      (optionValue: string) => {
        const selectEl = innerSelectRef.current;
        if (selectEl) {
          // Set value on select
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLSelectElement.prototype,
            'value'
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(selectEl, optionValue);
          } else {
            selectEl.value = optionValue;
          }

          // Dispatch synthetic & native change events
          const event = new Event('change', { bubbles: true });
          selectEl.dispatchEvent(event);

          if (onChange) {
            const syntheticEvent = {
              target: selectEl,
              currentTarget: selectEl,
              bubbles: true,
              cancelable: true,
              defaultPrevented: false,
              eventPhase: 3,
              isTrusted: true,
              nativeEvent: event,
              persist: () => {},
              preventDefault: () => {},
              stopPropagation: () => {},
              type: 'change',
            } as unknown as React.ChangeEvent<HTMLSelectElement>;
            onChange(syntheticEvent);
          }
        }

        setInternalValue(optionValue);
        setOpen(false);
        setSearchQuery('');
        triggerRef.current?.focus();
      },
      [onChange]
    );

    return (
      <div
        className={cn(
          'relative inline-flex items-center min-w-0',
          !hasExplicitWidth && !wrapperClassName?.includes('w-') && 'w-full',
          wrapperClassName
        )}
      >
        {/*
          Accessible hidden native select element.
          Kept in the DOM with sr-only so that testing-library (getByLabelText, getByRole('combobox')),
          form submissions, and accessibility inspectors remain 100% compatible.
        */}
        <select
          ref={innerSelectRef}
          disabled={disabled}
          value={activeValue}
          className="sr-only"
          tabIndex={-1}
          onChange={e => {
            setInternalValue(e.target.value);
            onChange?.(e);
          }}
          {...props}
        >
          {children}
        </select>

        {/* Custom styled Popover Trigger and Menu */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              disabled={disabled}
              id={props.id ? `${props.id}-custom-trigger` : undefined}
              aria-haspopup="listbox"
              aria-expanded={open}
              data-invalid={props['aria-invalid'] ? 'true' : undefined}
              aria-describedby={props['aria-describedby']}
              className={cn(
                'group flex h-8.5 w-full min-w-0 items-center justify-between rounded-lg border border-border/70 bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-2xs transition-all duration-150',
                'hover:border-border hover:bg-background',
                'focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0',
                'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted/30',
                props['aria-invalid'] && 'border-destructive ring-destructive/30',
                className
              )}
            >
              <div className="flex items-center gap-1.5 truncate min-w-0 flex-1 text-left">
                {selectedOption ? (
                  <>
                    <span className="font-medium text-foreground truncate">
                      {selectedOption.title}
                    </span>
                    {selectedOption.path && (
                      <span className="hidden sm:inline-block font-mono text-[10px] text-muted-foreground/80 bg-muted/60 px-1 py-0.2 rounded border border-border/40 truncate">
                        {selectedOption.path}
                      </span>
                    )}
                    {selectedOption.badge && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.2 text-[9px] font-semibold tracking-wide uppercase border',
                          selectedOption.badge === 'EVENTS_API'
                            ? 'bg-sky-500/10 text-sky-500 border-sky-500/20'
                            : selectedOption.badge === 'GITHUB'
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              : selectedOption.badge === 'CLOUDWATCH'
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                : selectedOption.badge === 'DATADOG'
                                  ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                  : 'bg-muted text-muted-foreground border-border/60'
                        )}
                      >
                        {selectedOption.badge}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground truncate">
                    {String(activeValue) || 'Choose option…'}
                  </span>
                )}
              </div>

              <Icon
                className={cn(
                  'ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150',
                  'group-hover:text-foreground group-focus-visible:text-primary',
                  open && 'rotate-180 text-foreground',
                  disabled && 'opacity-40',
                  iconClassName
                )}
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>

          <PopoverContent
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[260px] max-w-[min(92vw,500px)] rounded-xl border border-border/80 bg-popover/95 p-0 text-popover-foreground shadow-2xl backdrop-blur-md focus:outline-none"
          >
            {/* Built-in Search Filter for menus with > 5 items */}
            {options.length > 5 && (
              <div className="p-1.5 border-b border-border/60 bg-muted/20">
                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search options, paths, integrations..."
                    className="h-7 w-full rounded-md bg-background/80 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/60 border border-border/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/40"
                    onClick={e => e.stopPropagation()}
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Options List with Optgroup Separation and Multi-part Item Layout */}
            <div
              role="listbox"
              className="max-h-64 overflow-y-auto overscroll-contain p-1 space-y-0.5 text-xs"
            >
              {filteredOptions.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No matching options found
                </div>
              ) : (
                groupedOptions.map((grp, grpIdx) => (
                  <div key={grp.name || `group-${grpIdx}`} className="space-y-0.5">
                    {grp.name && (
                      <div className="sticky top-0 z-10 my-1 first:mt-0 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 bg-muted/80 backdrop-blur-sm rounded-md border-b border-border/40">
                        {grp.name}
                      </div>
                    )}
                    {grp.items.map(opt => {
                      const isSelected = opt.value === String(activeValue ?? '');
                      return (
                        <OptionItemRow
                          key={opt.value}
                          opt={opt}
                          isSelected={isSelected}
                          onSelect={handleSelectOption}
                        />
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }
);
NativeSelect.displayName = 'NativeSelect';

export function LimitCounter({
  count,
  limit,
  noun,
  className,
}: {
  count: number;
  limit: number;
  noun: string;
  className?: string;
}) {
  const full = count >= limit;
  return (
    <span
      className={cn(
        'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums',
        full
          ? 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-border/70 text-muted-foreground',
        className
      )}
    >
      {count} / {limit} {noun}
      {full && <span className="sr-only"> (limit reached)</span>}
    </span>
  );
}

export function InlineError({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-xs text-destructive', className)}>
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Hint({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('text-xs text-muted-foreground', className)}>
      {children}
    </p>
  );
}

/** Fieldset whose legend sits in a header row alongside optional metadata such as a limit counter. */
export function AuthoringFieldset({
  legend,
  description,
  aside,
  children,
  className,
  compact = false,
}: {
  legend: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <fieldset
      className={cn(
        'min-w-0 rounded-lg border border-border/70',
        compact ? 'p-2.5 sm:p-3 bg-muted/10' : 'p-3 sm:p-4',
        className
      )}
    >
      <legend
        className={cn(
          'float-left flex w-full flex-wrap items-center justify-between gap-1.5 font-semibold tracking-tight',
          compact ? 'text-xs text-foreground' : 'text-sm'
        )}
      >
        <span className="min-w-0">{legend}</span>
        {aside}
      </legend>
      <div className={cn('clear-both pt-1', compact ? 'space-y-2' : 'space-y-3')}>
        {description && (
          <p
            className={cn(
              'text-muted-foreground',
              compact ? 'text-[11px] leading-snug' : 'text-xs'
            )}
          >
            {description}
          </p>
        )}
        {children}
      </div>
    </fieldset>
  );
}
