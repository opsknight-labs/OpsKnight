import { MetadataRoute } from 'next';
import prisma from '@/lib/prisma';
import { getAppUrl } from '@/lib/app-config';
import { logger } from '@/lib/logger';

// Generate sitemap dynamically at runtime
export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable caching

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await getAppUrl();
  const routes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
  ];

  // Add status page if enabled
  try {
    const statusPage = await prisma.statusPage.findFirst({
      where: { enabled: true },
    });

    if (statusPage) {
      routes.push({
        url: `${baseUrl}/status`,
        lastModified: statusPage.updatedAt,
        changeFrequency: 'hourly',
        priority: 0.8,
      });
    }
  } catch (error) {
    // If database is not available, skip status page
    logger.error('Error fetching status page for sitemap', { component: 'sitemap', error });
  }

  return routes;
}
