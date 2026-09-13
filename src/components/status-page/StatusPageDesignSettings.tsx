'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Code, RotateCcw, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { PublicStatusPageSnapshot } from '@/lib/status-pages/public-contract';
import StatusPageThemePreview from './StatusPageThemePreview';
import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_VERSION,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
  type StatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';

type BrandingRecord = Record<string, unknown>;

interface StatusPageDesignSettingsProps {
  statusPage: {
    id: string;
    name: string;
    updatedAt?: Date | string;
    branding?: unknown;
  };
  liveSnapshot?: PublicStatusPageSnapshot | null;
}

interface SavedDesignState {
  themeId: string;
  density: StatusPageThemeDensity;
  customCss: string;
}

function asBranding(value: unknown): BrandingRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as BrandingRecord)
    : {};
}

export default function StatusPageDesignSettings({
  statusPage,
  liveSnapshot,
}: StatusPageDesignSettingsProps) {
  const router = useRouter();
  const initialBranding = useMemo(() => asBranding(statusPage.branding), [statusPage.branding]);
  const initialTheme = resolveStatusPageTheme(initialBranding.themeId);
  const initialDensity = resolveStatusPageThemeDensity(initialBranding.themeDensity);
  const initialCustomCss =
    typeof initialBranding.customCss === 'string' ? initialBranding.customCss : '';

  const [themeId, setThemeId] = useState(initialTheme.id);
  const [density, setDensity] = useState<StatusPageThemeDensity>(initialDensity);
  const [customCss, setCustomCss] = useState(initialCustomCss);
  const [savedDesign, setSavedDesign] = useState<SavedDesignState>(() => ({
    themeId: initialTheme.id,
    density: initialDensity,
    customCss: initialCustomCss,
  }));
  const [revision, setRevision] = useState(() =>
    statusPage.updatedAt ? new Date(statusPage.updatedAt).toISOString() : undefined
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedTheme = resolveStatusPageTheme(themeId);
  const legacyTemplateCss = isLegacyStatusPageTemplateCss(customCss);
  const dirty =
    themeId !== savedDesign.themeId ||
    density !== savedDesign.density ||
    customCss !== savedDesign.customCss;

  const selectTheme = (nextThemeId: string) => {
    setThemeId(nextThemeId);
    // Positively identified old gallery payloads are stale once a curated theme is selected.
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
          throw new Error(payload?.error || 'Failed to save status page appearance');
        }

        const nextRevision = payload?.data?.updatedAt;
        if (typeof nextRevision === 'string') setRevision(nextRevision);
        setSavedDesign({ themeId, density, customCss });

        const publicationStatus = payload?.data?.publication?.status;
        const notificationId = `status-page:${statusPage.id}:appearance:save`;
        if (publicationStatus === 'LIVE') {
          notify.success('Status page appearance saved and published.', { id: notificationId });
        } else if (publicationStatus === 'PUBLISHING') {
          notify.info('Appearance saved. Publishing to the public page…', { id: notificationId });
        } else if (publicationStatus === 'FAILED') {
          notify.warning('Appearance saved, but publishing failed.', { id: notificationId });
        } else {
          notify.success('Status page appearance saved.', { id: notificationId });
        }

        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to save status page appearance');
      }
    });
  };

  return (
    <section className="border-b border-border bg-muted/10 px-3 py-4 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Appearance
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Themes now live inside Status Page Settings and render against the real V3 status page
              before you save. The preview uses the same shared stylesheet and theme compiler as the
              published page.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={resetAllDesignOverrides}>
              <RotateCcw className="h-3.5 w-3.5" />
              Natural default
            </Button>
            <Button type="button" size="sm" onClick={save} isLoading={isPending} disabled={!dirty}>
              <Save className="h-3.5 w-3.5" />
              Save appearance
            </Button>
          </div>
        </div>

        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        {legacyTemplateCss && (
          <InlineNotice tone="neutral" title="Legacy template CSS detected">
            Selecting a curated theme removes the old gallery payload so it cannot compete with the
            new theme system.
          </InlineNotice>
        )}
        {selectedTheme.mode === 'dark' && selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID && (
          <InlineNotice tone="warning" title="PR #650 diagnostic mode">
            Advanced CSS is temporarily disabled for curated dark themes on this branch. This is an
            isolation test for the persistent white service-card issue. Do not merge the diagnostic
            behavior until local testing confirms whether the card still turns white.
          </InlineNotice>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(360px,500px)_minmax(0,1fr)] xl:items-start">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">Theme</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {selectedTheme.name} · {selectedTheme.mode} · v{selectedTheme.version}
                </p>
              </div>
              <div className="grid max-h-[420px] grid-cols-1 gap-2 overflow-auto p-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {STATUS_PAGE_THEMES.map(item => {
                  const selected = item.id === themeId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectTheme(item.id)}
                      aria-pressed={selected}
                      className={cn(
                        'rounded-lg border p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                        selected
                          ? 'border-primary ring-1 ring-primary/30 shadow-sm'
                          : 'border-border hover:border-primary/45 hover:bg-muted/20'
                      )}
                    >
                      <div
                        className="mb-2 h-12 overflow-hidden rounded-md border p-2"
                        style={{
                          background: item.preview.surfaceAlt,
                          borderColor: `${item.preview.accent}45`,
                          color: item.preview.text,
                        }}
                      >
                        <div
                          className="h-full rounded border px-2 py-1"
                          style={{
                            background: item.preview.surface,
                            borderColor: `${item.preview.accent}38`,
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="h-1.5 w-16 rounded bg-current opacity-50" />
                            <span
                              className="h-2.5 w-8 rounded-full"
                              style={{ background: item.preview.accent }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-foreground">
                            {item.name}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                            {item.description}
                          </div>
                        </div>
                        {selected && (
                          <span className="shrink-0 rounded-full bg-primary p-1 text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="text-sm font-semibold text-foreground">Density</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(['comfortable', 'compact'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDensity(value)}
                    aria-pressed={density === value}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors',
                      density === value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Code className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">Advanced CSS</h2>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Final override layer. Temporarily ignored for dark themes during diagnosis.
                  </p>
                </div>
                {customCss && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setCustomCss('')}>
                    Clear
                  </Button>
                )}
              </div>
              <div className="p-3">
                <textarea
                  value={customCss}
                  onChange={event => setCustomCss(event.target.value)}
                  rows={10}
                  spellCheck={false}
                  aria-label="Advanced CSS"
                  placeholder="/* Optional advanced overrides */"
                  className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
            </div>
          </div>

          <div className="xl:sticky xl:top-4">
            <StatusPageThemePreview
              snapshot={liveSnapshot}
              themeId={themeId}
              density={density}
              customCss={customCss}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
