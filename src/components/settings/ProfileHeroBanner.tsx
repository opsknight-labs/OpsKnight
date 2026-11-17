'use client';

import React, { useRef, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { type DetailStatItem } from '@/components/ui/DetailHeroBanner';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import UserAvatar from '@/components/UserAvatar';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { cn } from '@/lib/utils';
import { AvatarPicker } from '@/components/settings/AvatarPicker';
import { useAvatarUpdater } from '@/hooks/useUserAvatar';
import { updateProfile } from '@/app/(app)/settings/actions';
import { notify as toast } from '@/lib/toast';
import { Camera, Loader2, Clock, Mail, Briefcase, Building2, RefreshCw } from 'lucide-react';

type ProfileHeroBannerProps = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
    avatarUrl?: string | null;
    gender?: string | null;
    status?: string | null;
    department?: string | null;
    jobTitle?: string | null;
    lastOidcSync?: string | null;
    timeZone?: string | null;
  };
  stats: DetailStatItem[];
  localTime: string;
};

function formatLabel(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default function ProfileHeroBanner({ user, stats, localTime }: ProfileHeroBannerProps) {
  const router = useRouter();
  const { update } = useSession();
  const { updateCurrentUser } = useAvatarUpdater();
  const [isUploading, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null | undefined>(
    user.avatarUrl
  );

  const displayName = user.name || 'User';

  const handleAvatarSelect = async (selectedAvatarUrl: string) => {
    startTransition(async () => {
      const formData = new FormData();
      formData.append('avatarUrl', selectedAvatarUrl);

      const result = await updateProfile({ error: null, success: false }, formData);

      if (result.success) {
        toast.success('Avatar updated');
        setCurrentAvatarUrl(selectedAvatarUrl);
        updateCurrentUser(selectedAvatarUrl, user.gender);
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
        formData.append('avatar', file);

        const result = await updateProfile({ error: null, success: false }, formData);

        if (result.success) {
          toast.success('Profile photo updated');
          updateCurrentUser(previewUrl, user.gender);
          await update({ force: true });
          router.refresh();
        } else {
          toast.error(result.error || 'Failed to upload photo');
          setCurrentAvatarUrl(user.avatarUrl);
        }
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <SettingsPageHeader
        title={displayName}
        icon={
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={isUploading}
              aria-label="Change avatar or upload a photo"
              className="group relative block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <UserAvatar
                userId={user.id}
                name={displayName}
                avatarUrl={currentAvatarUrl}
                gender={user.gender}
                size="2xl"
                className="shrink-0 rounded-full shadow-xl ring-4 ring-primary-foreground/20 transition-shadow duration-200 group-hover:ring-primary-foreground/40"
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {isUploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </span>
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-100 text-zinc-900 shadow-md"
              >
                <Camera className="h-3 w-3" />
              </span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              disabled={isUploading}
            />
          </div>
        }
        badges={
          <>
            <span className={pageHeaderBadgeClass}>{formatLabel(user.role)}</span>
            <span className={pageHeaderBadgeClass}>
              {user.lastOidcSync ? (
                <>
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  Synced from SSO
                </>
              ) : (
                'Local account'
              )}
            </span>
            {user.status && (
              <span
                className={cn(
                  pageHeaderBadgeClass,
                  user.status === 'ACTIVE' && 'border-emerald-500/40 text-emerald-300'
                )}
              >
                {formatLabel(user.status)}
              </span>
            )}
          </>
        }
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-primary-foreground/80 mt-1">
            {user.email && (
              <a
                href={`mailto:${user.email}`}
                className="inline-flex items-center gap-1.5 rounded-sm hover:text-primary-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              >
                <Mail className="h-3.5 w-3.5 shrink-0 opacity-70" />
                {user.email}
              </a>
            )}

            {user.jobTitle && (
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 shrink-0 opacity-70" />
                {user.jobTitle}
              </span>
            )}

            {user.department && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
                {user.department}
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {localTime}
            </span>
          </div>
        }
        stats={stats}
      />

      {/* Controlled Avatar Picker Dialog triggered by clicking the Hero Avatar */}
      <AvatarPicker
        currentAvatarUrl={currentAvatarUrl}
        onSelect={handleAvatarSelect}
        userName={displayName}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        trigger={null}
        onUploadClick={() => {
          setPickerOpen(false);
          setTimeout(() => fileInputRef.current?.click(), 100);
        }}
      />
    </>
  );
}
