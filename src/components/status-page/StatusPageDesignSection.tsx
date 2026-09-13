'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Code,
  Layers,
  RotateCcw,
  Sparkles,
  Sun,
  Moon,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { InlineNotice } from '@/components/ui/InlineNotice';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { cn } from '@/lib/utils';
import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  STATUS_PAGE_THEMES,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
  type StatusPageThemeDensity,
  type StatusPageThemeMode,
} from '@/lib/status-pages/theme-contract';

interface StatusPageDesignSectionProps {
  themeId: string;
  density: StatusPageThemeDensity;
  customCss: string;
  onThemeChange: (themeId: string) => void;
  onDensityChange: (density: StatusPageThemeDensity) => void;
  onCustomCssChange: (customCss: string) => void;
}

type ModeFilter = 'all' | StatusPageThemeMode;

/**
 * Compact and organized Design section for Status Page settings.
 *
 * Provides a streamlined theme browser categorized by mode and family,
 * immediate density controls at the top, and a clean collapsible Advanced CSS drawer.
 */
export default function StatusPageDesignSection({
  themeId,
  density,
  customCss,
  onThemeChange,
  onDensityChange,
  onCustomCssChange,
}: StatusPageDesignSectionProps) {
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [cssExpanded, setCssExpanded] = useState(() =>
    Boolean(customCss && customCss.trim().length > 0)
  );

  const selectedTheme = resolveStatusPageTheme(themeId);
  const legacyCssIgnored =
    selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID && isLegacyStatusPageTemplateCss(customCss);

  // Extract unique families for filtering
  const families = useMemo(() => {
    const list = Array.from(new Set(STATUS_PAGE_THEMES.map(t => t.family)));
    return ['all', ...list];
  }, []);

  // Filtered themes based on mode and family
  const filteredThemes = useMemo(() => {
    return STATUS_PAGE_THEMES.filter(theme => {
      if (modeFilter !== 'all' && theme.mode !== modeFilter) return false;
      if (familyFilter !== 'all' && theme.family !== familyFilter) return false;
      return true;
    });
  }, [modeFilter, familyFilter]);

  const lightCount = useMemo(() => STATUS_PAGE_THEMES.filter(t => t.mode === 'light').length, []);
  const darkCount = useMemo(() => STATUS_PAGE_THEMES.filter(t => t.mode === 'dark').length, []);

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Primary Design Controls Card */}
      <StatusPageSectionCard
        title="Theme & Layout"
        description="Select a status page theme and layout density. Changes synchronize with the live preview immediately."
        icon={<Sparkles className="h-4.5 w-4.5 text-primary" />}
        action={
          selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onThemeChange(DEFAULT_STATUS_PAGE_THEME_ID)}
              className="h-8 gap-1.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to default
            </Button>
          ) : undefined
        }
      >
        {/* Active Theme & Density Toolbar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Theme preview swatch */}
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border shadow-2xs"
              style={{
                backgroundColor: selectedTheme.preview.surface,
                borderColor: `${selectedTheme.preview.accent}40`,
              }}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: selectedTheme.preview.accent }}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground truncate">
                  {selectedTheme.name}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                  {selectedTheme.family}
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    selectedTheme.mode === 'dark'
                      ? 'bg-slate-800 text-slate-200'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                  )}
                >
                  {selectedTheme.mode}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground truncate leading-tight">
                {selectedTheme.description}
              </p>
            </div>
          </div>

          {/* Density Control Switcher */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              Density:
            </span>
            <div className="inline-flex rounded-md border border-border bg-background p-0.5">
              {(['comfortable', 'compact'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={density === option}
                  onClick={() => onDensityChange(option)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    density === option
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          {/* Mode Tabs */}
          <div className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setModeFilter('all')}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium transition-colors',
                modeFilter === 'all'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              All ({STATUS_PAGE_THEMES.length})
            </button>
            <button
              type="button"
              onClick={() => setModeFilter('light')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
                modeFilter === 'light'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Sun className="h-3 w-3 text-amber-500" />
              Light ({lightCount})
            </button>
            <button
              type="button"
              onClick={() => setModeFilter('dark')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors',
                modeFilter === 'dark'
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Moon className="h-3 w-3 text-indigo-400" />
              Dark ({darkCount})
            </button>
          </div>

          {/* Family Filter Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Category:</span>
            <select
              value={familyFilter}
              onChange={e => setFamilyFilter(e.target.value)}
              className="h-7.5 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Filter by theme family"
            >
              {families.map(f => (
                <option key={f} value={f}>
                  {f === 'all' ? 'All Collections' : f.charAt(0).toUpperCase() + f.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Compact Themes Grid */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredThemes.map(theme => {
            const isSelected = theme.id === selectedTheme.id;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onThemeChange(theme.id)}
                className={cn(
                  'group relative flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-2xs ring-1 ring-primary/30'
                    : 'border-border/80 bg-card hover:border-primary/40 hover:bg-muted/30'
                )}
              >
                {/* Mini Swatch Box */}
                <div
                  className="flex h-9 w-9 shrink-0 flex-col justify-between rounded-md border p-1 shadow-2xs"
                  style={{
                    backgroundColor: theme.preview.surface,
                    borderColor: `${theme.preview.accent}30`,
                  }}
                >
                  <div
                    className="h-1 w-full rounded-xs"
                    style={{
                      backgroundColor:
                        theme.id === DEFAULT_STATUS_PAGE_THEME_ID
                          ? '#cbd5e1'
                          : theme.preview.accent,
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <span
                      className="h-1 w-2.5 rounded-xs"
                      style={{ backgroundColor: `${theme.preview.text}50` }}
                    />
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          theme.id === DEFAULT_STATUS_PAGE_THEME_ID
                            ? '#10b981'
                            : theme.preview.accent,
                      }}
                    />
                  </div>
                </div>

                {/* Theme Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {theme.name}
                    </span>
                    <span className="rounded bg-muted/80 px-1 py-0.2 text-[9px] font-medium capitalize text-muted-foreground">
                      {theme.family}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                    {theme.description}
                  </p>
                </div>

                {/* Selected Indicator */}
                {isSelected && (
                  <span className="shrink-0 rounded-full bg-primary p-0.5 text-primary-foreground shadow-2xs">
                    <Check className="h-3 w-3 stroke-[2.5]" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {filteredThemes.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No themes found matching your filter criteria.
          </div>
        )}
      </StatusPageSectionCard>

      {/* 2. Advanced Custom CSS Drawer Card */}
      <StatusPageSectionCard
        title={
          <div className="flex items-center gap-2">
            <span>Advanced CSS</span>
            {customCss && customCss.trim().length > 0 && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                {customCss.trim().length} chars
              </span>
            )}
          </div>
        }
        description="Optional CSS overrides applied on top of the selected theme."
        icon={<Code className="h-4.5 w-4.5 text-primary" />}
        action={
          <div className="flex items-center gap-2">
            {customCss ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCustomCssChange('')}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                Clear
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCssExpanded(!cssExpanded)}
              className="h-7 gap-1 px-2.5 text-xs"
            >
              {cssExpanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Edit CSS
                </>
              )}
            </Button>
          </div>
        }
      >
        {legacyCssIgnored && (
          <InlineNotice tone="warning" title="Legacy template CSS is ignored" className="mb-3">
            This CSS came from the retired template gallery and is ignored while{' '}
            {selectedTheme.name} is selected.
          </InlineNotice>
        )}

        {cssExpanded ? (
          <div>
            <textarea
              value={customCss}
              onChange={event => onCustomCssChange(event.target.value)}
              rows={8}
              spellCheck={false}
              aria-label="Advanced CSS"
              placeholder="/* Optional advanced CSS overrides */"
              className="w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-xs leading-5 text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Styles written here have the highest specificity and override built-in theme styles.
            </p>
          </div>
        ) : (
          <div
            onClick={() => setCssExpanded(true)}
            className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-border/70 p-2.5 text-xs text-muted-foreground hover:bg-muted/20 hover:text-foreground transition-colors"
          >
            <span>
              {customCss.trim()
                ? `Custom CSS rules configured (${customCss.split('\n').length} lines). Click to edit.`
                : 'No custom CSS applied. Click to add custom stylesheet overrides.'}
            </span>
            <span className="text-primary font-medium text-[11px]">Edit CSS &rarr;</span>
          </div>
        )}
      </StatusPageSectionCard>
    </div>
  );
}
