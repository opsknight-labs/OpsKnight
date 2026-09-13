'use client';

import { Check, Code, RotateCcw, Sparkles } from 'lucide-react';
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
} from '@/lib/status-pages/theme-contract';

interface StatusPageDesignSectionProps {
  themeId: string;
  density: StatusPageThemeDensity;
  customCss: string;
  onThemeChange: (themeId: string) => void;
  onDensityChange: (density: StatusPageThemeDensity) => void;
  onCustomCssChange: (customCss: string) => void;
}

/**
 * Controlled Design section for the existing Status Page settings workspace.
 *
 * It intentionally owns no persistence and no separate preview state. The parent settings form is
 * the single source of truth, so selecting a theme immediately updates the existing live preview
 * and the normal Save Settings action publishes exactly that same appearance.
 */
export default function StatusPageDesignSection({
  themeId,
  density,
  customCss,
  onThemeChange,
  onDensityChange,
  onCustomCssChange,
}: StatusPageDesignSectionProps) {
  const selectedTheme = resolveStatusPageTheme(themeId);
  const legacyCssIgnored =
    selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID && isLegacyStatusPageTemplateCss(customCss);

  return (
    <div className="flex flex-col gap-6">
      <StatusPageSectionCard
        title="Design theme"
        description="Choose a curated Status Page design. Selection updates the existing live preview immediately; Save Settings publishes it."
        icon={<Sparkles className="h-5 w-5 text-primary" />}
        action={
          selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onThemeChange(DEFAULT_STATUS_PAGE_THEME_ID)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Natural default
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {STATUS_PAGE_THEMES.map(theme => {
            const selected = theme.id === selectedTheme.id;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onThemeChange(theme.id)}
                className={cn(
                  'overflow-hidden rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  selected
                    ? 'border-primary ring-1 ring-primary/30 shadow-md'
                    : 'border-border hover:border-primary/45 hover:shadow-sm'
                )}
              >
                <div
                  className="relative h-24 p-2.5"
                  style={{ background: theme.preview.surfaceAlt, color: theme.preview.text }}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-1"
                    style={{
                      background:
                        theme.id === DEFAULT_STATUS_PAGE_THEME_ID
                          ? 'transparent'
                          : theme.preview.accent,
                    }}
                  />
                  <div
                    className="flex h-full flex-col gap-2 border p-2"
                    style={{
                      background: theme.preview.surface,
                      borderColor: `${theme.preview.accent}35`,
                      borderRadius: theme.shape.radius,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="h-1.5 w-20 rounded-full bg-current opacity-60" />
                      <span
                        className="h-3.5 w-11 rounded-full"
                        style={{ background: theme.preview.accent }}
                      />
                    </div>
                    <div className="grid flex-1 grid-cols-2 gap-1.5">
                      <div
                        className="rounded border p-1.5"
                        style={{ borderColor: `${theme.preview.accent}30` }}
                      >
                        <span className="block h-1.5 w-10 rounded bg-current opacity-25" />
                        <span
                          className="mt-2 block h-1.5 w-12 rounded"
                          style={{ background: theme.preview.accent }}
                        />
                      </div>
                      <div
                        className="rounded border p-1.5"
                        style={{ borderColor: `${theme.preview.accent}30` }}
                      >
                        <span className="block h-1.5 w-9 rounded bg-current opacity-25" />
                        <span className="mt-2 block h-1.5 w-14 rounded bg-current opacity-10" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-start justify-between gap-3 bg-card p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{theme.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {theme.description}
                    </div>
                  </div>
                  {selected ? (
                    <span className="shrink-0 rounded-full bg-primary p-1 text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 text-xs font-semibold text-foreground">Density</div>
          <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
            {(['comfortable', 'compact'] as const).map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={density === option}
                onClick={() => onDensityChange(option)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                  density === option
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Advanced CSS"
        description="Optional final overrides applied after the selected theme. Leave empty for the most predictable theme behavior."
        icon={<Code className="h-5 w-5 text-primary" />}
        action={
          customCss ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onCustomCssChange('')}
            >
              Clear CSS
            </Button>
          ) : undefined
        }
      >
        {legacyCssIgnored ? (
          <InlineNotice tone="warning" title="Legacy template CSS is not applied" className="mb-3">
            This CSS came from the retired template gallery and contains broad legacy overrides that
            can conflict with curated themes. It is preserved for backwards compatibility with
            Natural Default, but ignored while {selectedTheme.name} is selected. Clear it if you no
            longer need the old template.
          </InlineNotice>
        ) : null}
        <textarea
          value={customCss}
          onChange={event => onCustomCssChange(event.target.value)}
          rows={14}
          spellCheck={false}
          aria-label="Advanced CSS"
          placeholder="/* Optional advanced overrides */"
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs leading-6 text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Built-in theme styles are deterministic. Advanced CSS is intentionally the final layer and
          can override them when required.
        </p>
      </StatusPageSectionCard>
    </div>
  );
}
