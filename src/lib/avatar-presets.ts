/**
 * The avatar library offered in Settings → Profile. Pure data, so it can be tested: every entry is either a
 * bundled illustration under /avatars or a generated one from /api/avatar (local DiceBear engines), and both
 * are URLs the profile action accepts. Styles outside this set still render for people who picked them before.
 */
import { MODERN_AVATAR_PALETTE, extractInitials } from '@/lib/avatar';

export type AvatarPreset = { id: string; label: string; url: string };
export type AvatarCategory = {
  id: 'team' | 'illustrated' | 'sketch' | 'orbs' | 'initials';
  label: string;
  hint: string;
  presets: AvatarPreset[];
};

const bundled = (id: string, file: string, label: string): AvatarPreset => ({
  id,
  label,
  url: `/avatars/${file}`,
});

/** A generated avatar; the URL is built the same way everywhere so "is this one selected" is a plain compare. */
export function generatedAvatarUrl(style: string, seed: string, bg: string): string {
  return `/api/avatar?style=${style}&seed=${encodeURIComponent(seed)}&backgroundColor=${bg}&radius=50`;
}

const generated = (style: string, seed: string, bg: string, label = seed): AvatarPreset => ({
  id: `${style}-${seed}`.toLowerCase(),
  label,
  url: generatedAvatarUrl(style, seed, bg),
});

const [INDIGO, BLUE, VIOLET, TEAL, SKY, PINK, EMERALD, AMBER, SLATE] = MODERN_AVATAR_PALETTE;
const TONES = [INDIGO, TEAL, VIOLET, SKY, EMERALD, PINK, AMBER, SLATE];
const tone = (index: number) => TONES[index % TONES.length];

// People worth being: pioneers of computing, so the names are neutral and read well in a tooltip.
const PEOPLE = [
  'Ada',
  'Grace',
  'Linus',
  'Margaret',
  'Dennis',
  'Radia',
  'Ken',
  'Barbara',
  'Alan',
  'Hedy',
  'Tim',
  'Katherine',
];

const INITIAL_TONES: Array<[string, string]> = [
  [INDIGO, 'Indigo'],
  [BLUE, 'Blue'],
  [VIOLET, 'Violet'],
  [TEAL, 'Teal'],
  [SKY, 'Sky'],
  [EMERALD, 'Emerald'],
  [AMBER, 'Amber'],
  [PINK, 'Rose'],
  [SLATE, 'Slate'],
  ['1e1b4b', 'Midnight'],
];

/** The library for one person: initials tiles use their own initials, so they match the fallback everywhere. */
export function buildAvatarLibrary(userName: string | null | undefined): AvatarCategory[] {
  const initials = extractInitials(userName);
  return [
    {
      id: 'team',
      label: 'Team',
      hint: 'Mascots and ops agents',
      presets: [
        bundled('animal-1', 'avatar-animal-1.png', 'Night Owl'),
        bundled('animal-2', 'avatar-animal-2.png', 'Clever Cat'),
        bundled('animal-3', 'avatar-animal-3.png', 'Guard Dog'),
        bundled('animal-4', 'avatar-animal-4.png', 'Calm Panda'),
        bundled('animal-5', 'avatar-animal-5.png', 'Swift Fox'),
        ...[
          'Blue',
          'Pink',
          'Green',
          'Purple',
          'Orange',
          'Teal',
          'Violet',
          'Red',
          'Cyan',
          'Indigo',
          'Amber',
          'Emerald',
          'Rose',
          'Yellow',
          'Lime',
        ].map((name, index) =>
          bundled(`agent-${index + 1}`, `avatar-${index + 1}.png`, `Agent ${name}`)
        ),
      ],
    },
    {
      id: 'illustrated',
      label: 'Illustrated',
      hint: 'Friendly colour portraits',
      presets: PEOPLE.map((name, index) => generated('micah', name, tone(index))),
    },
    {
      id: 'sketch',
      label: 'Sketch',
      hint: 'Clean line art',
      presets: PEOPLE.map((name, index) => generated('lorelei', name, tone(index + 3))),
    },
    {
      id: 'orbs',
      label: 'Orbs',
      hint: 'Soft abstract colour',
      presets: PEOPLE.slice(0, 10).map((name, index) =>
        generated('glass', name, tone(index), `Orb ${index + 1}`)
      ),
    },
    {
      id: 'initials',
      label: 'Initials',
      hint: `Your initials (${initials}) on a colour`,
      presets: INITIAL_TONES.map(([bg, label]) => ({
        id: `initials-${label.toLowerCase()}`,
        label,
        url: generatedAvatarUrl('initials', initials, bg),
      })),
    },
  ];
}

/**
 * Whether two avatar URLs show the same picture: bundled files by path, generated ones by style, seed, colour
 * and radius (parameter order, the old `format=svg` flag and relative-vs-absolute origin do not matter).
 */
export function isSameAvatar(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const normal = (value: string) => {
    try {
      const url = new URL(value, 'http://avatar.local');
      if (!url.pathname.startsWith('/api/avatar')) return url.pathname;
      const params = ['style', 'seed', 'backgroundColor', 'radius'].map(
        key => `${key}=${(url.searchParams.get(key) ?? '').toLowerCase()}`
      );
      return `${url.pathname}?${params.join('&')}`;
    } catch {
      return value;
    }
  };
  return normal(a) === normal(b);
}
