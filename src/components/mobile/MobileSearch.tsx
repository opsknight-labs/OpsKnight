'use client';

import { useState, useRef, ReactNode } from 'react';
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
    .filter(s => s.toLowerCase().includes(value.toLowerCase()))
    .slice(0, 5);
  const showSuggestions = isFocused && value.length > 0 && filteredSuggestions.length > 0;

  const handleChange = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(value);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    handleChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full group">
      <form onSubmit={handleSubmit} className="relative w-full flex items-center">
        {/* Left Icon - Absolutely positioned */}
        <div className="absolute left-3 z-10 text-muted-foreground">
          {leftIcon || (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          )}
        </div>

        {/* Shadcn Input Component */}
        <Input
          ref={inputRef}
          type="search"
          name="q"
          value={value}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="flex-1 min-w-0 pl-9 pr-9 h-11 bg-background text-foreground border-input focus-visible:ring-primary shadow-sm"
        />

        {/* Clear Button - Absolutely positioned */}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 z-10 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        {rightAction && <div className="ml-2">{rightAction}</div>}
      </form>

      {/* Suggestions Dropdown - Floating Panel style */}
      {showSuggestions && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-2xl ring-1 ring-black/5">
          <div className="px-2 py-2">
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                onClick={() => {
                  handleChange(suggestion);
                  onSearch?.(suggestion);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors',
                  'text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-secondary)] hover:text-[color:var(--text-primary)]'
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--bg-secondary)]/50 text-[color:var(--text-muted)]">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </div>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Filter Chip component for filter UI
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
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all',
        active
          ? 'border-primary bg-primary text-white shadow-md shadow-primary/25'
          : 'border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--bg-secondary)]'
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'flex h-4 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[0.65rem] font-bold',
            active
              ? 'bg-white/20 text-white'
              : 'bg-[color:var(--bg-primary)] text-[color:var(--text-muted)]'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
