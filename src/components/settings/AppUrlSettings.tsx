'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import { errorFromResponse } from '@/lib/client-error';
import { SETTINGS_CHANGED_MESSAGE } from '@/lib/settings-result';
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
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

type Props = {
  appUrl: string | null;
  fallback: string;
  updatedAt: string | null;
};

export default function AppUrlSettings({ appUrl, fallback, updatedAt }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const initialValue = appUrl || '';
  const [value, setValue] = useState(initialValue);
  const [savedValue, setSavedValue] = useState(initialValue);
  const [revision, setRevision] = useState<string | null>(updatedAt);
  const [conflict, setConflict] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isDirty = value !== savedValue;

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

  const handleTestLink = () => {
    try {
      const candidate = (value.trim() || fallback).trim();
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        window.open(parsed.href, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch {
      // Invalid URL
    }
    showToast('Please configure a valid HTTP or HTTPS URL to test', 'error');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isValidUrl(value.trim())) {
      showToast('Please enter a valid HTTP or HTTPS URL', 'error');
      return;
    }

    setIsLoading(true);
    setConflict(null);
    try {
      const response = await fetch('/api/settings/app-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appUrl: value.trim(), expectedUpdatedAt: revision }),
      });
      if (response.status === 409) {
        setConflict(SETTINGS_CHANGED_MESSAGE);
        return;
      }
      if (!response.ok) {
        throw await errorFromResponse(response, 'Failed to update app URL');
      }

      const data = await response.json();
      const nextValue = typeof data.appUrl === 'string' ? data.appUrl : '';
      const nextRevision = typeof data.updatedAt === 'string' ? data.updatedAt : revision;
      setValue(nextValue);
      setSavedValue(nextValue);
      setRevision(nextRevision);
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
      {conflict && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100 flex items-start justify-between gap-4">
          <div className="flex gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Settings changed elsewhere</p>
              <p>{conflict}</p>
              <p className="text-xs mt-1 opacity-80">Your local URL edit has not been overwritten.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()} className="shrink-0 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />Reload latest
          </Button>
        </div>
      )}

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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestLink}
              disabled={urlStatus === 'invalid'}
              className="h-8 text-xs gap-1.5"
              title={
                urlStatus === 'invalid' ? 'Enter a valid URL to test' : 'Open active URL in new tab'
              }
            >
              <span>Test Link</span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-0.5">
          <Label htmlFor="app-url" className="text-sm font-semibold">
            Configure Custom Base URL
          </Label>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Provide the canonical public address for this deployment. Leave blank to use
            NEXT_PUBLIC_APP_URL, then NEXTAUTH_URL, then http://localhost:3000.
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="app-url"
              type="url"
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setValue(e.target.value);
                setConflict(null);
              }}
              placeholder={`e.g. ${fallback}`}
              className="pl-10 font-mono text-sm h-10 w-full"
            />
          </div>

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
              onClick={() => {
                setValue(savedValue);
                setConflict(null);
              }}
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
