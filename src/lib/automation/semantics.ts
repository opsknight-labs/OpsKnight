import type { Truth } from './contract';
export const not = (truth: Truth): Truth =>
  truth === 'UNKNOWN' ? 'UNKNOWN' : truth === 'TRUE' ? 'FALSE' : 'TRUE';
export const and = (terms: Truth[]): Truth =>
  terms.includes('FALSE') ? 'FALSE' : terms.includes('UNKNOWN') ? 'UNKNOWN' : 'TRUE';
