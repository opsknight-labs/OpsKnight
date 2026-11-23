/**
 * Squire's voice: playful when things are calm, short and plain while a high-urgency incident is open or an
 * answer is being worked on. Answers themselves are never dressed up; only the words around them are.
 */
export type Tone = 'calm' | 'crisp';

/** One line per seed, so the text stays put across re-renders and changes only when the seed does. */
export function pickLine(lines: readonly string[], seed: number): string {
  return lines[Math.abs(Math.trunc(seed)) % lines.length] ?? lines[0] ?? '';
}

/** "⌘J" on Apple devices, "Ctrl+J" elsewhere. */
export function shortcutLabel(): string {
  const mac =
    typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(window.navigator.platform || '');
  return mac ? '⌘J' : 'Ctrl+J';
}

const PENDING = [
  'On it…',
  'Gathering the facts…',
  'Checking the watchtower…',
  'Pulling the threads…',
];

/** Shown while an answer has no activity of its own to report yet. */
export function pendingLine(tone: Tone, seed: number): string {
  return tone === 'crisp' ? 'Investigating…' : pickLine(PENDING, seed);
}

function dayPart(hour: number): string {
  if (hour < 5) return 'Still on watch';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Still on watch';
}

/** The empty chat's headline. */
export function emptyHeadline(tone: Tone, hour: number, firstName?: string | null): string {
  if (tone === 'crisp') return 'What are we investigating?';
  const name = firstName?.trim();
  return `${dayPart(hour)}${name ? `, ${name}` : ''}. What shall we look into?`;
}

/** A small tip under the empty chat's headline; calm only. */
export function emptyTip(seed: number, shortcut: string): string {
  return pickLine(
    [
      'Psst: type / for quick commands.',
      `${shortcut} opens me from any page.`,
      'Ask about a service and I will name its owner and who is on call.',
      'Close me mid-answer and I will wave when it is ready.',
    ],
    seed
  );
}

/** The first-visit introduction; each question is one basic mode answers, asked in one click. */
export function intro(name: string) {
  return {
    title: `Hi, I'm ${name}.`,
    text: 'Ask about incidents, on-call and recent changes. I answer from your OpsKnight data.',
    asks: ['What is on fire right now?', 'Who is on call?', 'Show recent changes'],
  };
}

export function answerReadyLine(tone: Tone): string {
  return tone === 'crisp' ? 'Answer ready' : 'Your answer is ready.';
}

/** Idle and greeting labels get a little character when calm; everything else stays plain. */
export function presenceLabel(state: string, label: string, tone: Tone): string {
  if (tone === 'crisp') return label;
  if (state === 'idle') return 'At your service';
  if (state === 'greeting') return 'Reporting for duty';
  return label;
}

/** "1h 30m", "45m", "under a minute". */
export function formatLead(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
