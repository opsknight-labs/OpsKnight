'use client';

import { useState } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Modern Vector Portraits (Lorelei)
const LORELEI_AVATARS = [
  { id: 'lor-1', style: 'lorelei', seed: 'Alex', bg: '6366f1', label: 'Alex' },
  { id: 'lor-2', style: 'lorelei', seed: 'Sophia', bg: 'ec4899', label: 'Sophia' },
  { id: 'lor-3', style: 'lorelei', seed: 'Marcus', bg: '3b82f6', label: 'Marcus' },
  { id: 'lor-4', style: 'lorelei', seed: 'Elena', bg: '8b5cf6', label: 'Elena' },
  { id: 'lor-5', style: 'lorelei', seed: 'David', bg: '0d9488', label: 'David' },
  { id: 'lor-6', style: 'lorelei', seed: 'Aria', bg: '0284c7', label: 'Aria' },
  { id: 'lor-7', style: 'lorelei', seed: 'Liam', bg: '10b981', label: 'Liam' },
  { id: 'lor-8', style: 'lorelei', seed: 'Maya', bg: 'f59e0b', label: 'Maya' },
  { id: 'lor-9', style: 'lorelei', seed: 'Jordan', bg: '64748b', label: 'Jordan' },
  { id: 'lor-10', style: 'lorelei', seed: 'Chloe', bg: '4f46e5', label: 'Chloe' },
];

// Minimalist Notion / Linear Line-Art (Notionists)
const NOTIONIST_AVATARS = [
  { id: 'not-1', style: 'notionists', seed: 'Developer', bg: 'f1f5f9', label: 'Dev' },
  { id: 'not-2', style: 'notionists', seed: 'Architect', bg: 'e2e8f0', label: 'Architect' },
  { id: 'not-3', style: 'notionists', seed: 'Lead', bg: 'e0e7ff', label: 'Lead' },
  { id: 'not-4', style: 'notionists', seed: 'SRE', bg: 'dbeafe', label: 'SRE' },
  { id: 'not-5', style: 'notionists', seed: 'Security', bg: 'f3e8ff', label: 'Security' },
  { id: 'not-6', style: 'notionists', seed: 'Manager', bg: 'ccfbf1', label: 'Manager' },
  { id: 'not-7', style: 'notionists', seed: 'Engineer', bg: 'fef3c7', label: 'Engineer' },
  { id: 'not-8', style: 'notionists', seed: 'Analyst', bg: 'fae8ff', label: 'Analyst' },
  { id: 'not-9', style: 'notionists', seed: 'Admin', bg: 'e2e8f0', label: 'Admin' },
  { id: 'not-10', style: 'notionists', seed: 'Ops', bg: 'e0f2fe', label: 'Ops' },
];

// Flat Tech Personas (Personas)
const PERSONAS_AVATARS = [
  { id: 'per-1', style: 'personas', seed: 'Sam', bg: '6366f1', label: 'Sam' },
  { id: 'per-2', style: 'personas', seed: 'Taylor', bg: '3b82f6', label: 'Taylor' },
  { id: 'per-3', style: 'personas', seed: 'Morgan', bg: '8b5cf6', label: 'Morgan' },
  { id: 'per-4', style: 'personas', seed: 'Robin', bg: '0d9488', label: 'Robin' },
  { id: 'per-5', style: 'personas', seed: 'Casey', bg: 'ec4899', label: 'Casey' },
];

// Static custom avatars (call-center style with headsets)
const STATIC_AVATARS = [
  { id: 'custom-1', src: '/avatars/avatar-1.png', label: 'Agent Blue' },
  { id: 'custom-2', src: '/avatars/avatar-2.png', label: 'Agent Pink' },
  { id: 'custom-3', src: '/avatars/avatar-3.png', label: 'Agent Green' },
  { id: 'custom-4', src: '/avatars/avatar-4.png', label: 'Agent Purple' },
  { id: 'custom-5', src: '/avatars/avatar-5.png', label: 'Agent Orange' },
  { id: 'custom-6', src: '/avatars/avatar-6.png', label: 'Agent Teal' },
  { id: 'custom-7', src: '/avatars/avatar-7.png', label: 'Agent Violet' },
  { id: 'custom-8', src: '/avatars/avatar-8.png', label: 'Agent Red' },
  { id: 'custom-9', src: '/avatars/avatar-9.png', label: 'Agent Cyan' },
  { id: 'custom-10', src: '/avatars/avatar-10.png', label: 'Agent Indigo' },
];

const ANIMAL_AVATARS = [
  { id: 'animal-1', src: '/avatars/avatar-animal-1.png', label: 'Agent Owl' },
  { id: 'animal-2', src: '/avatars/avatar-animal-2.png', label: 'Agent Cat' },
  { id: 'animal-3', src: '/avatars/avatar-animal-3.png', label: 'Agent Dog' },
  { id: 'animal-4', src: '/avatars/avatar-animal-4.png', label: 'Agent Panda' },
  { id: 'animal-5', src: '/avatars/avatar-animal-5.png', label: 'Agent Fox' },
];

interface AvatarPickerProps {
  currentAvatarUrl?: string | null;
  onSelect: (avatarUrl: string) => void;
  userName: string;
}

