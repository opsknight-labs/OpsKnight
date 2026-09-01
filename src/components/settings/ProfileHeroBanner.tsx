'use client';

import React, { useRef, useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DetailHeroBanner, { type DetailStatItem } from '@/components/ui/DetailHeroBanner';
import UserAvatar from '@/components/UserAvatar';
import { Badge } from '@/components/ui/shadcn/badge';
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
        formData.append('file', file);

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
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Profile & Preferences',
        }}
        tag="Personal Account"
        title={displayName}
        icon={
          <div
            className="relative group cursor-pointer shrink-0"
            onClick={() => setPickerOpen(true)}
            title="Click to customize avatar or upload photo"
          >
            <UserAvatar
              userId={user.id}
              name={displayName}
              avatarUrl={currentAvatarUrl}
              gender={user.gender}
              size="2xl"
              showOnlineStatus={user.status === 'ACTIVE'}
              className="shrink-0 ring-4 ring-primary-foreground/20 rounded-full shadow-xl transition-all duration-200 group-hover:ring-primary-foreground/40 group-hover:scale-102"
            />

            {/* Sleek Camera Overlay */}
            <div className="absolute inset-0 rounded-full flex flex-col items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[1.5px]">
              {isUploading ? (
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              ) : (
                <>
                  <Camera className="h-5 w-5 text-white drop-shadow-md" />
                  <span className="text-[9px] font-semibold text-white tracking-wider uppercase mt-0.5">
                    Change
                  </span>
                </>
              )}
            </div>

            {/* Corner Camera Badge */}
            <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary-foreground text-primary flex items-center justify-center shadow-md border-2 border-primary transition-transform group-hover:scale-110">
              <Camera className="h-3 w-3" />
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
        }
        badges={
          <>
            <Badge
              variant="outline"
              size="xs"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 uppercase font-bold text-[10px] tracking-wider"
            >
              {user.role}
            </Badge>

            {user.lastOidcSync ? (
              <Badge
                variant="outline"
                size="xs"
                className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 font-medium text-[10px] gap-1"
              >
                <RefreshCw className="h-2.5 w-2.5" /> SSO Synced
              </Badge>
            ) : (
              <Badge
                variant="outline"
                size="xs"
                className="bg-primary-foreground/10 text-primary-foreground/90 border-primary-foreground/20 text-[10px]"
              >
                Direct Account
              </Badge>
            )}

            <Badge
              variant="outline"
              size="xs"
              className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 text-[10px]"
            >
              Active
            </Badge>
          </>
        }
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-primary-foreground/80 mt-1">
            {user.email && (
              <a
                href={`mailto:${user.email}`}
                className="inline-flex items-center gap-1.5 font-mono hover:text-primary-foreground transition-colors"
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

            <span className="inline-flex items-center gap-1.5 font-mono bg-primary-foreground/10 px-2 py-0.5 rounded border border-primary-foreground/15">
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
      />
    </>
  );
}
