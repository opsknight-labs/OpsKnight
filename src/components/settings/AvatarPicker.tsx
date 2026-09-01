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
import { Check, Sparkles, Bot, User, Cpu, Shield, PawPrint } from 'lucide-react';
import { cn } from '@/lib/utils';

// Static high-res custom avatars (call-center and ops agents with headsets) - Local 0ms load
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
  { id: 'custom-11', src: '/avatars/avatar-11.png', label: 'Agent Amber' },
  { id: 'custom-12', src: '/avatars/avatar-12.png', label: 'Agent Emerald' },
  { id: 'custom-13', src: '/avatars/avatar-13.png', label: 'Agent Rose' },
  { id: 'custom-14', src: '/avatars/avatar-14.png', label: 'Agent Yellow' },
  { id: 'custom-15', src: '/avatars/avatar-15.png', label: 'Agent Lime' },
];

// Team Mascots & Animals
const ANIMAL_AVATARS = [
  { id: 'animal-1', src: '/avatars/avatar-animal-1.png', label: 'Night Owl' },
  { id: 'animal-2', src: '/avatars/avatar-animal-2.png', label: 'Clever Cat' },
  { id: 'animal-3', src: '/avatars/avatar-animal-3.png', label: 'Guard Dog' },
  { id: 'animal-4', src: '/avatars/avatar-animal-4.png', label: 'Calm Panda' },
  { id: 'animal-5', src: '/avatars/avatar-animal-5.png', label: 'Swift Fox' },
];

// Personalized Initials Palettes (Using user's actual name initials with vibrant SRE colorways)
const INITIALS_PALETTES = [
  { id: 'user-ini-indigo', bg: '6366f1', label: 'Indigo' },
  { id: 'user-ini-blue', bg: '3b82f6', label: 'Ocean Blue' },
  { id: 'user-ini-purple', bg: '8b5cf6', label: 'Royal Purple' },
  { id: 'user-ini-teal', bg: '0d9488', label: 'Deep Teal' },
  { id: 'user-ini-sky', bg: '0284c7', label: 'Sky Azure' },
  { id: 'user-ini-emerald', bg: '10b981', label: 'Emerald' },
  { id: 'user-ini-amber', bg: 'f59e0b', label: 'Warm Amber' },
  { id: 'user-ini-slate', bg: '475569', label: 'Slate' },
  { id: 'user-ini-pink', bg: 'ec4899', label: 'Rose' },
  { id: 'user-ini-dark', bg: '1e1b4b', label: 'Midnight' },
];

// Modern Tech Personas (Minimalist Vector Avatars)
const PERSONAS_AVATARS = [
  { id: 'per-1', style: 'personas', seed: 'Alex', bg: '6366f1', label: 'Alex' },
  { id: 'per-2', style: 'personas', seed: 'Morgan', bg: '3b82f6', label: 'Morgan' },
  { id: 'per-3', style: 'personas', seed: 'Taylor', bg: '8b5cf6', label: 'Taylor' },
  { id: 'per-4', style: 'personas', seed: 'Jordan', bg: '0d9488', label: 'Jordan' },
  { id: 'per-5', style: 'personas', seed: 'Casey', bg: '0284c7', label: 'Casey' },
  { id: 'per-6', style: 'personas', seed: 'Sam', bg: 'ec4899', label: 'Sam' },
  { id: 'per-7', style: 'personas', seed: 'Riley', bg: '10b981', label: 'Riley' },
  { id: 'per-8', style: 'personas', seed: 'Avery', bg: 'f59e0b', label: 'Avery' },
  { id: 'per-9', style: 'personas', seed: 'Quinn', bg: '64748b', label: 'Quinn' },
  { id: 'per-10', style: 'personas', seed: 'Dakota', bg: '4f46e5', label: 'Dakota' },
];

