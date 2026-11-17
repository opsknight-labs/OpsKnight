import { notFound, redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { hasCapability } from '@/lib/authorization';
import AutomationShell from '@/components/automation/AutomationShell';
import { Workflow } from 'lucide-react';
import { MobileDetailHeader, MobileIconTile } from '@/components/mobile/MobileList';
import { requirePageAccess } from '@/lib/access/server';
export const dynamic = 'force-dynamic';
export default async function MobileServiceAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageAccess('/m/services/[id]/automation');
  const { id } = await params;
  const context = await getRequestActorContext();
  if (!context)
    redirect(`/m/login?callbackUrl=${encodeURIComponent(`/m/services/${id}/automation`)}`);
  if (!hasCapability(context.actor.role, 'automation.read')) notFound();
  const service = await prisma.service.findFirst({
    where: { AND: [serviceReadWhere(context.actor), { id }] },
    select: { id: true, name: true },
  });
  if (!service) notFound();
  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={<MobileIconTile icon={Workflow} size="lg" />}
        title={service.name}
        description="Automation workspace"
      />
      <AutomationShell serviceId={service.id} mobile />
    </div>
  );
}
