import { redirect } from 'next/navigation';
import { getUserPermissions } from '@/lib/rbac';
import PolicyForm from '@/components/policies/PolicyForm';
import { Button } from '@/components/ui/shadcn/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export const metadata = {
  title: 'Create Escalation Policy | OpsKnight',
};

export default async function CreatePolicyPage() {
  const permissions = await getUserPermissions();

  if (!permissions.isAdmin) {
    redirect('/policies');
  }

  return (
    <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-8 space-y-4 sm:space-y-6">
      <div>
        <Link href="/policies">
          <Button
            variant="ghost"
            size="sm"
            className="pl-0 text-slate-500 mb-4 hover:text-slate-900"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Policies
          </Button>
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight tracking-tight text-slate-900">
          Create Escalation Policy
        </h1>
        <p className="text-slate-500 mt-1">Set up a new policy to manage incident notifications.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <PolicyForm />
      </div>
    </div>
  );
}
