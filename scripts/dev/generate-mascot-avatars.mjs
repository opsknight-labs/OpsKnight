/**
 * Builds the bundled mascot avatars from code, so the set is reproducible and easy to extend:
 *   public/avatars/squire/*.svg  the Squire bot in its moods, plus colourways of the same character
 *   public/avatars/knight/*.svg  OpsKnight knights, drawn in the Squire's flat style
 *
 *   node scripts/dev/generate-mascot-avatars.mjs
 *
 * Commit the output; the picker lists the files (src/lib/avatar-presets.ts). Static, no animation.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'public/squire/opsknight-squire.svg'), 'utf8');

/* ───────────────────────────── Squire ───────────────────────────── */

// `state` picks the mascot's own expression (happy eyes, thinking dots, alarm, frown, sleeping Zs).
export const SQUIRE = [
  { file: 'squire', bg: '6366f1', state: 'idle' },
  {
    file: 'lady-squire',
    bg: 'be185d',
    state: 'greeting',
    lady: { hair: '#5b3a29', shade: '#3a2418', bow: '#f43f5e' },
  },
  {
    file: 'lady-aurora',
    bg: '0f766e',
    state: 'success',
    lady: { hair: '#f2c14e', shade: '#b98a1d', bow: '#fde68a' },
  },
  {
    file: 'lady-luna',
    bg: '312e81',
    state: 'thinking',
    lady: { hair: '#d7dbe6', shade: '#8c93a8', bow: '#a78bfa' },
  },
  {
    file: 'lady-ember',
    bg: '7c2d12',
    state: 'idle',
    lady: { hair: '#d9480f', shade: '#7c2d12', bow: '#fbbf24' },
  },
  { file: 'cheer', bg: 'f59e0b', state: 'greeting' },
  { file: 'scout', bg: '0284c7', state: 'listening' },
  { file: 'thinker', bg: '8b5cf6', state: 'thinking' },
  { file: 'victor', bg: '0d9488', state: 'success' },
  { file: 'watchman', bg: '64748b', state: 'alert' },
  { file: 'oops', bg: 'ec4899', state: 'error' },
  { file: 'sleepy', bg: '1e1b4b', state: 'offline' },
  {
    file: 'paladin',
    bg: '1e3a8a',
    state: 'greeting',
    vars: {
      helm: '#F6E7B4',
      'helm-shade': '#E3CB84',
      rim: '#C9A545',
      armor: '#F3E3A8',
      'armor-shade': '#DFC474',
      joint: '#5B4A1E',
      glove: '#6B5A2A',
      red: '#1D4ED8',
      'red-shade': '#1E3A8A',
      'red-hi': '#3B82F6',
      eye: '#FDE68A',
    },
  },
  {
    file: 'midnight',
    bg: 'f59e0b',
    state: 'idle',
    vars: {
      helm: '#3A4152',
      'helm-shade': '#2B3140',
      rim: '#232834',
      armor: '#404759',
      'armor-shade': '#2F3646',
      joint: '#1B1F2A',
      glove: '#232834',
      visor: '#0B0E15',
      red: '#7C3AED',
      'red-shade': '#4C1D95',
      'red-hi': '#A78BFA',
      eye: '#67E8F9',
    },
  },
  {
    file: 'emerald',
    bg: '10b981',
    state: 'greeting',
    vars: {
      helm: '#DDF5EA',
      'helm-shade': '#BFE8D3',
      rim: '#8FCFB0',
      armor: '#D3F0E2',
      'armor-shade': '#B4E0CB',
      joint: '#2F4B3E',
      glove: '#35584A',
      red: '#059669',
      'red-shade': '#065F46',
      'red-hi': '#34D399',
      eye: '#A7F3D0',
    },
  },
  {
    file: 'crimson',
    bg: 'ec4899',
    state: 'idle',
    vars: {
      helm: '#8B2332',
      'helm-shade': '#6E1B28',
      rim: '#521420',
      armor: '#922A3A',
      'armor-shade': '#721F2E',
      joint: '#3A1119',
      glove: '#4A1822',
      red: '#F4F1F3',
      'red-shade': '#D9D2D7',
      'red-hi': '#FFFFFF',
      eye: '#FECACA',
    },
  },
  {
    file: 'frost',
    bg: '1e1b4b',
    state: 'greeting',
    vars: {
      helm: '#E3F2FD',
      'helm-shade': '#BBDEFB',
      rim: '#90CAF9',
      armor: '#DCEEFB',
      'armor-shade': '#B6D8F3',
      joint: '#355070',
      glove: '#3F5F86',
      red: '#0EA5E9',
      'red-shade': '#0369A1',
      'red-hi': '#38BDF8',
      eye: '#E0F2FE',
    },
  },
  {
    file: 'shadow',
    bg: 'e2e8f0',
    state: 'idle',
    vars: {
      helm: '#2A2F3A',
      'helm-shade': '#1E232D',
      rim: '#151922',
      armor: '#323847',
      'armor-shade': '#262B37',
      joint: '#11141B',
      glove: '#1B1F28',
      visor: '#05070B',
      red: '#475569',
      'red-shade': '#1E293B',
      'red-hi': '#94A3B8',
      eye: '#F87171',
    },
  },
  {
    file: 'ember',
    bg: '0f172a',
    state: 'idle',
    vars: { eye: '#FECACA', red: '#F97316', 'red-shade': '#C2410C', 'red-hi': '#FDBA74' },
  },
  {
    file: 'solar',
    bg: '7c2d12',
    state: 'success',
    vars: {
      helm: '#FFF1C9',
      'helm-shade': '#F8D98A',
      rim: '#E8B84A',
      armor: '#FFEBB5',
      'armor-shade': '#F2CD72',
      joint: '#7A4B0F',
      glove: '#8A5A16',
      red: '#EA580C',
      'red-shade': '#9A3412',
      'red-hi': '#FB923C',
      eye: '#FFFFFF',
    },
  },
];

