import { getServerSession } from 'next-auth'
import { getAuthOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { assertAdmin } from '@/lib/rbac'
import prisma from '@/lib/prisma'
import CustomFieldsConfig from '@/components/CustomFieldsConfig'
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader'
import { SettingsSection } from '@/components/settings/layout/SettingsSection'

export default async function CustomFieldsPage() {
  const session = await getServerSession(await getAuthOptions())
  if (!session) {
    redirect('/login')
  }

  try {
    await assertAdmin()
  } catch {
    redirect('/')
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
  })
  const serializedCustomFields = customFields.map(field => ({
    ...field,
    options:
      Array.isArray(field.options) && field.options.every(value => typeof value === 'string')
        ? field.options
        : null,
  }))

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Custom Fields"
        description="Define custom fields to capture additional incident information."
        backHref="/settings"
        backLabel="Back to Settings"
      />

      <SettingsSection
        title="Custom Field Builder"
        description="Create, edit, and manage structured incident metadata"
      >
        <CustomFieldsConfig customFields={serializedCustomFields} />
      </SettingsSection>
    </div>
  )
}
