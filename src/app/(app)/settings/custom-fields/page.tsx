import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { assertAdmin } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import CustomFieldsConfig, { type CustomField } from '@/components/CustomFieldsConfig';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Badge } from '@/components/ui/shadcn/badge';
import { SlidersHorizontal, Asterisk, Columns, Database } from 'lucide-react';

export default async function CustomFieldsPage() {
  const session = await getServerSession(await getAuthOptions());
  if (!session) {
    redirect('/login');
  }

  try {
    await assertAdmin();
  } catch {
    redirect('/');
  }

  const customFields = await prisma.customField.findMany({
    orderBy: { order: 'asc' },
    include: {
      _count: {
        select: {
          values: true,
        },
      },
    },
  });

  const serializedCustomFields: CustomField[] = customFields.map(field => ({
    id: field.id,
    name: field.name,
    key: field.key,
    type: field.type as CustomField['type'],
    required: field.required,
    defaultValue: field.defaultValue,
    options:
      Array.isArray(field.options) && field.options.every(value => typeof value === 'string')
        ? (field.options as string[])
        : null,
    order: field.order,
    showInList: field.showInList,
    _count: {
      values: field._count.values,
    },
  }));

  // Aggregated Stats
  const totalFields = serializedCustomFields.length;
  const requiredCount = serializedCustomFields.filter(f => f.required).length;
  const tableColumnsCount = serializedCustomFields.filter(f => f.showInList).length;
  const totalDataPoints = serializedCustomFields.reduce((acc, f) => acc + f._count.values, 0);

  return (
    <div className="space-y-6">
      {/* Centralized Glassmorphic Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Custom Fields',
        }}
        tag="Incident Metadata & Taxonomy"
        title="Custom Fields"
        subtitle="Define structured metadata attributes, validation rules, and incident table columns."
        icon={
          <div className="p-3.5 rounded-2xl bg-primary-foreground/15 text-primary-foreground border border-primary-foreground/25 shadow-inner">
            <SlidersHorizontal className="h-8 w-8" />
          </div>
        }
        badges={
          <>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-[10px] font-bold uppercase tracking-wider"
            >
              Enterprise Metadata
            </Badge>
            <Badge
              variant="outline"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 text-xs"
            >
              {totalFields} {totalFields === 1 ? 'Field' : 'Fields'} Defined
            </Badge>
          </>
        }
        stats={[
          {
            label: 'Total Fields',
            value: `${totalFields}`,
            icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
            subtext: 'Active metadata schema',
          },
          {
            label: 'Required',
            value: `${requiredCount}`,
            icon: <Asterisk className="h-3.5 w-3.5" />,
            subtext: 'Enforced on creation',
          },
          {
            label: 'Table Columns',
            value: `${tableColumnsCount}`,
            icon: <Columns className="h-3.5 w-3.5" />,
            subtext: 'Visible in incident list',
          },
          {
            label: 'Data Points',
            value: `${totalDataPoints}`,
            icon: <Database className="h-3.5 w-3.5" />,
            subtext: 'Recorded in incidents',
          },
        ]}
      />

      {/* Main Settings Section */}
      <SettingsSection
        title="Incident Schema & Metadata"
        description="Configure field properties, validation constraints, and visibility across incident views."
        footer={
          <p className="text-xs text-muted-foreground">
            Custom fields are automatically exposed in the REST API, outgoing webhooks, and incident
            export datasets.
          </p>
        }
      >
        <CustomFieldsConfig customFields={serializedCustomFields} />
      </SettingsSection>
    </div>
  );
}