const stripMotion = svg =>
  svg
    .replace(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/animation:[^;}]*;?/g, '');

// Lady Squires: hair locks behind the head and a bow on top, drawn around the unchanged mascot.
function ladyParts({ hair, shade, bow }) {
  const lock = (x, dir) =>
    `<path fill="${hair}" d="M${x} 40C${x + dir * 14} 52 ${x + dir * 18} 80 ${x + dir * 8} 104C${x + dir * 2} 100 ${x - dir * 4} 84 ${x - dir * 6} 64Z"/><path fill="${shade}" d="M${x + dir * 6} 62C${x + dir * 12} 76 ${x + dir * 10} 90 ${x + dir * 8} 100C${x + dir * 3} 92 ${x + dir * 2} 76 ${x + dir * 4} 62Z" opacity=".5"/>`;
  return {
    back: `${lock(30, -1)}${lock(90, 1)}`,
    front: `<g transform="translate(88 17) rotate(14)"><path fill="${bow}" d="M0 0L-14 -8Q-18 0 -14 8Z"/><path fill="${bow}" d="M0 0L14 -8Q18 0 14 8Z"/><path fill="#fff" opacity=".35" d="M-12 -5L-3 -1L-12 -2Z"/><circle r="3.6" fill="${shade}"/></g>`,
  };
}

function squire({ bg, state, vars = {}, lady }) {
  const parts = lady ? ladyParts(lady) : { back: '', front: '' };
  const style = Object.entries(vars)
    .map(([name, value]) => `--sq-${name}:${value}`)
    .join(';');
  return (
    stripMotion(source)
      // Head and chest; the plume, ears and a hint of cape stay in frame.
      .replace('viewBox="0 0 120 120"', 'viewBox="6 0 108 108"')
      .replace('data-state="idle"', `data-state="${state}"`)
      .replace('<svg class="sq"', `<svg class="sq" style="--sq-size:100%;${style}"`)
      .replace('role="img" aria-label="OpsKnight Squire"', 'role="img" aria-label="Squire avatar"')
      .replace(
        '</style>',
        `</style>\n<rect x="0" y="0" width="120" height="120" fill="#${bg}"/>${parts.back}`
      )
      .replace('</svg>', `${parts.front}</svg>`)
  );
}

