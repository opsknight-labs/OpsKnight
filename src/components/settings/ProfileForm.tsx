'use client';

import { useCallback, useRef, useTransition, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useForm, FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { AvatarPicker } from '@/components/settings/AvatarPicker';
import { useAvatarUpdater } from '@/hooks/useUserAvatar';
import { isDefaultAvatar } from '@/lib/avatar';
import { z } from 'zod';
import { updateProfile } from '@/app/(app)/settings/actions';
import { useRouter } from 'next/navigation';
import { notify as toast } from '@/lib/toast';
import { Upload, RotateCcw, Loader2 } from 'lucide-react';

type Props = {
  name: string;
  email: string | null;
  role: string;
  memberSince: string;
  department?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  lastOidcSync?: string | null;
};

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
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
  avatarUrl,
  lastOidcSync,
}: Props) {
  const router = useRouter();
  const { update } = useSession();
  const { updateCurrentUser } = useAvatarUpdater();
  const [isUploading, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null | undefined>(avatarUrl);

  const defaultValues: ProfileFormData = {
    name,
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

  const handleAvatarSelect = async (selectedAvatarUrl: string) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append('avatarUrl', selectedAvatarUrl);

      const result = await updateProfile({ error: null, success: false }, formData);

      if (result.success) {
        toast.success('Avatar updated');
        setCurrentAvatarUrl(selectedAvatarUrl);
        updateCurrentUser(selectedAvatarUrl);
        await update({ force: true });
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to update avatar');
      }
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('File size exceeds 2MB limit');
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Please upload a valid image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = async event => {
      const previewUrl = event.target?.result as string;
      setCurrentAvatarUrl(previewUrl);

      startTransition(async () => {
        const formData = new FormData();
        formData.append('file', file);

        const result = await updateProfile({ error: null, success: false }, formData);

        if (result.success) {
          toast.success('Profile photo updated');
          updateCurrentUser(previewUrl);
          await update({ force: true });
          router.refresh();
        } else {
          toast.error(result.error || 'Failed to upload photo');
          setCurrentAvatarUrl(avatarUrl);
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const handleResetToDefault = async () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append('resetAvatar', 'true');

      const result = await updateProfile({ error: null, success: false }, formData);

      if (result.success) {
        toast.success('Avatar reset to default initials');
        setCurrentAvatarUrl(null);
        updateCurrentUser(null);
        await update({ force: true });
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to reset avatar');
      }
    });
  };

  const hasCustomAvatar = currentAvatarUrl && !isDefaultAvatar(currentAvatarUrl);

  const getRoleBadgeVariant = (roleName: string) => {
    switch (roleName) {
      case 'ADMIN':
        return 'destructive';
      case 'RESPONDER':
        return 'default';
      case 'VIEWER':
        return 'secondary';
      default:
        return 'outline';
    }
  };

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
              {/* Profile Photo Row */}
              <SettingsRow
                label="Profile Photo"
                description="Choose a preset avatar style or upload a custom image (max 2MB)"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AvatarPicker
                    currentAvatarUrl={currentAvatarUrl}
                    onSelect={handleAvatarSelect}
                    userName={name}
                  />

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="gap-1.5 h-8 text-xs font-medium"
                  >
                    {isUploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload Photo
                  </Button>

                  {hasCustomAvatar && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleResetToDefault}
                      disabled={isUploading}
                      className="gap-1.5 h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Default
                    </Button>
                  )}

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    className="hidden"
                    disabled={isUploading}
                  />
                </div>
              </SettingsRow>

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
        description="Core security and authentication parameters managed by your workspace."
      >
        <div className="divide-y text-sm">
          <SettingsRow
            label="Email Address"
            description="Used for critical incident communications and access"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs bg-muted px-2.5 py-1 rounded-md border border-border">
                {email || 'No email attached'}
              </span>
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Verified
              </Badge>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Workspace Role"
            description="Your access level and permissions across the platform"
          >
            <div className="flex items-center gap-2">
              <Badge variant={getRoleBadgeVariant(role)} className="font-medium text-xs">
                {role}
              </Badge>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Authentication"
            description="Identity provider and session management"
          >
            {lastOidcSync ? (
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs bg-primary/5 text-primary border-primary/20"
                >
                  SSO Linked
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Synced {new Date(lastOidcSync).toLocaleDateString()}
                </span>
              </div>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Direct Account
              </Badge>
            )}
          </SettingsRow>

          <SettingsRow label="Member Since" description="Account provisioning timestamp">
            <span className="text-sm text-muted-foreground font-mono">
              {new Date(memberSince).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
