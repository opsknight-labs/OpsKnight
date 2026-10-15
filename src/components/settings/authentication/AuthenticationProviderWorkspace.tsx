'use client';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import AuthenticationProviderForm from './AuthenticationProviderForm';
import AuthenticationRevisionWorkflow from './AuthenticationRevisionWorkflow';
import { Globe } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { providerDefinitions } from '@/lib/auth-control/provider-definitions';

export default function AuthenticationProviderWorkspace() {
  const { sectionClass, data, revisionId, configuration } = useAuthenticationWorkspace();
  return (
    <section id="authentication-1" className={sectionClass} aria-labelledby="auth-connection-title">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Globe className="h-4 w-4" />
            </div>
            <h2
              id="auth-connection-title"
              className="text-base sm:text-lg font-bold text-foreground"
            >
              Identity Provider
            </h2>
            {data.activeProvider && (
              <Badge variant="success" className="text-xs">
                Active:{' '}
                {providerDefinitions[data.activeProvider.providerType]?.label ??
                  data.activeProvider.providerType}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Configure a candidate, verify administrator access, then review activation.
          </p>
        </div>
      </header>
      {data.providerCompatibilityWarning && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs sm:text-sm text-amber-800 dark:text-amber-200"
        >
          The stored historical configuration cannot be edited with this form. It remains active and
          unchanged. Choose a provider and stage a complete replacement for review.
        </div>
      )}
      <AuthenticationProviderForm key={`${revisionId}:${configuration.providerType}`} />
      <AuthenticationRevisionWorkflow />
    </section>
  );
}
