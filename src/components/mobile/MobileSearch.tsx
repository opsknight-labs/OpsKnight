'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/shadcn/input';

type MobileSearchProps = {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  suggestions?: string[];
  leftIcon?: ReactNode;
  rightAction?: ReactNode;
  autoFocus?: boolean;
};

export default function MobileSearch({
  placeholder = 'Search...',
  value: controlledValue,
  onChange,
  onSearch,
  suggestions = [],
  leftIcon,
  rightAction,
  autoFocus = false,
}: MobileSearchProps) {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const value = controlledValue !== undefined ? controlledValue : internalValue;
  const filteredSuggestions = suggestions
    .filter(suggestion => suggestion.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 5);
  const showSuggestions = isFocused && value.length > 0 && filteredSuggestions.length > 0;

  const handleChange = (newValue: string) => {
    if (controlledValue === undefined) setInternalValue(newValue);
    onChange?.(newValue);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSearch?.(value);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    handleChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="group relative w-full min-w-0">
      <form onSubmit={handleSubmit} className="relative flex w-full min-w-0 items-center">
        {leftIcon && (
          <div
            className="pointer-events-none absolute left-3 z-10 text-muted-foreground"
            aria-hidden="true"
          >
            {leftIcon}
          </div>
        )}

        <Input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={event => handleChange(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => window.setTimeout(() => setIsFocused(false), 150)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={cn(
            'h-11 min-h-[44px] min-w-0 flex-1 rounded-xl border-input bg-background pr-11 text-foreground shadow-sm focus-visible:ring-ring',
            leftIcon ? 'pl-9' : 'px-4'
          )}
        />

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-1.5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {rightAction && <div className="ml-2 shrink-0">{rightAction}</div>}
      </form>

      {showSuggestions && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="p-2">
            {filteredSuggestions.map(suggestion => (
              <button
                key={suggestion}
                type="button"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  handleChange(suggestion);
                  onSearch?.(suggestion);
                  setIsFocused(false);
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-popover-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Search className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate">{suggestion}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MobileFilterChip({
  label,
  active = false,
  count,
  onClick,
}: {
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.65rem] font-bold tabular-nums',
            active
              ? 'bg-primary-foreground/15 text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