/* ───────────────────────────── Knights ───────────────────────────── */

// Metals: shadow, body, light and glint, so each knight shades like real plate instead of a flat fill.
const METAL = {
  steel: ['#2f3542', '#7d889b', '#dfe6f0', '#ffffff'],
  gold: ['#5e3f0c', '#c8962e', '#f3d67a', '#fff3c4'],
  black: ['#07090d', '#242a35', '#566071', '#9aa6b8'],
  bronze: ['#3f220f', '#9a5b2c', '#e0a064', '#ffe0b8'],
  blued: ['#101c36', '#3d5a8f', '#9bb7e8', '#e0ecff'],
  ruby: ['#2e0a12', '#8b2332', '#d9566a', '#ffc0cc'],
  silver: ['#5b6270', '#c5ccd8', '#f7f9fc', '#ffffff'],
  emerald: ['#0a2c21', '#1f7a5c', '#6fd1ac', '#d8fff0'],
};

// Plumes and crests that sit on the helm; `c` is the main colour, `d` its shadow.
const PLUME = {
  sweep: (c, d) =>
    `<g class="plume"><path fill="${d}" d="M60 10C60 -4 76 -10 94 -4C84 -2 78 4 80 12C74 8 66 8 60 14Z"/><path fill="${c}" d="M60 12C58 -6 78 -16 100 -6C88 -4 82 2 84 12C78 6 68 6 62 16Z"/><path fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.6" stroke-linecap="round" d="M66 4C74 -3 84 -4 93 -3"/></g>`,
  fan: (c, d) =>
    `<g class="plume"><path fill="${d}" d="M60 12C44 8 34 -2 36 -14C46 -10 54 -4 60 4Z"/><path fill="${c}" d="M60 12C54 -2 58 -16 66 -22C68 -10 66 0 64 10Z"/><path fill="${d}" d="M60 12C76 8 86 -2 84 -14C74 -10 66 -4 60 4Z"/><path fill="${c}" d="M60 10C50 4 44 -6 46 -16C52 -8 58 -2 60 6Z"/></g>`,
  horns: (c, d) =>
    `<path fill="${d}" d="M32 30C20 26 12 16 14 2C22 10 30 14 40 18Z"/><path fill="${c}" d="M33 31C21 27 13 17 15 4C22 12 30 16 40 20Z"/><path fill="${d}" d="M88 30C100 26 108 16 106 2C98 10 90 14 80 18Z"/><path fill="${c}" d="M87 31C99 27 107 17 105 4C98 12 90 16 80 20Z"/>`,
  wings: (c, d) =>
    `<path fill="${d}" d="M33 34C20 32 8 22 4 6C18 8 28 14 38 24Z"/><path fill="${c}" d="M34 33C22 31 11 22 8 9C19 11 29 17 38 26Z"/><path fill="${c}" d="M30 36C18 36 8 32 2 24C14 24 24 26 34 30Z"/><path fill="${d}" d="M87 34C100 32 112 22 116 6C102 8 92 14 82 24Z"/><path fill="${c}" d="M86 33C98 31 109 22 112 9C101 11 91 17 82 26Z"/><path fill="${c}" d="M90 36C102 36 112 32 118 24C106 24 96 26 86 30Z"/>`,
  crest: (c, d) =>
    `<path fill="${d}" d="M56 14C56 2 58 -6 60 -10C62 -6 64 2 64 14Z"/><path fill="${c}" d="M57 14C57 4 58.5 -3 60 -8C61.5 -3 63 4 63 14Z"/>`,
};

