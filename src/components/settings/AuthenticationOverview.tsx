import type { authenticationDashboard } from '@/lib/auth-control/dashboard';

export default function AuthenticationOverview({
  data,
  className,
  providerLabel,
}: {
  data: Awaited<ReturnType<typeof authenticationDashboard>>;
  className: string;
  providerLabel: string;
}) {
  return (
    <section id="authentication-0" className={className} aria-labelledby="auth-overview-title">
      <h2 id="auth-overview-title" className="text-lg font-semibold">
        Overview
      </h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 [&>div]:rounded-xl [&>div]:border [&>div]:bg-muted/20 [&>div]:p-4 [&_dt]:text-xs [&_dd]:mt-2 [&_dd]:font-semibold">
        <div>
          <dt className="text-muted-foreground">Effective authentication mode</dt>
          <dd>{data.mode.replaceAll('_', ' ')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Production connection</dt>
          <dd>
            {data.activeProvider
              ? `${providerLabel} — configured`
              : data.providerCompatibilityWarning
                ? 'Existing configuration requires review'
                : 'Not configured'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Independent emergency recovery</dt>
          <dd>{data.verifiedEmergencyAccounts} identities with a current successful drill</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Active policy version</dt>
          <dd>{data.policyVersion}</dd>
        </div>
      </dl>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Select a provider and register both callback URLs.</li>
        <li>Stage credentials and validate discovery.</li>
        <li>
          Complete the real administrator sign-in test and verify the same account retains ADMIN.
        </li>
        <li>Enroll and test two separately held emergency identities.</li>
        <li>Preview session and linking impact, then activate with fresh authentication.</li>
      </ol>
      <p className="text-sm">
        Your original administrator is preserved. An emergency identity never becomes an incident
        responder or a SCIM user.
      </p>
    </section>
  );
}
