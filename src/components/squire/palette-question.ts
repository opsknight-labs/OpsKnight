/**
 * The command palette's "Ask <assistant>" entry: when it is offered for a typed query, and which part
 * of that query is the question to hand over.
 */
const TRIGGERS = ['ask', 'assistant', 'ai', 'help'];
const TOKEN_SPLIT = /[^\p{L}\p{N}_]+/u;
const QUESTION_START =
  /^(?:who|what|why|when|where|which|how|is|are|was|were|did|does|do|can|could|should|show|list|summari[sz]e|explain)\b/i;
const MAX_QUESTION = 2000;

const nameTokens = (assistantName: string) =>
  assistantName.toLowerCase().split(/\s+/).filter(Boolean);

/** True when the query addresses the assistant by name or keyword, or reads as a question. */
export function queryAddressesAssistant(query: string, assistantName: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return false;
  const triggers = [...TRIGGERS, ...nameTokens(assistantName)];
  if (q.split(TOKEN_SPLIT).some(token => triggers.includes(token))) return true;
  return q.endsWith('?') || (QUESTION_START.test(q) && q.split(/\s+/).length >= 3);
}

/**
 * The question in a palette query, without the words that only address the assistant ("ask pip, why
 * is checkout failing?" gives "why is checkout failing?"). Undefined when nothing is left to ask, in
 * which case the palette just opens the panel.
 */
export function questionFromPaletteQuery(query: string, assistantName: string): string | undefined {
  const address = new Set(['ask', 'assistant', 'ai', ...nameTokens(assistantName)]);
  const words = query.trim().split(/\s+/);
  while (words.length && address.has(words[0].toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '')))
    words.shift();
  const question = words.join(' ').trim().slice(0, MAX_QUESTION);
  // One leftover word that is itself only a trigger ("help") is still a valid thing to ask.
  return question.replace(/[^\p{L}\p{N}]+/gu, '').length >= 2 ? question : undefined;
}
