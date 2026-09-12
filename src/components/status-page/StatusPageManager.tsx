'use client';

import React, { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';

export function StatusPageManager() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  function handleNameChange(val: string) {
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      );
    }
  }

  async function createPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/settings/status-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() }),
      });
      const payload = (await response.json()) as {
        data?: { page?: { id: string } };
        error?: string;
      };
      const page = payload.data?.page;
      if (!response.ok || !page) throw new Error(payload.error || 'Unable to create status page.');
      setOpen(false);
      router.push(`/settings/status-pages/${encodeURIComponent(page.id)}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create status page.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          setName('');
          setSlug('');
          setError(null);
          setOpen(true);
        }}
        className="gap-2 shadow-xs"
      >
        <Plus className="h-4 w-4" />
        <span>Create status page</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1 text-primary">
              <div className="p-2 rounded-lg bg-primary/10">
                <Globe className="h-5 w-5" />
              </div>
              <DialogTitle className="text-lg font-bold">Create Status Page</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Deploy an independent public communication surface with its own services, custom
              domains, and subscriber channels.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={createPage} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name" className="text-xs font-semibold">
                Status Page Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sp-name"
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Acme Production Status"
                required
                maxLength={200}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sp-slug" className="text-xs font-semibold">
                URL Slug <span className="text-destructive">*</span>
              </Label>
              <div className="flex rounded-md shadow-xs">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-xs font-mono">
                  /status/
                </span>
                <Input
                  id="sp-slug"
                  value={slug}
                  onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="production"
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  maxLength={80}
                  className="rounded-l-none h-9 font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Only lowercase letters, numbers, and hyphens.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/60 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Draft Status</p>
              <p>
                Your page will be created in disabled/draft mode so you can configure branding, map
                services, and review privacy options before publishing.
              </p>
            </div>

            {error && (
              <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                {error}
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || !name.trim() || !slug.trim()}>
                {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                <span>{pending ? 'Creating…' : 'Create Status Page'}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
