import Link from 'next/link';

export default function OidcTestResultPage() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Administrator sign-in test completed</h1>
      <p>
        Return to the authentication console to inspect the verified result or failure diagnostics.
        Your production provider and sign-in policy have not changed.
      </p>
      <p>
        <Link className="underline" href="/settings/system?section=sso">
          Return to SSO / Authentication
        </Link>
      </p>
      <p>
        <Link className="underline" href="/recovery">
          Return to emergency recovery
        </Link>
      </p>
    </main>
  );
}
