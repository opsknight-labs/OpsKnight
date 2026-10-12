import EmergencyLogin from '@/components/auth/EmergencyLogin';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export default async function EmergencyLoginPage() {
  const policy = await getAuthenticationPolicy();
  return (
    <main className="mx-auto max-w-lg space-y-6 p-6 sm:py-12">
      <h1 className="text-2xl font-semibold">Emergency Access</h1>
      <p>
        Use an enrolled independent identity to repair authentication. Emergency identities have
        access only to the recovery console.
      </p>
      <p className="text-sm text-muted-foreground">
        No Remember Me or trusted-device extension. Sessions expire after one hour or 15 minutes
        without deliberate interaction. Every sign-in attempt is audited and alerts administrators.
      </p>
      <EmergencyLogin legacyAvailable={Boolean(policy.legacyEmergencyEmail)} />
      <Link className="text-sm underline" href="/login">
        Return to normal sign-in
      </Link>
      <p>
        <a className="text-sm underline" href="https://opsknight.com/">
          OpsKnight
        </a>
      </p>
    </main>
  );
}