// file, background colours (centre, edge), metal, plume style, plume colours, eye glow
export const KNIGHTS = [
  {
    file: 'sentinel',
    bg: ['#33415c', '#0b1020'],
    metal: 'steel',
    plume: 'sweep',
    c: '#D21A1B',
    d: '#7F1018',
    glow: '#ffffff',
  },
  {
    file: 'crusader',
    bg: ['#5a2230', '#1a0b10'],
    metal: 'silver',
    plume: 'crest',
    c: '#C8102E',
    d: '#7A0A1C',
    glow: '#fff1d6',
  },
  {
    file: 'paladin',
    bg: ['#27428a', '#0b1736'],
    metal: 'gold',
    plume: 'wings',
    c: '#F4F1E8',
    d: '#B9B3A2',
    glow: '#ffe9a6',
  },
  {
    file: 'warden',
    bg: ['#4a3a78', '#140f2a'],
    metal: 'black',
    plume: 'horns',
    c: '#9a8fb8',
    d: '#4a4060',
    glow: '#7df0ff',
  },
  {
    file: 'ranger',
    bg: ['#1f5a4c', '#08201a'],
    metal: 'emerald',
    plume: 'fan',
    c: '#1fa97a',
    d: '#0d5c43',
    glow: '#b8ffe6',
  },
  {
    file: 'vanguard',
    bg: ['#5b6b86', '#1a2233'],
    metal: 'blued',
    plume: 'sweep',
    c: '#E9EEF8',
    d: '#9aa6bd',
    glow: '#cfe4ff',
  },
  {
    file: 'bastion',
    bg: ['#6a4a22', '#1d1208'],
    metal: 'bronze',
    plume: 'crest',
    c: '#2f2a24',
    d: '#15120f',
    glow: '#ffd08a',
  },
  {
    file: 'shadow',
    bg: ['#3a3f4f', '#090b10'],
    metal: 'black',
    plume: 'sweep',
    c: '#5b6275',
    d: '#262a35',
    glow: '#ff6b6b',
  },
  {
    file: 'ember',
    bg: ['#7a3a1c', '#1c0c06'],
    metal: 'bronze',
    plume: 'fan',
    c: '#F97316',
    d: '#9A3412',
    glow: '#ffb27a',
  },
  {
    file: 'royal',
    bg: ['#5b3a96', '#170f2c'],
    metal: 'gold',
    plume: 'fan',
    c: '#7C3AED',
    d: '#4C1D95',
    glow: '#fff0b0',
  },
  {
    file: 'direwolf',
    bg: ['#4d5a6e', '#10151f'],
    metal: 'steel',
    plume: 'crest',
    c: '#e8edf5',
    d: '#8f9bb0',
    glow: '#bfe3ff',
  },
  {
    file: 'lion',
    bg: ['#7a1c24', '#1d0609'],
    metal: 'gold',
    plume: 'sweep',
    c: '#C8102E',
    d: '#6b0a18',
    glow: '#fff0b8',
  },
  {
    file: 'dragon',
    bg: ['#3a1218', '#07070a'],
    metal: 'black',
    plume: 'horns',
    c: '#B3121F',
    d: '#5c0a10',
    glow: '#ff5a3c',
  },
  {
    file: 'stag',
    bg: ['#2f2f36', '#08080b'],
    metal: 'gold',
    plume: 'horns',
    c: '#E5B93C',
    d: '#8a6a14',
    glow: '#fff3c4',
  },
  {
    file: 'kraken',
    bg: ['#1e3a4a', '#050d12'],
    metal: 'black',
    plume: 'wings',
    c: '#E5B93C',
    d: '#7a5c10',
    glow: '#9ff0ff',
  },
  {
    file: 'rose',
    bg: ['#2f6b3c', '#0a1e10'],
    metal: 'emerald',
    plume: 'fan',
    c: '#E5B93C',
    d: '#8a6a14',
    glow: '#e8ffd0',
  },
  {
    file: 'sun',
    bg: ['#a8501c', '#2a0e05'],
    metal: 'bronze',
    plume: 'sweep',
    c: '#F97316',
    d: '#9A3412',
    glow: '#ffe2a0',
  },
  {
    file: 'nightwatch',
    bg: ['#2a2d35', '#050608'],
    metal: 'black',
    plume: 'crest',
    c: '#1b1d23',
    d: '#0a0b0e',
    glow: '#9fd0ff',
  },
  {
    file: 'kingsguard',
    bg: ['#6f7684', '#1c212b'],
    metal: 'silver',
    plume: 'sweep',
    c: '#FFFFFF',
    d: '#aeb6c6',
    glow: '#ffffff',
  },
  {
    file: 'valkyrie',
    bg: ['#3d5a8f', '#0b1530'],
    metal: 'silver',
    plume: 'wings',
    c: '#F4F1E8',
    d: '#B9B3A2',
    glow: '#cfe4ff',
    hair: '#f2d48a',
    hairShade: '#a8832a',
  },
  {
    file: 'duchess',
    bg: ['#6b2a4a', '#1c0a14'],
    metal: 'gold',
    plume: 'fan',
    c: '#C026D3',
    d: '#701a75',
    glow: '#ffe9a6',
    hair: '#8a3b1a',
    hairShade: '#4a1f0a',
  },
  {
    file: 'huntress',
    bg: ['#235c46', '#07201a'],
    metal: 'emerald',
    plume: 'crest',
    c: '#1fa97a',
    d: '#0d5c43',
    glow: '#b8ffe6',
    hair: '#2b1d17',
    hairShade: '#120b08',
  },
  {
    file: 'ice-queen',
    bg: ['#3c6a9a', '#0b1a2e'],
    metal: 'blued',
    plume: 'crest',
    c: '#E9F4FF',
    d: '#9fc2e6',
    glow: '#e0f4ff',
    hair: '#e8eef8',
    hairShade: '#8fa4c4',
  },
  {
    file: 'warrior-queen',
    bg: ['#6a1a2c', '#16060b'],
    metal: 'ruby',
    plume: 'horns',
    c: '#E5B93C',
    d: '#8a6a14',
    glow: '#ffd08a',
    hair: '#1b1416',
    hairShade: '#08060a',
  },
  {
    file: 'shield-maiden',
    bg: ['#4d5a6e', '#10151f'],
    metal: 'steel',
    plume: 'sweep',
    c: '#D21A1B',
    d: '#7F1018',
    glow: '#bfe3ff',
    hair: '#c2410c',
    hairShade: '#6b2108',
  },
  {
    file: 'dark-knight',
    bg: ['#1c1f2a', '#030406'],
    metal: 'black',
    plume: 'horns',
    c: '#2a2f3b',
    d: '#0d0f14',
    glow: '#ffffff',
  },
  {
    file: 'iron-hero',
    bg: ['#7a1c24', '#1a0509'],
    metal: 'ruby',
    plume: 'crest',
    c: '#E5B93C',
    d: '#8a6a14',
    glow: '#bff6ff',
  },
  {
    file: 'star-captain',
    bg: ['#2a4a9a', '#0a1236'],
    metal: 'blued',
    plume: 'wings',
    c: '#FFFFFF',
    d: '#aeb6c6',
    glow: '#ffffff',
  },
  {
    file: 'forest-hero',
    bg: ['#2f6b3c', '#0a1e10'],
    metal: 'silver',
    plume: 'sweep',
    c: '#16a34a',
    d: '#0b5a26',
    glow: '#fff3c4',
  },
  {
    file: 'spartan',
    bg: ['#2d4a2a', '#070f07'],
    metal: 'emerald',
    plume: 'crest',
    c: '#d4a017',
    d: '#7a5a0a',
    glow: '#ffd24a',
  },
  {
    file: 'beskar',
    bg: ['#4b4f58', '#0c0d10'],
    metal: 'silver',
    plume: 'crest',
    c: '#6b6f78',
    d: '#30333a',
    glow: '#ff5a3c',
  },
  {
    file: 'sith',
    bg: ['#4a0a10', '#050102'],
    metal: 'black',
    plume: 'horns',
    c: '#E11D2E',
    d: '#6b0a14',
    glow: '#ff2a2a',
  },
  {
    file: 'round-table',
    bg: ['#2a3f7a', '#0a1230'],
    metal: 'gold',
    plume: 'sweep',
    c: '#2563EB',
    d: '#1e3a8a',
    glow: '#fff0b0',
  },
];

