'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import { errorFromResponse } from '@/lib/client-error';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Label } from '@/components/ui/shadcn/label';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  RotateCcw,
  Save,
  Mail,
  Rss,
  Link2,
  Webhook,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';

type Props = {
  appUrl: string | null;
  fallback: string;
};

export default function AppUrlSettings({ appUrl, fallback }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const initialValue = appUrl || '';
  const [value, setValue] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isDirty = value !== initialValue;

  const activeUrl = value.trim() || fallback;

  const isValidUrl = (input: string) => {
    try {
      const url = new URL(input);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const urlStatus = value.trim() ? (isValidUrl(value.trim()) ? 'valid' : 'invalid') : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      showToast('URL copied to clipboard', 'info');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy URL', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isValidUrl(value.trim())) {
      showToast('Please enter a valid HTTP or HTTPS URL', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/settings/app-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appUrl: value.trim() }),
      });
      if (!response.ok) {
        throw await errorFromResponse(response, 'Failed to update app URL');
      }
      showToast('Application URL updated successfully', 'success');
      setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      router.refresh();
    } catch (error) {
      showToast(error, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const usageTiles = [
    {
      icon: Mail,
      label: 'Email Alerts',
      sub: 'Action buttons & incident links in dispatch emails',
    },
    {
      icon: Webhook,
      label: 'Webhooks',
      sub: 'Payload entity URLs sent to downstream integrations',
    },
    { icon: Rss, label: 'RSS & Atom', sub: 'Incident feed items and status channel permalinks' },
    { icon: Link2, label: 'Public Status', sub: 'Status page backlink to the OpsKnight portal' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6 py-4">
      {/* ── Active Resolved URL Showcase Card ── */}
      <div className="rounded-xl border bg-muted/30 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active System Base URL
              </span>
              <Badge
                variant={value.trim() ? 'success' : 'neutral'}
                className="text-[10px] font-medium"
              >
                {value.trim() ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Custom Override
                  </>
                ) : (
                  'Auto Fallback'
                )}
              </Badge>
            </div>
            <p className="text-base sm:text-lg font-mono font-bold text-foreground truncate select-all">
              {activeUrl}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-8 text-xs gap-1.5"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </Button>
            <a
              href={activeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background h-8 px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground gap-1.5 transition-colors"
            >
              <span>Test Link</span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
          </div>
        </div>
      </div>

      {/* ── Custom URL Input Section ── */}
      <div className="space-y-3">
        <div className="space-y-0.5">
          <Label htmlFor="app-url" className="text-sm font-semibold">
            Configure Custom Base URL
          </Label>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Provide the canonical public address for this deployment. Leave blank to automatically
            rely on dynamic request host headers.
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="app-url"
              type="url"
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              placeholder={`e.g. ${fallback}`}
              className="pl-10 font-mono text-sm h-10 w-full"
            />
          </div>

          {/* Validation & fallback reset */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <div>
              {urlStatus === 'valid' && (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Valid absolute URL
                </span>
              )}
              {urlStatus === 'invalid' && (
                <span className="flex items-center gap-1.5 text-destructive font-medium">
                  <XCircle className="h-3.5 w-3.5" />
                  Must be an absolute URL starting with https:// or http://
                </span>
              )}
              {!urlStatus && (
                <span className="text-muted-foreground">
                  Default fallback: <code className="font-mono text-foreground/80">{fallback}</code>
                </span>
              )}
            </div>

            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setValue('')}
                className="h-6 text-xs text-muted-foreground hover:text-foreground px-2 gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                Clear & use fallback
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Used In Grid ── */}
      <div className="space-y-2.5 pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            System Propagation & Usage
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {usageTiles.map(({ icon: Icon, label, sub }) => (
            <div
              key={label}
              className="rounded-xl border bg-card p-3.5 flex flex-col justify-between gap-2 transition-colors hover:border-border"
            >
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-muted text-muted-foreground shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-semibold text-foreground">{label}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Action Footer ── */}
      <div className="flex items-center justify-between -mx-4 md:-mx-6 px-4 md:px-6 py-3.5 border-t bg-muted/30 mt-6">
        <div className="text-xs text-muted-foreground">
          {lastSaved ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved at {lastSaved}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {isDirty ? 'You have unsaved changes' : 'Instance URL is up to date'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue(initialValue)}
              disabled={isLoading}
              className="h-8 text-xs"
            >
              <RotateCcw className="mr-1.5 h-3 w-3" />
              Discard
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={isLoading || !isDirty || urlStatus === 'invalid'}
            className="h-8 text-xs"
          >
            {isLoading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save Configuration
          </Button>
        </div>
      </div>
    </form>
  );
}
