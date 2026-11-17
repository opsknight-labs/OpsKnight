import { redirect } from 'next/navigation';
import { getUserPermissions } from '@/lib/rbac';
import PolicyForm from '@/components/policies/PolicyForm';
import { ShieldAlert } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/patterns';
import { requirePageAccess } from '@/lib/access/server';

export const metadata = {
  title: 'Create Escalation Policy | OpsKnight',
};

export default async function CreatePolicyPage() {
  await requirePageAccess('/policies/create');
  const permissions = await getUserPermissions();

  if (!permissions.isAdmin) {
    redirect('/policies');
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            className="lg:hidden"
            items={[{ label: 'Escalation Policies', href: '/policies' }, { label: 'New policy' }]}
          />
        }
        title="New escalation policy"
        icon={ShieldAlert}
        description="Set up who gets paged, in what order, and how long to wait between steps."
      />

      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <PolicyForm />
      </div>
    </div>
  );
}