// Developer & SRE Bots (Cybernetic Ops Droids)
const BOT_PRESETS = [
  { id: 'bot-1', style: 'bottts', seed: 'SRE-Unit-01', bg: '6366f1', label: 'SRE Unit' },
  { id: 'bot-2', style: 'bottts', seed: 'Cyber-Alpha', bg: '3b82f6', label: 'Cyber Alpha' },
  { id: 'bot-3', style: 'bottts', seed: 'Incident-Bot', bg: '8b5cf6', label: 'Incident Bot' },
  { id: 'bot-4', style: 'bottts', seed: 'Sentinel-9', bg: '0d9488', label: 'Sentinel 9' },
  { id: 'bot-5', style: 'bottts', seed: 'Ops-Droid', bg: '0284c7', label: 'Ops Droid' },
  { id: 'bot-6', style: 'bottts', seed: 'Kernel-X', bg: '10b981', label: 'Kernel X' },
  { id: 'bot-7', style: 'bottts', seed: 'Pager-Bot', bg: 'f59e0b', label: 'Pager Bot' },
  { id: 'bot-8', style: 'bottts', seed: 'Rel-Daemon', bg: '64748b', label: 'Rel Daemon' },
  { id: 'bot-9', style: 'bottts', seed: 'SecOps-Prime', bg: 'ec4899', label: 'SecOps Prime' },
  { id: 'bot-10', style: 'bottts', seed: 'Root-Defender', bg: '4f46e5', label: 'Root Defender' },
];

// Notionists (Clean Minimalist Hand-Drawn Tech Personas)
const NOTIONISTS_PRESETS = [
  { id: 'notion-1', style: 'notionists', seed: 'DevOps', bg: '6366f1', label: 'Engineer' },
  { id: 'notion-2', style: 'notionists', seed: 'SRE', bg: '3b82f6', label: 'SRE Lead' },
  { id: 'notion-3', style: 'notionists', seed: 'Architect', bg: '8b5cf6', label: 'Architect' },
  { id: 'notion-4', style: 'notionists', seed: 'Security', bg: '0d9488', label: 'SecOps' },
  { id: 'notion-5', style: 'notionists', seed: 'Platform', bg: '0284c7', label: 'Platform' },
];

// Professional Avataaars (Classic Clean Character Presets)
const AVATAAARS_PRESETS = [
  { id: 'ava-1', style: 'avataaars', seed: 'Engineer', bg: '6366f1', label: 'Engineer' },
  { id: 'ava-2', style: 'avataaars', seed: 'DevOps', bg: '3b82f6', label: 'DevOps' },
  { id: 'ava-3', style: 'avataaars', seed: 'TechLead', bg: '8b5cf6', label: 'Tech Lead' },
  { id: 'ava-4', style: 'avataaars', seed: 'SRE', bg: '0d9488', label: 'SRE' },
  { id: 'ava-5', style: 'avataaars', seed: 'Architect', bg: '0284c7', label: 'Architect' },
];

// Abstract Shapes & Identicons (Cryptographic & Clean Badges)
const ABSTRACT_PRESETS = [
  { id: 'shp-1', style: 'shapes', seed: 'Alpha', bg: '6366f1', label: 'Alpha' },
  { id: 'shp-2', style: 'shapes', seed: 'Beta', bg: '3b82f6', label: 'Beta' },
  { id: 'shp-3', style: 'shapes', seed: 'Gamma', bg: '8b5cf6', label: 'Gamma' },
  { id: 'shp-4', style: 'shapes', seed: 'Delta', bg: '0d9488', label: 'Delta' },
  { id: 'shp-5', style: 'identicon', seed: 'SecToken1', bg: '0284c7', label: 'Token 1' },
  { id: 'shp-6', style: 'identicon', seed: 'SecToken2', bg: '10b981', label: 'Token 2' },
];

