'use client';

import { useState, useRef, useTransition, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
import { SaveIndicator } from '@/components/settings/feedback/SaveIndicator';
import { useAutosave } from '@/lib/hooks/use-autosave';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { FormField, FormItem, FormControl } from '@/components/ui/shadcn/form';
import { Camera, Upload, Loader2, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { updateProfile } from '@/app/(app)/settings/actions';
import { useRouter } from 'next/navigation';
import { notify as toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { AvatarPicker } from '@/components/settings/AvatarPicker';
import { getDefaultAvatar, isDefaultAvatar } from '@/lib/avatar';
import { useAvatarUpdater } from '@/hooks/useUserAvatar';

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
  avatarUrl,
  lastOidcSync,
  gender,
}: Props) {
  const router = useRouter();
  const { update } = useSession();
  const { updateCurrentUser } = useAvatarUpdater();
  const [isUploading, startTransition] = useTransition();
  const [currentGender, setCurrentGender] = useState<string | null | undefined>(gender);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    avatarUrl || getDefaultAvatar(gender, name)
  );

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

  const watchedData = form.watch();

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

  const handleAvatarSelect = async (selectedAvatarUrl: string) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append('avatarUrl', selectedAvatarUrl);

      const result = await updateProfile({ error: null, success: false }, formData);

      if (result.success) {
        toast.success('Avatar updated');
        setAvatarPreview(selectedAvatarUrl);
        updateCurrentUser(selectedAvatarUrl, currentGender);
        await update({ force: true });
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to update avatar');
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error('File is too large. Max 2MB allowed.');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);

      startTransition(async () => {
        const formData = new FormData();
        formData.append('avatar', file);

        const result = await updateProfile({ error: null, success: false }, formData);

        if (result.success) {
          toast.success('Profile photo updated');
          await update({ force: true });
          router.refresh();
        } else {
          toast.error(result.error || 'Failed to upload photo');
          setAvatarPreview(
            avatarUrl && !isDefaultAvatar(avatarUrl)
              ? avatarUrl
              : getDefaultAvatar(currentGender, email || 'user')
          );
        }
      });
    }
  };

  const getInitials = (nameInput: string) => {
    return (nameInput || 'User')
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="space-y-6">
      {/* Card 1: Profile Photo */}
      <SettingsSection
        title="Profile Photo"
        description="Choose a preset avatar or upload your own photo"
        footer={
          <p className="text-xs text-muted-foreground">
            Supported formats: PNG, JPEG, WebP, GIF. Maximum size: 2MB.
          </p>
        }
      >
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 py-4">
          <div
            className="relative group cursor-pointer shrink-0"
            onClick={() => !isUploading && fileInputRef.current?.click()}
          >
            <Avatar
              className={cn(
                'h-24 w-24 border-2 border-background shadow-md ring-2 ring-primary/20 transition-all group-hover:ring-primary/60',
                isUploading && 'opacity-70'
              )}
            >
              <AvatarImage
                src={avatarPreview || getDefaultAvatar(currentGender, name)}
                alt={name}
                className="object-cover"
              />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>

            <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
              {isUploading ? (
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              ) : (
                <Camera className="h-6 w-6 text-white drop-shadow-md" />
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
              disabled={isUploading}
            />
          </div>

          <div className="flex flex-col items-center sm:items-start gap-3 flex-1 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row flex-wrap items-center justify-center sm:justify-start gap-2">
              <AvatarPicker
                currentAvatarUrl={avatarPreview}
                onSelect={handleAvatarSelect}
                userName={name}
              />

              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="gap-1.5 h-8 text-xs font-medium"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload Photo
              </Button>

              {avatarPreview && !isDefaultAvatar(avatarPreview) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    startTransition(async () => {
                      const formData = new FormData();
                      formData.append('removeAvatar', 'true');
                      const result = await updateProfile({ error: null, success: false }, formData);
                      if (result.success) {
                        toast.success('Custom photo removed');
                        const defaultAvatar = getDefaultAvatar(currentGender, name);
                        setAvatarPreview(defaultAvatar);
                        updateCurrentUser(null, currentGender);
                        await update({ force: true });
                        router.refresh();
                      } else {
                        toast.error(result.error || 'Failed to remove photo');
                      }
                    });
                  }}
                  disabled={isUploading}
                  className="gap-1.5 h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Reset to Default
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Card 2: Personal Information (Autosaved) */}
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
                          setCurrentGender(value);
                          if (isDefaultAvatar(avatarPreview)) {
                            setAvatarPreview(getDefaultAvatar(value, name));
                          }
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
                description="Your professional role in the organization"
                htmlFor="jobTitle"
              >
                <Input
                  id="jobTitle"
                  {...form.register('jobTitle')}
                  placeholder="e.g. Senior Site Reliability Engineer"
                  className="w-full max-w-md"
                />
              </SettingsRow>
            </div>
          </SettingsSection>
        </form>
      </FormProvider>

      {/* Card 3: Account Details (Read-Only) */}
      <SettingsSection
        title="Account Details"
        description="Core account metadata and authentication credentials"
        footer={
          <p className="text-xs text-muted-foreground">
            Contact your workspace administrator to update organizational permissions or SSO
            mappings.
          </p>
        }
      >
        <div className="divide-y text-sm">
          <SettingsRow
            label="Email Address"
            description="Your primary contact and login identifier"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-medium text-foreground">{email}</span>
            </div>
          </SettingsRow>

          <SettingsRow label="Account Role" description="Your permissions level in this workspace">
            <Badge
              variant="outline"
              size="xs"
              className="bg-primary/10 text-primary border-primary/20 uppercase font-bold text-[10px] tracking-wider"
            >
              {role}
            </Badge>
          </SettingsRow>

          <SettingsRow
            label="Authentication"
            description="Identity provider and authentication method"
          >
            {lastOidcSync ? (
              <div className="flex flex-col gap-1">
                <Badge
                  variant="outline"
                  size="xs"
                  className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30 font-medium text-[10px] w-fit"
                >
                  SSO Synced
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  Last synced: {lastOidcSync}
                </span>
              </div>
            ) : (
              <Badge
                variant="outline"
                size="xs"
                className="bg-muted text-muted-foreground border-border text-[10px] w-fit"
              >
                Direct Password Account
              </Badge>
            )}
          </SettingsRow>

          <SettingsRow label="Member Since" description="Date when your account was provisioned">
            <span className="text-sm text-muted-foreground">{memberSince}</span>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
