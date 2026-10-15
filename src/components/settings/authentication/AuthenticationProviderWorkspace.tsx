'use client';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import AuthenticationProviderForm from './AuthenticationProviderForm';
import AuthenticationRevisionWorkflow from './AuthenticationRevisionWorkflow';

export default function AuthenticationProviderWorkspace() {
  const { sectionClass, data, revisionId, configuration } = useAuthenticationWorkspace();
  return (
    <section id="authentication-1" className={sectionClass} aria-labelledby="auth-connection-title">
      <header>
        <h2 id="auth-connection-title" className="text-lg font-semibold">
          Identity Provider
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure a candidate, verify administrator access, then review activation.
        </p>
      </header>
      {data.providerCompatibilityWarning && (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
          The stored historical configuration cannot be edited with this form. It remains active and
          unchanged. Choose a provider and stage a complete replacement for review.
        </p>
      )}
      <AuthenticationProviderForm key={`${revisionId}:${configuration.providerType}`} />
      <AuthenticationRevisionWorkflow />
    </section>
  );
}
