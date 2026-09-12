'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, Code, RotateCcw, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_VERSION,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
  type StatusPageThemeDensity,
  type StatusPageThemeFamily,
} from '@/lib/status-pages/theme-contract';

type BrandingRecord = Record<string, unknown>;

interface StatusPageDesignSettingsProps {
  statusPage: {
    id: string;
    name: string;
    updatedAt?: Date | string;
    branding?: unknown;
  };
}

const FAMILY_LABELS: Record<StatusPageThemeFamily | 'all', string> = {
  all: 'All',
  universal: 'Universal',
  enterprise: 'Enterprise',
  saas: 'SaaS',
  developer: 'Developer',
  gaming: 'Gaming',
  regulated: 'Regulated',
  consumer: 'Consumer',
};

function asBranding(value: unknown): BrandingRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as BrandingRecord)
    : {};
}

export default function StatusPageDesignSettings({ statusPage }: StatusPageDesignSettingsProps) {
  const initialBranding = useMemo(() => asBranding(statusPage.branding), [statusPage.branding]);
  const initialTheme = resolveStatusPageTheme(initialBranding.themeId);
  const initialDensity = resolveStatusPageThemeDensity(initialBranding.themeDensity);
  const initialCustomCss =
    typeof initialBranding.customCss === 'string' ? initialBranding.customCss : '';

  const [themeId, setThemeId] = useState(initialTheme.id);
  const [density, setDensity] = useState<StatusPageThemeDensity>(initialDensity);
  const [customCss, setCustomCss] = useState(initialCustomCss);
  const [family, setFamily] = useState<StatusPageThemeFamily | 'all'>('all');
  const [revision, setRevision] = useState(() =>
    statusPage.updatedAt ? new Date(statusPage.updatedAt).toISOString() : undefined
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTheme = resolveStatusPageTheme(themeId);
  const legacyTemplateCss = isLegacyStatusPageTemplateCss(customCss);
  const visibleThemes =
    family === 'all' ? STATUS_PAGE_THEMES : STATUS_PAGE_THEMES.filter(item => item.family === family);

  const dirty =
    themeId !== initialTheme.id || density !== initialDensity || customCss !== initialCustomCss;

  const selectTheme = (nextThemeId: string) => {
    setThemeId(nextThemeId);
    // Old gallery templates were copied into customCss. Only remove CSS that is positively
    // identified as one of those template payloads; genuine customer-written CSS is preserved.
    if (isLegacyStatusPageTemplateCss(customCss)) setCustomCss('');
    setError(null);
  };

  const resetAllDesignOverrides = () => {
    setThemeId(DEFAULT_STATUS_PAGE_THEME_ID);
    setDensity('comfortable');
    setCustomCss('');
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/settings/status-pages/${encodeURIComponent(statusPage.id)}/appearance`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: statusPage.id,
              expectedUpdatedAt: revision,
              branding: {
                version: 1,
                themeId,
                themeVersion: STATUS_PAGE_THEME_VERSION,
                themeDensity: density,
                customCss,
              },
            }),
          }
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to save status page design');
        }

        if (typeof payload?.data?.updatedAt === 'string') setRevision(payload.data.updatedAt);
        notify.success('Status page design saved and published.', {
          id: `status-page:${statusPage.id}:design:save`,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Failed to save status page design';
        setError(message);
      }
    });
  };

  return (
    <div className="p-4 sm:p-5 lg:p-6 space-y-6 bg-background min-h-[640px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Status Page Design
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Choose a curated design independently from brand colors and Advanced CSS. Built-in
            themes are versioned; customer CSS remains a final override layer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={resetAllDesignOverrides}>
            <RotateCcw className="h-3.5 w-3.5" />
            Natural default
          </Button>
          <Button type="button" size="sm" onClick={save} isLoading={isPending} disabled={!dirty}>
            <Save className="h-3.5 w-3.5" />
            Save design
          </Button>
        </div>
      </div>

      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {legacyTemplateCss && (
        <InlineNotice tone="neutral" title="Legacy template detected">
          This page still contains CSS copied by the old template gallery. Selecting any curated
          theme — including Default — removes that legacy template CSS. Hand-written Advanced CSS
          is never removed automatically.
        </InlineNotice>
      )}

      <section className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="border-b border-border px-4 py-3.5 sm:px-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Theme</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {selectedTheme.id === DEFAULT_STATUS_PAGE_THEME_ID
                ? 'Default uses the native Status Page renderer with zero built-in theme CSS.'
                : `${selectedTheme.name} · ${FAMILY_LABELS[selectedTheme.family]} · v${selectedTheme.version}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Theme family filter">
            {(Object.keys(FAMILY_LABELS) as Array<StatusPageThemeFamily | 'all'>).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setFamily(key)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  family === key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {FAMILY_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-4 sm:p-5">
          {visibleThemes.map(item => {
            const selected = item.id === themeId;
            const isDefault = item.id === DEFAULT_STATUS_PAGE_THEME_ID;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTheme(item.id)}
                aria-pressed={selected}
                className={cn(
                  'group overflow-hidden rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                  selected
                    ? 'border-primary ring-1 ring-primary/30 shadow-md'
                    : 'border-border hover:border-primary/45 hover:shadow-sm'
                )}
              >
                <div
                  className="h-32 p-3 relative overflow-hidden"
                  style={{ background: item.preview.surfaceAlt, color: item.preview.text }}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ background: isDefault ? 'transparent' : item.preview.accent }}
                  />
                  <div
                    className="h-full rounded-lg border p-2.5 flex flex-col gap-2"
                    style={{
                      background: item.preview.surface,
                      borderColor: `${item.preview.accent}2f`,
                      borderRadius: item.shape.radius,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="h-4 w-4 rounded-sm shrink-0"
                          style={{ background: item.preview.accent }}
                        />
                        <span className="h-1.5 w-20 rounded-full bg-current opacity-70" />
                      </div>
                      <span className="h-4 w-12 rounded-full border opacity-50" />
                    </div>
                    <div className="mt-1 h-5 w-3/5 rounded-md bg-current opacity-[0.08]" />
                    <div className="grid grid-cols-2 gap-1.5 flex-1">
                      <div className="rounded-md border p-2" style={{ borderColor: `${item.preview.accent}28` }}>
                        <span className="block h-1.5 w-10 rounded-full bg-current opacity-30" />
                        <span className="mt-2 block h-1.5 w-14 rounded-full" style={{ background: item.preview.accent }} />
                      </div>
                      <div className="rounded-md border p-2" style={{ borderColor: `${item.preview.accent}28` }}>
                        <span className="block h-1.5 w-12 rounded-full bg-current opacity-30" />
                        <span className="mt-2 block h-1.5 w-10 rounded-full bg-current opacity-15" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-3.5 bg-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{item.name}</span>
                        {isDefault && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                            Native
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    {selected && (
                      <span className="rounded-full bg-primary text-primary-foreground p-1 shrink-0">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="border-b border-border px-4 py-3.5 sm:px-5 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Code className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Advanced CSS</h2>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Applied after the selected theme. Intended for advanced branding requirements.
            </p>
          </div>
          {customCss && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setCustomCss('')}>
              Clear CSS
            </Button>
          )}
        </div>
        <div className="p-4 sm:p-5">
          <textarea
            value={customCss}
            onChange={event => setCustomCss(event.target.value)}
            rows={14}
            spellCheck={false}
            aria-label="Advanced CSS"
            placeholder="/* Optional advanced overrides */"
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs leading-6 text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <div className="mt-2 text-[11px] text-muted-foreground">
            Default theme injects no built-in theme rules. Use “Natural default” to remove both the
            selected theme and Advanced CSS in one action.
          </div>
        </div>
      </section>
    </div>
  );
}
