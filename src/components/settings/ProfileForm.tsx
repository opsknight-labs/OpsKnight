'use client';

import { useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useForm, FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { FormField, FormItem, FormControl } from '@/components/ui/shadcn/form';
import { z } from 'zod';
import { updateProfile } from '@/app/(app)/settings/actions';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

type Props = {
  name: string;
  email: string | null;
  role: string;
  memberSince: string;
  department?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  lastOidcSync?: string | null;
  gender?: string | null;
};

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  gender: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function ProfileForm({
  name,
  email,
  role,
  memberSince,
  department,
  jobTitle,
  lastOidcSync,
  gender,
}: Props) {
  const router = useRouter();
  const { update } = useSession();

  const defaultValues: ProfileFormData = {
    name,
    gender: gender ?? undefined,
    department: department ?? undefined,
    jobTitle: jobTitle ?? undefined,
  };

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues,
    mode: 'onChange',
  });

  const watchedData = useWatch({
    control: form.control,
    defaultValue: defaultValues,
  }) as ProfileFormData;

  // Autosave handler for Personal Information
  const handleAutoSave = useCallback(
    async (data: ProfileFormData) => {
      if (!data.name || data.name.trim().length < 2) {
        return { success: false, error: 'Name must be at least 2 characters' };
      }

      const formData = new FormData();
      formData.append('name', data.name.trim());
      formData.append('gender', data.gender || '');
      if (data.department) formData.append('department', data.department.trim());
      if (data.jobTitle) formData.append('jobTitle', data.jobTitle.trim());

      const result = await updateProfile({ error: null, success: false }, formData);

      if (result.success) {
        await update({ force: true });
        router.refresh();
        return { success: true };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to auto-save profile',
        };
      }
    },
    [update, router]
  );

  const { status: saveStatus, error: saveError } = useAutosave({
    data: watchedData,
    onSave: handleAutoSave,
    delay: 600,
    enabled: form.formState.isValid && form.formState.isDirty,
  });

  return (
    <div className="space-y-6">
      {/* Card 1: Personal Information (Autosaved) */}
      <FormProvider {...form}>
        <form
          onSubmit={e => {
            e.preventDefault();
          }}
        >
          <SettingsSection
            title="Personal Information"
            description="Manage your personal details and organizational identity."
            action={<SaveIndicator status={saveStatus} error={saveError} />}
            footer={
              <p className="text-xs text-muted-foreground">
                Auto-saved · Changes apply immediately across the workspace
              </p>
            }
          >
            <div className="divide-y text-sm">
              <SettingsRow
                label="Full Name"
                description="Your display name across incidents, schedules, and dashboards"
                required
                htmlFor="name"
              >
                <Input
                  id="name"
                  {...form.register('name')}
                  placeholder="e.g. Dushyant Rahangdale"
                  className="w-full max-w-md"
                />
              </SettingsRow>

              <SettingsRow label="Gender" htmlFor="gender">
                <FormField
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <FormItem className="w-full max-w-md">
                      <Select
                        onValueChange={value => {
                          field.onChange(value);
                        }}
                        defaultValue={field.value || undefined}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger id="gender">
                            <SelectValue placeholder="Select gender..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="neutral">Prefer not to say</SelectItem>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="non-binary">Non-binary</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </SettingsRow>

              <SettingsRow
                label="Department"
                description="Your organizational unit or squad"
                htmlFor="department"
              >
                <Input
                  id="department"
                  {...form.register('department')}
                  placeholder="e.g. Infrastructure, Security, Platform"
                  className="w-full max-w-md"
                />
              </SettingsRow>

              <SettingsRow
                label="Job Title"
                description="Your operational role or position"
                htmlFor="jobTitle"
              >
                <Input
                  id="jobTitle"
                  {...form.register('jobTitle')}
                  placeholder="e.g. Lead Site Reliability Engineer"
                  className="w-full max-w-md"
                />
              </SettingsRow>
            </div>
          </SettingsSection>
        </form>
      </FormProvider>

      {/* Card 2: Account Details (Read-Only) */}
      <SettingsSection
        title="Account Details"
        description="Managed and provisioned by your workspace organization."
      >
        <div className="divide-y text-sm">
          <SettingsRow
            label="Email Address"
            description="Primary identifier used for account access and communications"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-foreground">
                {email || 'No email configured'}
              </span>
              <Badge variant="outline" size="xs" className="text-muted-foreground">
                Verified
              </Badge>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Workspace Role"
            description="Defines your access permissions across services and policies"
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-semibold uppercase tracking-wider text-xs">
                {role}
              </Badge>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Authentication Method"
            description="Identity provider used to secure and sign into your account"
          >
            <div className="flex items-center gap-2">
              {lastOidcSync ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 gap-1 text-xs"
                >
                  <RefreshCw className="h-3 w-3" /> SSO / OIDC Managed
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-xs">
                  Direct Password Account
                </Badge>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label="Member Since" description="Timestamp of initial account provisioning">
            <span className="text-sm text-muted-foreground">{memberSince}</span>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
