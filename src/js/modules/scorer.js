/**
 * scorer.js — pure scoring logic, no external dependencies.
 * Kept in its own module so the point table is trivial to tune.
 */

const SCORE_TABLE = {
  3: 10,
  4: 20,
  5: 40,
};

/** Returns the point value for a single found word. */
export function scoreWord(word) {
  return SCORE_TABLE[word.length] ?? 60; // 6+ letters
}

/** Sums scoreWord() over an array of word strings. */
export function totalScore(words) {
  return words.reduce((sum, w) => sum + scoreWord(w), 0);
}
