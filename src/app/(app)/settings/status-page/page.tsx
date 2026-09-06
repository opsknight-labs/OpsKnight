import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { notFound, redirect } from 'next/navigation';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import StatusPageConfig from '@/components/StatusPageConfig';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import Link from 'next/link';
import { StatusPageManager } from '@/components/status-page/StatusPageManager';

export default async function StatusPageSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }

  const { page: selectedPageId } = await searchParams;
  const availablePages = await prisma.statusPage.findMany({
    select: { id: true, name: true, slug: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  // Get the explicitly selected page, falling back deterministically to the default page.
  let statusPage = await prisma.statusPage.findFirst({
    where: selectedPageId ? { id: selectedPageId } : undefined,
    orderBy: selectedPageId
      ? undefined
      : [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
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

  if (selectedPageId && !statusPage) notFound();

  if (!statusPage) {
    // Create default status page
    statusPage = await prisma.statusPage.create({
      data: {
        name: 'Status Page',
        enabled: false,
        isDefault: true,
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
        title="Public Status Pages"
        description="Customize your public status page appearance, incident broadcast settings, and service status monitors."
        backHref="/settings"
        backLabel="Back to Settings"
      />
      {availablePages.length > 1 && (
        <nav aria-label="Status pages" className="flex flex-wrap gap-2">
          {availablePages.map(page => (
            <Link
              key={page.id}
              href={`/settings/status-page?page=${encodeURIComponent(page.id)}`}
              className={`rounded-md border px-3 py-2 text-sm ${page.id === statusPage.id ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-gray-200'}`}
            >
              {page.name}
              {page.isDefault ? ' (default)' : ''}
            </Link>
          ))}
        </nav>
      )}
      <StatusPageManager />
      <StatusPageConfig statusPage={formattedStatusPage} allServices={allServices} />
    </div>
  );
}
