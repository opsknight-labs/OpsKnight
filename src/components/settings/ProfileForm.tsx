'use client';

import { useState, useRef, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { SettingsRow } from '@/components/settings/layout/SettingsRow';
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
import { FormField, FormItem, FormControl, FormMessage } from '@/components/ui/shadcn/form';
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
  const [isSaving, setIsSaving] = useState(false);
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

  const isDirty = form.formState.isDirty;

  const handleAvatarSelect = async (selectedAvatarUrl: string) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append('avatarUrl', selectedAvatarUrl);

      const result = await updateProfile({ error: null, success: false }, formData);

      if (result.success) {
        toast.success('Avatar updated successfully');
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
          toast.success('Profile photo uploaded');
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

  const handleManualSave = async (data: ProfileFormData) => {
    setIsSaving(true);
    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('gender', data.gender || '');
    if (data.department) formData.append('department', data.department);
    if (data.jobTitle) formData.append('jobTitle', data.jobTitle);

    const result = await updateProfile({ error: null, success: false }, formData);

    if (result.success) {
      toast.success('Profile updated successfully');
      form.reset(data);
      await update({ force: true });
      router.refresh();
    } else {
      toast.error(result.error || 'Failed to update profile');
    }

    setIsSaving(false);
    return {
      success: result.success ?? false,
      error: result.error ?? undefined,
    };
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
        description="Choose a preset persona avatar or upload your own high-resolution image"
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
                src={avatarPreview || getDefaultAvatar(currentGender, email || 'user')}
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
                        const defaultAvatar = getDefaultAvatar(currentGender, email || 'user');
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

      {/* Card 2: Personal Information */}
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(handleManualSave)}>
          <SettingsSection
            title="Personal Information"
            description="Manage your personal details and organizational identity."
            footer={
              <div className="flex items-center justify-between w-full">
                <p className="text-xs text-muted-foreground">
                  {isDirty ? (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      ● You have unsaved changes
                    </span>
                  ) : (
                    'All changes saved'
                  )}
                </p>

                <Button
                  type="submit"
                  disabled={isSaving || isUploading || !isDirty}
                  className="gap-2"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>Save Changes</>
                  )}
                </Button>
              </div>
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
                            setAvatarPreview(getDefaultAvatar(value, email || 'user'));
                          }
                        }}
                        defaultValue={field.value || undefined}
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender identity" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="prefer-not-to-say">Prefer not to say</SelectItem>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="non-binary">Non-binary</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SettingsRow>

              <SettingsRow
                label="Department"
                description="Your organizational department"
                htmlFor="department"
              >
                <Input
                  id="department"
                  {...form.register('department')}
                  placeholder="e.g. Infrastructure"
                  className="w-full max-w-md"
                />
              </SettingsRow>

              <SettingsRow label="Job Title" description="Your role or position" htmlFor="jobTitle">
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

      {/* Card 3: Account Details */}
      <SettingsSection title="Account Details" description="Managed by your organization">
        <div className="divide-y text-sm">
          <SettingsRow label="Email">
            <span className="font-mono text-sm">{email || 'Not set'}</span>
          </SettingsRow>

          <SettingsRow label="Role">
            <Badge variant="outline" className="font-bold text-xs">
              {role}
            </Badge>
          </SettingsRow>

          <SettingsRow label="Authentication">
            {lastOidcSync ? (
              <Badge variant="secondary" className="gap-1">
                SSO{' '}
                <span className="font-normal text-muted-foreground ml-1">
                  Synced {lastOidcSync}
                </span>
              </Badge>
            ) : (
              <Badge variant="secondary">Direct Account</Badge>
            )}
          </SettingsRow>

          <SettingsRow label="Member Since">
            <span className="text-sm">{memberSince}</span>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  );
}