export const ALIVE_KNIGHTS = KNIGHTS.slice(0, 6);

function knight({ bg, metal, plume, c, d, glow, hair, hairShade }, animated = false) {
  const [m0, m1, m2, m3] = METAL[metal];
  const motion = animated
    ? `<style>
.plume{transform-box:fill-box;transform-origin:50% 100%;animation:sway 4.6s ease-in-out infinite}
.eye{animation:glow 3.2s ease-in-out infinite}
.lids{transform-box:fill-box;transform-origin:50% 50%;animation:blink 6s ease-in-out infinite}
.head{animation:bob 5s ease-in-out infinite}
@keyframes sway{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(3.5deg)}}
@keyframes glow{0%,100%{opacity:.72}50%{opacity:1}}
@keyframes blink{0%,92%,100%{transform:scaleY(0)}95%{transform:scaleY(1)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.2px)}}
@media (prefers-reduced-motion:reduce){.plume,.eye,.lids,.head{animation:none}}
</style>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -22 132 148" role="img" aria-label="OpsKnight knight avatar">
${motion}
<defs>
<radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
<linearGradient id="cyl" x1="0" x2="1" y1="0" y2="0">
<stop offset="0" stop-color="${m0}"/><stop offset=".18" stop-color="${m1}"/><stop offset=".38" stop-color="${m2}"/><stop offset=".46" stop-color="${m3}"/><stop offset=".62" stop-color="${m1}"/><stop offset="1" stop-color="${m0}"/>
</linearGradient>
<linearGradient id="plate" x1="0" x2="1" y1="0" y2="1">
<stop offset="0" stop-color="${m2}"/><stop offset=".45" stop-color="${m1}"/><stop offset="1" stop-color="${m0}"/>
</linearGradient>
<linearGradient id="dome" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${m3}" stop-opacity=".9"/><stop offset=".5" stop-color="${m2}" stop-opacity=".2"/><stop offset="1" stop-color="${m0}" stop-opacity=".25"/></linearGradient>
<radialGradient id="eye"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${glow}"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>
<rect x="-30" y="-40" width="180" height="200" fill="url(#bg)"/>
<!-- plate shoulders: three overlapping lames each side, riveted -->
<g>
<path fill="url(#plate)" stroke="${m0}" stroke-width="1" d="M-4 128C-4 104 10 92 32 92L52 94L52 128Z"/>
<path fill="url(#plate)" stroke="${m0}" stroke-width="1" d="M124 128C124 104 110 92 88 92L68 94L68 128Z"/>
<path fill="none" stroke="${m3}" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round" d="M4 112C10 100 20 96 34 96"/>
<path fill="none" stroke="${m3}" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round" d="M116 112C110 100 100 96 86 96"/>
<path fill="none" stroke="${m0}" stroke-opacity=".7" stroke-width="1.4" d="M0 116C8 108 22 104 50 105M120 116C112 108 98 104 70 105"/>
<circle cx="18" cy="104" r="1.9" fill="${m3}"/><circle cx="102" cy="104" r="1.9" fill="${m3}"/>
<circle cx="30" cy="100" r="1.9" fill="${m3}"/><circle cx="90" cy="100" r="1.9" fill="${m3}"/>
</g>
<!-- breastplate and gorget -->
<path fill="url(#cyl)" d="M44 90H76L82 126H38Z"/>
<path fill="${c}" d="M56 98H64V126H56Z"/>
<path fill="${d}" d="M60 98H64V126H60Z"/>
<path fill="url(#plate)" d="M34 86C34 92 40 96 60 96C80 96 86 92 86 86L88 92C88 100 76 104 60 104C44 104 32 100 32 92Z"/>
<path fill="none" stroke="${m0}" stroke-opacity=".6" stroke-width="1.2" d="M36 94C46 99 74 99 84 94"/>
${
  hair
    ? `<!-- long hair falling behind the helm and over the pauldrons, with a braid -->
<path fill="${hair}" d="M32 40C14 52 10 90 18 122C26 120 32 108 34 90Z"/><path fill="${hair}" d="M88 40C106 52 110 90 102 122C94 120 88 108 86 90Z"/>
<path fill="${hairShade}" opacity=".55" d="M22 70C20 92 22 108 26 118C30 108 32 96 32 84Z"/><path fill="${hairShade}" opacity=".55" d="M98 70C100 92 98 108 94 118C90 108 88 96 88 84Z"/>`
    : ''
}
<g class="head">
<!-- plume or crest -->
${PLUME[plume](c, d)}
<!-- great helm -->
<path fill="url(#cyl)" stroke="${m0}" stroke-width="1.2" d="M31 30C31 14 44 6 60 6C76 6 89 14 89 30L91 70C91 81 85 88 76 90H44C35 88 29 81 29 70Z"/>
<path fill="url(#dome)" d="M33 28C33 15 45 8 60 8C75 8 87 15 87 28C80 22 70 20 60 20C50 20 40 22 33 28Z"/>
<path fill="${m0}" opacity=".35" d="M58.4 8H61.6V90H58.4Z"/>
<path fill="none" stroke="${m3}" stroke-opacity=".75" stroke-width="2" stroke-linecap="round" d="M36 30C37 20 44 12 54 9"/>
<!-- brow band and lower band, riveted -->
<path fill="url(#plate)" stroke="${m0}" stroke-width=".9" d="M30 31H90V36H30Z"/>
<path fill="url(#plate)" stroke="${m0}" stroke-width=".9" d="M29.5 72H90.5V78H29.5Z"/>
<g fill="${m3}"><circle cx="36" cy="33.5" r="1.1"/><circle cx="48" cy="33.5" r="1.1"/><circle cx="60" cy="33.5" r="1.1"/><circle cx="72" cy="33.5" r="1.1"/><circle cx="84" cy="33.5" r="1.1"/><circle cx="37" cy="75" r="1.1"/><circle cx="60" cy="75" r="1.1"/><circle cx="83" cy="75" r="1.1"/></g>
<!-- visor slit and the cross slit below it -->
<path fill="#06080c" d="M33 41H87L86 49H34Z"/>
<path fill="#06080c" d="M57.5 49H62.5V66C62.5 67.4 61.4 68.5 60 68.5C58.6 68.5 57.5 67.4 57.5 66Z"/>
<path fill="none" stroke="${m0}" stroke-opacity=".8" stroke-width="1" d="M33 41H87M34 49H86"/>
<!-- glowing eyes behind the slit -->
<g class="eye">
<ellipse cx="46" cy="45" rx="9" ry="5" fill="url(#eye)" filter="url(#soft)"/><ellipse cx="74" cy="45" rx="9" ry="5" fill="url(#eye)" filter="url(#soft)"/>
<ellipse cx="46" cy="45" rx="4.2" ry="2.2" fill="${glow}"/><ellipse cx="74" cy="45" rx="4.2" ry="2.2" fill="${glow}"/>
<ellipse cx="46" cy="44.6" rx="2" ry="1" fill="#fff"/><ellipse cx="74" cy="44.6" rx="2" ry="1" fill="#fff"/>
</g>
<rect class="lids" x="33" y="41" width="54" height="8" fill="#06080c"/>
<!-- breath holes -->
<g fill="#06080c"><circle cx="73" cy="55" r="1.4"/><circle cx="79" cy="55" r="1.4"/><circle cx="73" cy="60" r="1.4"/><circle cx="79" cy="60" r="1.4"/><circle cx="73" cy="65" r="1.4"/><circle cx="79" cy="65" r="1.4"/><circle cx="46" cy="55" r="1.4"/><circle cx="41" cy="55" r="1.4"/><circle cx="46" cy="60" r="1.4"/><circle cx="41" cy="60" r="1.4"/><circle cx="46" cy="65" r="1.4"/><circle cx="41" cy="65" r="1.4"/></g>
<!-- emblem on the brow: a small cross -->
<path fill="${c}" d="M58.6 11H61.4V19H65V21.6H61.4V28H58.6V21.6H55V19H58.6Z" opacity=".95"/>
</g>
</svg>
`;
}

/* ───────────────────────────── write ───────────────────────────── */

const write = (dir, file, svg) => {
  const target = join(root, 'public/avatars', dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${file}.svg`), svg);
};
for (const variant of SQUIRE) write('squire', variant.file, squire(variant));
for (const variant of KNIGHTS) write('knight', variant.file, knight(variant));
console.log(`Wrote ${SQUIRE.length} Squire and ${KNIGHTS.length} knight avatars to public/avatars`);
