import { ALL_FACTORS, type FactorType } from './ContributingFactorsSelector';
import type { FiveWhysStep } from './FiveWhysBuilder';

// The editor stores five whys inside rootCause as `Why #n: <question> - <answer>`.
// The question is lazy, so the first ` -` is taken as the separator and answers may contain dashes.
const SERIALIZED_WHY = /^why\s*#\d+:\s?(.*?)(?:\s-(?:\s(.*))?)?$/i;

export function formatFiveWhys(steps: FiveWhysStep[]): string {
  return steps
    .map((s, idx) => `Why #${idx + 1}: ${s.question.trim()} - ${s.answer.trim()}`)
    .join('\n');
}

/** Parse 5-whys steps from stored root cause text (the inverse of the editor's serializer). */
export function parseStoredFiveWhys(rawRootCause?: string | null): FiveWhysStep[] {
  if (!rawRootCause) return [];
  const lines = rawRootCause.split('\n').filter(l => l.trim().length > 0);
  const whyLines = lines.filter(l => /^(why\s*#?\d*|why:|\d+\.\s*why)/i.test(l.trim()));

  return whyLines.map((line, idx) => {
    const id = `why-${idx + 1}-${Date.now()}`;
    const serialized = line.trim().match(SERIALIZED_WHY);
    if (serialized)
      return { id, question: (serialized[1] ?? '').trim(), answer: (serialized[2] ?? '').trim() };
    const parts = line.split(/:\s*|\s*-\s*|\s*➔\s*/);
    return {
      id,
      question: parts[0]?.trim() || `Why #${idx + 1}`,
      answer: parts.slice(1).join(': ').trim() || '',
    };
  });
}

/** Factors the author explicitly chose, read from the `[Contributing Factors: ...]` tag. */
export function parseStoredFactors(rawRootCause?: string | null): FactorType[] {
  const match = rawRootCause?.match(/\[Contributing Factors:\s*([^\]]+)\]/i);
  if (!match?.[1]) return [];
  const factorNames = match[1].split(',').map(s => s.trim().toUpperCase());
  return ALL_FACTORS.filter(
    f => factorNames.includes(f) || factorNames.includes(f.replace('_', ' '))
  );
}
