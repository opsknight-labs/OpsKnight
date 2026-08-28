'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import { errorFromResponse } from '@/lib/client-error';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, XCircle, Info, Loader2 } from 'lucide-react';

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
  const isDirty = value !== initialValue;

  const isValidUrl = (input: string) => {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  };

  const urlStatus = value ? (isValidUrl(value) ? 'valid' : 'invalid') : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch('/api/settings/app-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appUrl: value }),
      });

      if (!response.ok) {
        throw await errorFromResponse(response, 'Failed to update app URL');
      }

      showToast('Application URL updated successfully', 'success');
      setLastSaved(new Date().toLocaleString());
      router.refresh();
    } catch (error) {
      showToast(error, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="app-url" className="text-sm font-medium">
            Application URL
          </Label>
          <div className="space-y-3">
            <Input
              id="app-url"
              type="url"
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              placeholder={fallback}
              className="font-mono text-sm"
            />

            {urlStatus && (
              <div className="flex items-center gap-2 text-sm">
                {urlStatus === 'valid' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-green-600">URL looks valid</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span className="text-destructive">Enter a valid URL</span>
                  </>
                )}
              </div>
            )}

            {!value && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Using fallback: <code className="text-xs bg-muted px-1 py-0.5 rounded">{fallback}</code>
                </AlertDescription>
              </Alert>
            )}

            {value && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setValue('')}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear (use fallback)
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            The base URL used in emails, webhooks, and RSS feeds.
          </p>
        </div>

        <div className="border-t pt-4">
          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="text-sm font-semibold mb-3">Priority order</h4>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Database configuration (this setting)</li>
              <li>Environment variable (NEXT_PUBLIC_APP_URL)</li>
              <li>Fallback to localhost (development only)</li>
            </ol>
          </div>
        </div>

        {lastSaved && (
          <div className="flex items-center justify-between text-sm pt-4 border-t">
            <span className="text-muted-foreground">Last updated</span>
            <Badge variant="secondary">{lastSaved}</Badge>
          </div>
        )}
      </div>

      {isDirty && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            You have unsaved changes
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        {isDirty && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setValue(initialValue)}
            disabled={isLoading}
          >
            Reset
          </Button>
        )}
        <Button type="submit" disabled={isLoading || !isDirty}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save URL
        </Button>
      </div>
    </form>
  );
}
