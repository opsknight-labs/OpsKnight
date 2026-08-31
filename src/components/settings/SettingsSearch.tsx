'use client';

import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, X, Sparkles, Command } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import type { SettingsNavItem } from '@/components/settings/navConfig';

type Props = {
  items: SettingsNavItem[];
  placeholder?: string;
  className?: string;
  enableHotkey?: boolean;
};

export default function SettingsSearch({
  items,
  placeholder = 'Search settings, integrations, parameters...',
  className,
  enableHotkey = true,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listboxId = `settings-search-${id}`;

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return items.filter(item => {
      const haystack = [item.label, item.description, ...(item.keywords || [])]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [items, query]);

  const displayResults = useMemo(() => results.slice(0, 8), [results]);

  useEffect(() => {
    if (!enableHotkey) return;

    const handleHotkey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleHotkey);
    return () => document.removeEventListener('keydown', handleHotkey);
  }, [enableHotkey]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setActiveIndex(val.trim().length > 0 ? 0 : -1);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!displayResults.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(prev => (prev + 1) % displayResults.length);
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(prev => (prev <= 0 ? displayResults.length - 1 : prev - 1));
    }

    if (event.key === 'Enter') {
      const targetItem = displayResults.find((_, idx) => idx === activeIndex) ?? displayResults[0];
      if (targetItem) {
        event.preventDefault();
        router.push(targetItem.href);
        setQuery('');
        setIsFocused(false);
      }
    }

    if (event.key === 'Escape') {
      setQuery('');
      setIsFocused(false);
    }
  };

  const handleSelect = (href: string) => {
    router.push(href);
    setQuery('');
    setIsFocused(false);
  };

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={event => handleQueryChange(event.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-expanded={isFocused && query.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          role="combobox"
          className="w-full h-11 pl-10 pr-20 bg-white border border-slate-200 rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary shadow-2xs transition-all"
        />

        <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none">
          {query ? (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground pointer-events-auto cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : enableHotkey ? (
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground bg-slate-100 border border-slate-200 rounded-md">
              <Command className="h-3 w-3" />
              <span>K</span>
            </kbd>
          ) : null}
        </div>
      </div>

      {/* Floating Results Dropdown */}
      {isFocused && query.trim().length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden z-50 animate-in fade-in-0 zoom-in-95 duration-100 divide-y divide-slate-100"
        >
          {displayResults.length > 0 ? (
            <div className="p-1.5 space-y-1">
              {displayResults.map((item, index) => {
                const isSelected = index === activeIndex;

                return (
                  <div
                    key={item.id}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item.href)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors text-left',
                      isSelected
                        ? 'bg-slate-100 text-foreground'
                        : 'hover:bg-slate-50 text-slate-700'
                    )}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-sm text-foreground">{item.label}</span>
                        {item.badge && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            {item.badge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <ArrowRight
                      className={cn(
                        'h-4 w-4 transition-transform',
                        isSelected ? 'text-primary translate-x-0.5' : 'text-slate-300'
                      )}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-muted-foreground space-y-1">
              <Sparkles className="h-4 w-4 mx-auto text-muted-foreground mb-1.5" />
              <p className="font-medium text-foreground">No matching settings found</p>
              <p>
                Try searching for keywords like &quot;password&quot;, &quot;slack&quot;,
                &quot;timezone&quot;, or &quot;webhook&quot;.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
