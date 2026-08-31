import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import StatusPageConfig from '@/components/StatusPageConfig';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';

export default async function StatusPageSettingsPage() {
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }

  // Get or create status page
  let statusPage = await prisma.statusPage.findFirst({
    include: {
      services: {
        include: {
          service: true,
        },
      },
      announcements: {
        orderBy: { startDate: 'desc' },
        take: 20,
      },
    },
  });

  if (!statusPage) {
    // Create default status page
    statusPage = await prisma.statusPage.create({
      data: {
        name: 'Status Page',
        enabled: false,
      },
      include: {
        services: {
          include: {
            service: true,
          },
        },
        announcements: {
          orderBy: { startDate: 'desc' },
          take: 20,
        },
      },
    });
  }

  // Get all services
  const allServices = await prisma.service.findMany({
    orderBy: { name: 'asc' },
  });

  const formattedStatusPage: any = {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    ...statusPage,
    announcements: statusPage.announcements.map(announcement => ({
      ...announcement,
      startDate: announcement.startDate.toISOString(),
      endDate: announcement.endDate ? announcement.endDate.toISOString() : null,
      affectedServiceIds: Array.isArray(announcement.affectedServiceIds)
        ? (announcement.affectedServiceIds as string[])
        : null,
    })),
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Public Status Page"
        description="Customize your public status page appearance, incident broadcast settings, and service status monitors."
        backHref="/settings"
        backLabel="Back to Settings"
      />
      <StatusPageConfig statusPage={formattedStatusPage} allServices={allServices} />
    </div>
  );
}
