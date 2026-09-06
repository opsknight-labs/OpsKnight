import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import StatusPageConfig from '@/components/StatusPageConfig';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { StatusPage } from '@prisma/client';
import { Prisma } from '@prisma/client';

type StatusPageWithRelations = Prisma.StatusPageGetPayload<{
  include: {
    services: {
      include: { service: true };
    };
    announcements: {
      orderBy: { startDate: 'desc' };
      take: 20;
    };
  };
}>;

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

  const resolvedSearchParams = await searchParams;
  const selectedPageId = resolvedSearchParams.page;

  // Get all status pages for the selector
  const allStatusPages = (await prisma.statusPage.findMany({
    orderBy: { createdAt: 'asc' },
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
  })) as StatusPageWithRelations[];

  // If no status pages exist, create a default one
  if (allStatusPages.length === 0) {
    const defaultPage = await prisma.statusPage.create({
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
    allStatusPages.push(defaultPage);
  }

  // Determine which page to show
  let statusPage = allStatusPages[0]; // default to first
  if (selectedPageId) {
    const found = allStatusPages.find(p => p.id === selectedPageId);
    if (found) {
      statusPage = found;
    }
  } else if (allStatusPages.some(p => (p as any).isDefault)) {
    // If no page selected, prefer the default page
    statusPage = allStatusPages.find(p => (p as any).isDefault) || allStatusPages[0];
  }

  // Get all services
  const allServices = await prisma.service.findMany({
    orderBy: { name: 'asc' },
  });

  const formattedStatusPage: any = {
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

  const publicUrl = `/status${(statusPage as any).slug ? `/${(statusPage as any).slug}` : ''}`;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Public Status Page"
        description="Customize your public status page appearance, incident broadcast settings, and service status monitors."
        backHref="/settings"
        backLabel="Back to Settings"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            {/* Page Selector - Native Select */}
            <div className="flex items-center gap-2">
              <label htmlFor="status-page-selector" className="text-sm font-medium text-gray-700">
                Status Page:
              </label>
              <select
                id="status-page-selector"
                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                onChange={e => {
                  const pageId = e.currentTarget.value;
                  if (pageId === 'new') {
                    window.location.href = '/settings/status-page/new';
                  } else {
                    window.location.href = `/settings/status-page?page=${pageId}`;
                  }
                }}
                defaultValue={statusPage.id}
              >
                {allStatusPages.map(page => (
                  <option key={page.id} value={page.id}>
                    {page.name} {(page as any).isDefault ? '(Default)' : ''}
                  </option>
                ))}
                <option value="new">+ Create new status page...</option>
              </select>
            </div>
            <Link
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700"
            >
              View Public Page
            </Link>
          </div>
        }
      />
      <StatusPageConfig
        key={statusPage.id}
        statusPage={formattedStatusPage}
        allServices={allServices}
      />
    </div>
  );
}