export function AvatarPicker({ currentAvatarUrl, onSelect, userName }: AvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Generate DiceBear URL via our proxy
  const getDiceBearUrl = (style: string, seed: string, bg: string) => {
    return `/api/avatar?style=${style}&seed=${encodeURIComponent(seed)}&backgroundColor=${bg}&radius=50`;
  };

  const handleStaticSelect = (avatar: (typeof STATIC_AVATARS)[0]) => {
    setSelectedId(avatar.id);
    onSelect(avatar.src);
    setOpen(false);
  };

  const handleDiceBearSelect = (avatar: {
    id: string;
    style: string;
    seed: string;
    bg: string;
  }) => {
    const url = getDiceBearUrl(avatar.style, avatar.seed, avatar.bg);
    setSelectedId(avatar.id);
    onSelect(url);
    setOpen(false);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const isStaticSelected = (id: string) =>
    selectedId === id ||
    STATIC_AVATARS.find(a => a.id === id && a.src === currentAvatarUrl) ||
    ANIMAL_AVATARS.find(a => a.id === id && a.src === currentAvatarUrl);

  const isDiceBearSelected = (avatar: { id: string; style: string; seed: string; bg: string }) =>
    selectedId === avatar.id ||
    currentAvatarUrl === getDiceBearUrl(avatar.style, avatar.seed, avatar.bg);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        Choose Avatar Style
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Your Avatar</DialogTitle>
            <DialogDescription>
              Select a professional avatar that represents you. These avatars will be visible to
              your team across incidents, on-call rotations, and dashboards.
            </DialogDescription>
          </DialogHeader>

          {/* Modern Vector Portraits (Lorelei) */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <span>Modern Vector Portraits</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-normal">
                Recommended
              </span>
            </h4>
            <div className="grid grid-cols-5 gap-3">
              {LORELEI_AVATARS.map(avatar => {
                const isSelected = isDiceBearSelected(avatar);
                const url = getDiceBearUrl(avatar.style, avatar.seed, avatar.bg);
                return (
                  <button
                    key={avatar.id}
                    onClick={() => handleDiceBearSelect(avatar)}
                    className="group relative flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={cn(
                        'relative rounded-full p-0.5 transition-all duration-200',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:ring-2 hover:ring-primary/50 hover:ring-offset-2 hover:ring-offset-background'
                      )}
                    >
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={url} alt={avatar.label} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-muted">
                          {getInitials(userName)}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {avatar.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Minimalist Line-Art (Notionists) */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground">Minimalist Line-Art</h4>
            <div className="grid grid-cols-5 gap-3">
              {NOTIONIST_AVATARS.map(avatar => {
                const isSelected = isDiceBearSelected(avatar);
                const url = getDiceBearUrl(avatar.style, avatar.seed, avatar.bg);
                return (
                  <button
                    key={avatar.id}
                    onClick={() => handleDiceBearSelect(avatar)}
                    className="group relative flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={cn(
                        'relative rounded-full p-0.5 transition-all duration-200',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:ring-2 hover:ring-primary/50 hover:ring-offset-2 hover:ring-offset-background'
                      )}
                    >
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={url} alt={avatar.label} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-muted">
                          {getInitials(userName)}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {avatar.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Flat Tech Personas */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground">Flat Tech Personas</h4>
            <div className="grid grid-cols-5 gap-3">
              {PERSONAS_AVATARS.map(avatar => {
                const isSelected = isDiceBearSelected(avatar);
                const url = getDiceBearUrl(avatar.style, avatar.seed, avatar.bg);
                return (
                  <button
                    key={avatar.id}
                    onClick={() => handleDiceBearSelect(avatar)}
                    className="group relative flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={cn(
                        'relative rounded-full p-0.5 transition-all duration-200',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:ring-2 hover:ring-primary/50 hover:ring-offset-2 hover:ring-offset-background'
                      )}
                    >
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={url} alt={avatar.label} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-muted">
                          {getInitials(userName)}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {avatar.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Call-Center Avatars */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground">Ops & Support Agents</h4>
            <div className="grid grid-cols-5 gap-3">
              {STATIC_AVATARS.map(avatar => {
                const isSelected = isStaticSelected(avatar.id);
                return (
                  <button
                    key={avatar.id}
                    onClick={() => handleStaticSelect(avatar)}
                    className="group relative flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={cn(
                        'relative rounded-full p-0.5 transition-all duration-200',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:ring-2 hover:ring-primary/50 hover:ring-offset-2 hover:ring-offset-background'
                      )}
                    >
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={avatar.src} alt={avatar.label} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-muted">
                          {getInitials(userName)}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {avatar.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Animal Avatars */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground">Team Mascots</h4>
            <div className="grid grid-cols-5 gap-3">
              {ANIMAL_AVATARS.map(avatar => {
                const isSelected = isStaticSelected(avatar.id);
                return (
                  <button
                    key={avatar.id}
                    onClick={() => handleStaticSelect(avatar)}
                    className="group relative flex flex-col items-center gap-1.5"
                  >
                    <div
                      className={cn(
                        'relative rounded-full p-0.5 transition-all duration-200',
                        isSelected
                          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                          : 'hover:ring-2 hover:ring-primary/50 hover:ring-offset-2 hover:ring-offset-background'
                      )}
                    >
                      <Avatar className="h-14 w-14">
                        <AvatarImage src={avatar.src} alt={avatar.label} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-muted">
                          {getInitials(userName)}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {avatar.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center pt-2">
            Or upload your own custom photo / headshot from the profile section
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
