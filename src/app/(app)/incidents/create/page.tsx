import { redirect } from 'next/navigation';
import { getUserPermissions } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function CreateIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; serviceId?: string }>;
}) {
  await getUserPermissions();

  const params = await searchParams;
  const targetParams = new URLSearchParams();
  if (params.template) targetParams.set('template', params.template);
  if (params.serviceId) targetParams.set('serviceId', params.serviceId);

  const queryString = targetParams.toString();
  redirect(queryString ? `/incidents?${queryString}` : '/incidents');
}
