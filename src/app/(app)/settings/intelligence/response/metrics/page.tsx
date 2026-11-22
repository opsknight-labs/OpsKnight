import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import {
  MetricTemplateForm,
  MetricTemplateList,
} from '@/components/settings/MetricTemplateManager';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { KIND_CAPABILITIES } from '@/lib/intelligence/connectors/contract';
import { listObservabilityConnections } from '@/lib/intelligence/connectors/service';
import { listMetricTemplates } from '@/lib/intelligence/metric-anomaly/service';
import { requirePageAccess } from '@/lib/access/server';
import { LineChart } from 'lucide-react';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import IntelligenceSubNav from '@/components/settings/layout/IntelligenceSubNav';
import { LearnMore } from '@/components/settings/layout/LearnMore';
import EmptyState from '@/components/patterns/EmptyState';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function safely<T>(label: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    logger.warn(`[Intelligence] Metric template settings could not load ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export default async function MetricTemplatesPage() {
  await requirePageAccess('/settings/intelligence/response/metrics');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);

  const [templates, services, connections] = await Promise.all([
    safely('templates', () => listMetricTemplates()),
    safely('services', () =>
      prisma.service.findMany({
        orderBy: { name: 'asc' },
        take: 2000,
        select: { id: true, name: true },
      })
    ),
    safely('connections', () => listObservabilityConnections()),
  ]);
  const metricConnections = (connections ?? [])
    .filter(
      connection => connection.enabled && KIND_CAPABILITIES[connection.kind].includes('metrics')
    )
    .map(connection => ({ id: connection.id, name: connection.name }));

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        eyebrow="AIOps Intelligence"
        title="Metric anomaly evidence"
        description="Point a service at a metric it cares about; deviations become leads for probable causes."
        icon={LineChart}
        trail={[
          { label: 'Services & changes', href: '/settings/intelligence/services#metric-evidence' },
          { label: 'Metric anomaly evidence' },
        ]}
      />
      <IntelligenceSubNav />
      <LearnMore label="How this works">
        The intelligence lane compares the last window with the same time in previous weeks and
        records deviations as leads for probable-cause analysis and the incident timeline. Nothing
        pages, mutes or runs automatically, and nothing here touches alert ingestion.
      </LearnMore>

      <SettingsSection
        title="Templates"
        description="Each template is off until you enable it, and runs only through a connection the service's team may use."
      >
        {canManage && services && (
          <MetricTemplateForm services={services} connections={metricConnections} />
        )}
        {templates ? (
          <MetricTemplateList
            templates={templates}
            services={services ?? []}
            connections={metricConnections}
            canManage={canManage}
          />
        ) : (
          <EmptyState
            size="sm"
            variant="simple"
            title="Templates unavailable"
            description="They could not be loaded. Refresh to try again."
          />
        )}
      </SettingsSection>

      <SettingsSection
        title="How deviations are measured"
        description="Seasonal baseline with a robust spread, so last week's outage does not hide this week's."
      >
        <div className="space-y-2 py-3 text-sm text-muted-foreground">
          <p>
            Each sample is compared with the samples at the same time of week in the previous weeks.
            The baseline is their median; the spread is the median absolute deviation (MAD). A
            sample deviates by <em>k</em> MAD when it sits <em>k</em> robust standard deviations
            from the median. Two samples in a row past the threshold make one anomaly.
          </p>
          <p>
            Flat metrics get a small floor on the spread, and changes smaller than &quot;Ignore
            changes below&quot; never count. Weeks the connection could not answer are left out of
            the baseline.
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
