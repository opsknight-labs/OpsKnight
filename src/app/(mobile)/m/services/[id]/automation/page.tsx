import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { hasCapability } from '@/lib/authorization';
import AutomationShell from '@/components/automation/AutomationShell';
export const dynamic = 'force-dynamic';
export default async function MobileServiceAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
    <div className="responsive-page space-y-4 pb-12">
      <header className="space-y-2">
        <Link
          className="inline-flex min-h-11 items-center text-sm underline"
          href={`/m/services/${service.id}`}
        >
          ← Back to service
        </Link>
        <h1 className="text-lg font-semibold break-words">{service.name}</h1>
        <p className="text-sm text-muted-foreground">Automation workspace</p>
      </header>
      <AutomationShell serviceId={service.id} mobile />
    </div>
  );
}