interface AvatarPickerProps {
  currentAvatarUrl?: string | null;
  onSelect: (avatarUrl: string) => void;
  userName: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AvatarPicker({
  currentAvatarUrl,
  onSelect,
  userName,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: AvatarPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen || (() => {}) : setInternalOpen;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Generate DiceBear URL via our proxy with SVG format for instant 0ms vector loading
  const getDiceBearUrl = (style: string, seed: string, bg: string) => {
    return `/api/avatar?style=${style}&seed=${encodeURIComponent(seed)}&backgroundColor=${bg}&radius=50&format=svg`;
  };

  const handleStaticSelect = (avatar: { id: string; src: string; label: string }) => {
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
    return (
      name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'U'
    );
  };

  const isStaticSelected = (src: string, id: string) =>
    selectedId === id || currentAvatarUrl === src;

  const isDiceBearSelected = (avatar: { id: string; style: string; seed: string; bg: string }) => {
    if (selectedId === avatar.id) return true;
    if (!currentAvatarUrl) return false;
    return (
      currentAvatarUrl.includes(`style=${avatar.style}`) &&
      currentAvatarUrl.includes(`seed=${encodeURIComponent(avatar.seed)}`)
    );
  };

  return (
    <>
      {trigger !== undefined ? (
        trigger ? (
          <div onClick={() => setOpen(true)} className="inline-flex cursor-pointer">
            {trigger}
          </div>
        ) : null
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
          Choose Avatar Style
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Your Avatar</DialogTitle>
            <DialogDescription>
              Select an avatar that represents you across incidents, on-call schedules, and team
              dashboards.
            </DialogDescription>
          </DialogHeader>

          {/* Team Mascots & Animals */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <PawPrint className="h-4 w-4 text-amber-500" />
              <span>Team Mascots & Animals</span>
            </h4>
            <div className="grid grid-cols-5 gap-3">
              {ANIMAL_AVATARS.map(avatar => {
                const isSelected = isStaticSelected(avatar.src, avatar.id);
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
                          {avatar.label.slice(0, 2)}
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

          {/* Ops & Support Team Avatars (Local 0ms High-Res) */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              <span>Ops & Engineering Agents</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-normal">
                Recommended
              </span>
            </h4>
            <div className="grid grid-cols-5 gap-3">
              {STATIC_AVATARS.map(avatar => {
                const isSelected = isStaticSelected(avatar.src, avatar.id);
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

          {/* Developer & SRE Bots */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 text-indigo-500" />
              <span>Developer & SRE Bots</span>
            </h4>
            <div className="grid grid-cols-5 gap-3">
              {BOT_PRESETS.map(avatar => {
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
                          {avatar.seed.slice(0, 2)}
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

          {/* Minimalist Notionists */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span>Minimalist Personas</span>
            </h4>
            <div className="grid grid-cols-5 gap-3">
              {NOTIONISTS_PRESETS.map(avatar => {
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
                          {avatar.seed.slice(0, 2)}
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

          {/* Personalized User Name Initials */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Cpu className="h-4 w-4 text-teal-500" />
              <span>Personalized Initials</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-normal">
                {getInitials(userName)}
              </span>
            </h4>
            <div className="grid grid-cols-5 gap-3">
              {INITIALS_PALETTES.map(palette => {
                const userInitials = getInitials(userName);
                const url = getDiceBearUrl('initials', userInitials, palette.bg);
                const isSelected =
                  selectedId === palette.id ||
                  (currentAvatarUrl?.includes('style=initials') &&
                    currentAvatarUrl?.includes(`backgroundColor=${palette.bg}`));

                return (
                  <button
                    key={palette.id}
                    onClick={() => {
                      setSelectedId(palette.id);
                      onSelect(url);
                      setOpen(false);
                    }}
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
                        <AvatarImage src={url} alt={palette.label} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-muted">
                          {userInitials}
                        </AvatarFallback>
                      </Avatar>
                      {isSelected && (
                        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate max-w-full">
                      {palette.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Flat Tech Personas */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground">Vector Personas</h4>
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
                          {avatar.seed.slice(0, 2)}
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

          {/* Professional Avataaars */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground">Engineering Roles</h4>
            <div className="grid grid-cols-5 gap-3">
              {AVATAAARS_PRESETS.map(avatar => {
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
                          {avatar.seed.slice(0, 2)}
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

          {/* Abstract Geometric & Identicons */}
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Shield className="h-4 w-4 text-sky-500" />
              <span>Abstract Badges & Tokens</span>
            </h4>
            <div className="grid grid-cols-6 gap-3">
              {ABSTRACT_PRESETS.map(avatar => {
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
                          {avatar.seed.slice(0, 2)}
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
        </DialogContent>
      </Dialog>
    </>
  );
}
