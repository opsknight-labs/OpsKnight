import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { getUserPermissions } from '@/lib/rbac';
import {
  COMPLIANCE_FRAMEWORK_DEFINITIONS,
  getFrameworkSummaryView,
} from '@/lib/compliance/framework-mappings';
import { getComplianceControlCenterData } from '@/lib/compliance/control-center';
import { ComplianceControlCenter } from '@/components/settings/compliance/control-center';

const VALID_TABS = ['overview', 'controls', 'frameworks', 'evidence', 'operations'] as const;
type ValidTab = (typeof VALID_TABS)[number];

export default async function SecurityCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // Read-only readiness diagnostics — not certification or legal conclusions
  const permissions = await getUserPermissions();
  if (!permissions.capabilities.includes(CAPABILITIES.COMPLIANCE_READ)) {
    redirect('/settings');
  }

  const params = await searchParams;
  const initialTab: ValidTab = VALID_TABS.includes(params.tab as ValidTab)
    ? (params.tab as ValidTab)
    : 'overview';

  const now = new Date();

  const [controlCenterData] = await Promise.all([getComplianceControlCenterData({ prisma, now })]);

  const frameworkList = COMPLIANCE_FRAMEWORK_DEFINITIONS.map(fw => {
    const summary = getFrameworkSummaryView(fw.id, now);
    return {
      id: fw.id,
      title: fw.title,
      scope: fw.jurisdiction ?? 'Universal',
      source: fw.sourceUrl,
      version: fw.version,
      summaryView: summary
        ? {
            mappedRequirementsCount: summary.mappedRequirementsCount,
            mappedControlsCount: summary.mappedControlsCount,
            runtimeBackedCount: summary.runtimeBackedCount,
            repositoryBackedCount: summary.repositoryBackedCount,
            operatorDependencyCount: summary.operatorDependencyCount,
            organizationalDependencyCount: summary.organizationalDependencyCount,
            futureRequirementsCount: summary.futureRequirementsCount,
          }
        : undefined,
    };
  });

  const capabilities = {
    canEvaluate: permissions.capabilities.includes(CAPABILITIES.COMPLIANCE_EVALUATE),
    canReadEvidence: permissions.capabilities.includes(CAPABILITIES.COMPLIANCE_EVIDENCE_READ),
    canReadEncryption: permissions.capabilities.includes(CAPABILITIES.ENCRYPTION_READ),
    canManageEncryption: permissions.capabilities.includes(CAPABILITIES.ENCRYPTION_MANAGE),
    canReadPrivacy: permissions.capabilities.includes(CAPABILITIES.PRIVACY_READ),
    canReadRetention: permissions.capabilities.includes(CAPABILITIES.RETENTION_READ),
  };

  return (
    <ComplianceControlCenter
      initialData={controlCenterData}
      frameworks={frameworkList}
      capabilities={capabilities}
      initialTab={initialTab}
    />
  );
}
