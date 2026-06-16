/**
 * gridGenerator.js
 *
 * Core grid generation engine for WordDrop.
 *
 * Phases:
 *   1. Filter & shuffle candidate words from the chosen category, biased by
 *      difficulty toward short (easy) or long (hard) words (longest-first
 *      within that pool, since longer words need the most room).
 *   2. Place each word into the 7×7 grid by enumerating every legal start
 *      cell per direction directly (no random retries), trying directions
 *      in an order that balances usage across all 8 evenly — with a
 *      difficulty-driven head-start for diagonals (more on hard, less on
 *      easy). Shared cells are allowed when the letter matches exactly
 *      (natural crossword intersections). Word count is difficulty-driven
 *      (DIFFICULTY_SETTINGS.wordCount).
 *   3. Fill every remaining cell with a frequency-weighted random letter.
 *      Difficulty 'hard' uses a skewed weight table that mimics consonant
 *      clusters, making the filler more deceptive.
 *   4. Sanity-check every possible path for badwords; retry up to
 *      MAX_REGEN_ATTEMPTS times if any are found.
 *   5. Quality guard: run a full Trie-based solver over the finished board
 *      and reject grids with fewer than the difficulty's quality threshold
 *      (QUALITY_THRESHOLDS) findable words. If all attempts fail, fall back
 *      to an unchecked grid and log a warning.
 *
 * Randomness is driven by a seeded mulberry32 PRNG so that grids stored in
 * Supabase can be reproduced identically on any device given the same seed.
 */

import { getWords } from '../../data/words/index.js';
import { LETTER_WEIGHTS, HARD_LETTER_WEIGHTS } from '../../data/letterFrequency.js';
import { BADWORDS } from '../../data/badwords.js';
import { wordValidator } from './wordValidator.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const GRID_SIZE = 7;
const MIN_WORD_LEN = 3;
const MAX_WORD_LEN = 6;
const CANDIDATE_POOL = 40;   // words sampled from the category list before placement
const MAX_REGEN_ATTEMPTS = 5;

// Per-difficulty tuning:
//   wordCount  — how many words get seeded onto the board (fewer = roomier/easier)
//   shortBias  — probability of preferring a 3-4 letter word over a 5-6 letter
//                one when building the candidate pool (higher = easier to spot)
//   diagBonus  — priority head-start given to diagonal directions during
//                placement, on top of the even-balance baseline (higher =
//                more diagonals, which are harder for the eye to catch)
const DIFFICULTY_SETTINGS = {
  easy:   { wordCount: 8,  shortBias: 0.75, diagBonus: -0.1 },
  normal: { wordCount: 10, shortBias: 0.5,  diagBonus: 0.2 },
  hard:   { wordCount: 12, shortBias: 0.25, diagBonus: 0.9 },
};

function difficultySettings(difficulty) {
  return DIFFICULTY_SETTINGS[difficulty] ?? DIFFICULTY_SETTINGS.normal;
}

// Minimum findable words (seeded proper nouns + dictionary filler) per board.
// 7×7 gives 49 cells. Easy seeds fewer words, so its floor is lower; hard
// keeps the original floor since it seeds the most.
const QUALITY_THRESHOLDS = { easy: 28, normal: 32, hard: 35 };

// All 8 directions as [rowDelta, colDelta]
const DIRECTIONS = [
  [0,  1],   // →  right
  [0, -1],   // ←  left
  [1,  0],   // ↓  down
  [-1, 0],   // ↑  up
  [1,  1],   // ↘  diagonal down-right
  [1, -1],   // ↙  diagonal down-left
  [-1, 1],   // ↗  diagonal up-right
  [-1,-1],   // ↖  diagonal up-left
];

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
// Produces deterministic float sequences from a 32-bit integer seed.
// Identical seed → identical grid on any device.

function makePrng(seed) {
  let s = seed >>> 0; // coerce to unsigned 32-bit
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Fisher-Yates shuffle (uses provided RNG for reproducibility) ──────────────

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Weighted random letter sampler ────────────────────────────────────────────

function buildSampler(weightMap) {
  const letters = [];
  const thresholds = [];
  let total = 0;
  for (const [letter, weight] of Object.entries(weightMap)) {
    total += weight;
    letters.push(letter);
    thresholds.push(total);
  }
  return function sample(rng) {
    const r = rng() * total;
    for (let i = 0; i < thresholds.length; i++) {
      if (r <= thresholds[i]) return letters[i];
    }
    return letters[letters.length - 1];
  };
}

// ── Placement helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if `word` fits starting at (row, col) in direction [dr, dc]
 * without leaving the grid boundaries or conflicting with existing letters.
 * A cell already containing the same letter is allowed (crossword intersection).
 */
function canPlace(word, row, col, dr, dc, grid) {
  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr;
    const c = col + i * dc;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
    const existing = grid[r][c];
    if (existing !== null && existing !== word[i]) return false;
  }
  return true;
}

/**
 * Writes `word` into `grid` starting at (row, col) in direction [dr, dc].
 * Returns the array of {r, c} cell coordinates used.
 */
function doPlace(word, row, col, dr, dc, grid) {
  const cells = [];
  for (let i = 0; i < word.length; i++) {
    const r = row + i * dr;
    const c = col + i * dc;
    grid[r][c] = word[i];
    cells.push({ r, c });
  }
  return cells;
}

/**
 * Returns every (row, col) start cell from which `word` could fit in
 * direction [dr, dc] without running off the grid (ignores letter collisions
 * — canPlace() filters those out separately). Used to pick placements by
 * direct enumeration instead of random retries, so direction choice isn't
 * skewed by how much room each direction happens to have.
 */
function startsInBounds(len, dr, dc) {
  let rMin = 0, rMax = GRID_SIZE - 1;
  let cMin = 0, cMax = GRID_SIZE - 1;
  if (dr === 1)  rMax = GRID_SIZE - len;
  if (dr === -1) rMin = len - 1;
  if (dc === 1)  cMax = GRID_SIZE - len;
  if (dc === -1) cMin = len - 1;

  const starts = [];
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      starts.push({ row: r, col: c });
    }
  }
  return starts;
}

// ── Sanity check ──────────────────────────────────────────────────────────────

/**
 * Scans every possible path on the completed grid for entries in BADWORDS.
 * Returns true if any offensive word is found.
 */
function containsBadWord(grid) {
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      for (const [dr, dc] of DIRECTIONS) {
        let word = '';
        for (let len = 1; len <= MAX_WORD_LEN; len++) {
          const r = row + (len - 1) * dr;
          const c = col + (len - 1) * dc;
          if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) break;
          word += grid[r][c];
          if (len >= MIN_WORD_LEN && BADWORDS.has(word)) return true;
        }
      }
    }
  }
  return false;
}

// ── Board solver ──────────────────────────────────────────────────────────────

/**
 * Finds every traceable word on the board, checking both the dictionary Trie
 * and a Set of seeded proper nouns that may not be in the dictionary.
 *
 * Algorithm: for each starting cell × each of 8 directions, walk up to 6
 * steps.  The Trie pointer advances along dictionary prefixes; when it goes
 * null we lose dictionary pruning but keep walking so seeded words (e.g.
 * SUYA, ENUGU) are still caught.  Each step records a match if the
 * accumulated string ends a Trie word OR is in the seeded set.
 *
 * @param {string[][]} grid         6×6 char array (uppercase)
 * @param {string[]}   seededWords  Words placed on the board (from hiddenWords)
 * @returns {Set<string>}           All valid words findable on this board
 */
export function solveGrid(grid, seededWords) {
  const seededSet = new Set(seededWords.map(w => w.toUpperCase()));
  const found = new Set();
  const root = wordValidator.trieRoot;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      for (const [dr, dc] of DIRECTIONS) {
        let node = root; // may go null once we exhaust a Trie prefix
        let word = '';

        for (let len = 1; len <= MAX_WORD_LEN; len++) {
          const r = row + (len - 1) * dr;
          const c = col + (len - 1) * dc;
          if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) break;

          const letter = grid[r][c];
          word += letter;

          // Advance Trie (null once no dictionary prefix matches)
          if (node) node = node.children.get(letter) ?? null;

          if (len >= MIN_WORD_LEN) {
            const inDict   = node !== null && node.isEnd;
            const isSeeded = seededSet.has(word);
            if (inDict || isSeeded) found.add(word);
          }
        }
      }
    }
  }
  return found;
}

// ── Core generation ───────────────────────────────────────────────────────────

/**
 * Attempts one full generation cycle with a specific seed.
 * Returns { grid, hiddenWords, seed, wordCount } on success, or null if the
 * grid fails the sanity check or quality guard.
 *
 * @param {string} category
 * @param {string} difficulty  'easy' | 'normal' | 'hard'
 * @param {number} seed
 * @param {boolean} skipQualityCheck  set true for the unchecked fallback
 */
function attemptGeneration(category, difficulty, seed, skipQualityCheck = false) {
  const rng = makePrng(seed);
  const { wordCount, shortBias, diagBonus } = difficultySettings(difficulty);
  const weights = difficulty === 'hard' ? HARD_LETTER_WEIGHTS : LETTER_WEIGHTS;
  const sampleLetter = buildSampler(weights);

  // ── Phase 1: candidate pool ────────────────────────────────────────────────
  // Split into short (3-4) and long (5-6) pools, then interleave by a
  // difficulty-driven coin flip so easy skews short/scannable and hard skews
  // long/harder-to-trace, while normal stays an even mix.
  const categoryWords = getWords(category)
    .filter(w => w.length >= MIN_WORD_LEN && w.length <= MAX_WORD_LEN);
  const shortPool = shuffle(categoryWords.filter(w => w.length <= 4), rng);
  const longPool  = shuffle(categoryWords.filter(w => w.length >= 5), rng);

  const candidates = [];
  let si = 0, li = 0;
  while (candidates.length < CANDIDATE_POOL && (si < shortPool.length || li < longPool.length)) {
    const wantShort = rng() < shortBias;
    if (wantShort && si < shortPool.length)      candidates.push(shortPool[si++]);
    else if (!wantShort && li < longPool.length)  candidates.push(longPool[li++]);
    else if (si < shortPool.length)               candidates.push(shortPool[si++]);
    else if (li < longPool.length)                candidates.push(longPool[li++]);
  }

  // The first `wordCount` candidates already reflect the difficulty's
  // short/long ratio (each was drawn with that probability) — these are the
  // actual target words. Only THIS subset gets sorted longest-first, since
  // longer words need the most room and should claim it while the board is
  // emptiest; the rest of the pool stays in its original biased order as a
  // backup if any primary pick fails to fit. Sorting the *entire* pool
  // before truncating to wordCount would always select the overall longest
  // words regardless of difficulty, silently erasing the short/long bias.
  const primary = candidates.slice(0, wordCount).sort((a, b) => b.length - a.length);
  const backup  = candidates.slice(wordCount);
  const placementOrder = [...primary, ...backup];

  // ── Phase 2: placement ────────────────────────────────────────────────────
  // Direction choice is balanced rather than randomly resampled: each word
  // tries directions in an order biased toward whichever directions have
  // been used least so far (with rng tie-breaking), and for each direction
  // every legal start cell is enumerated directly rather than hoping a
  // random (row, col) happens to fit. This stops diagonals — which have a
  // smaller pool of legal start cells for longer words — from losing out to
  // horizontal/vertical placements purely because they're statistically
  // easier to land on by chance.
  const grid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));
  const hiddenWords = [];
  const dirUsage = new Array(DIRECTIONS.length).fill(0);

  for (const word of placementOrder) {
    if (hiddenWords.length >= wordCount) break;

    // Diagonals have inherently fewer legal start cells than straight rows/
    // columns in a square grid (the available start region shrinks with the
    // square of the word length instead of linearly), so they get a flat
    // priority head-start to compensate — otherwise pure usage-balancing
    // still under-places them simply because they keep running out of room.
    // diagBonus also lets difficulty lean the baseline slightly toward
    // straight (easy) or diagonal (hard) placements without collapsing it.
    const isDiagonal = (i) => i >= 4;
    const dirOrder = DIRECTIONS
      .map((dir, i) => ({ i, dir, key: dirUsage[i] - (isDiagonal(i) ? diagBonus : 0) + rng() }))
      .sort((a, b) => a.key - b.key);

    let placement = null;

    for (const { i, dir } of dirOrder) {
      const [dr, dc] = dir;
      const starts = shuffle(startsInBounds(word.length, dr, dc), rng);
      const start = starts.find(({ row, col }) => canPlace(word, row, col, dr, dc, grid));
      if (start) { placement = { dirIndex: i, dir, ...start }; break; }
    }

    if (placement) {
      const { dirIndex, dir: [dr, dc], row, col } = placement;
      const cells = doPlace(word, row, col, dr, dc, grid);
      hiddenWords.push({ word, row, col, direction: [dr, dc], cells });
      dirUsage[dirIndex]++;
    }
    // If no direction has room left for this word, skip it and try the next candidate.
  }

  // ── Phase 3: fill empty cells ─────────────────────────────────────────────
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === null) grid[r][c] = sampleLetter(rng);
    }
  }

  // ── Phase 4: sanity check ─────────────────────────────────────────────────
  if (containsBadWord(grid)) return null;

  // ── Phase 5: quality guard ────────────────────────────────────────────────
  // Run the full solver (dict + seeded words) and reject thin boards.
  // Skipped only when the validator isn't ready or this is an unchecked replay.
  let allWords = null;
  if (!skipQualityCheck && wordValidator.isReady()) {
    allWords = solveGrid(grid, hiddenWords.map(h => h.word));
    const threshold = QUALITY_THRESHOLDS[difficulty] ?? QUALITY_THRESHOLDS.normal;
    if (allWords.size < threshold) return null;
  }

  return { grid, hiddenWords, seed, allWords };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a playable 6×6 WordDrop grid.
 *
 * @param {string} category    Category id ('animals', 'food', 'random', etc.)
 * @param {string} difficulty  'easy' | 'normal' | 'hard'
 * @param {number} [forcedSeed] Supply to reproduce a specific stored grid.
 *                              When undefined, a random seed is generated.
 *
 * @returns {{
 *   grid:        string[][]      6×6 uppercase char array
 *   hiddenWords: Array<{word, row, col, direction, cells}>
 *   seed:        number          Store this to reproduce the grid later
 *   allWords:    Set<string>|null  All findable words on the board (null if quality check was skipped)
 * }}
 */
export function generateGrid(category, difficulty, forcedSeed) {
  // When replaying a stored session, use the exact seed — quality guard is skipped
  // because the grid was already validated when it was first created.
  if (forcedSeed !== undefined) {
    const result = attemptGeneration(category, difficulty, forcedSeed, true);
    if (result) return result;
    // The forced seed should always succeed (no bad-word retry on replays)
    throw new Error(`[WordDrop] Failed to reproduce grid for seed ${forcedSeed}`);
  }

  // Fresh grid: try up to MAX_REGEN_ATTEMPTS different seeds
  for (let i = 0; i < MAX_REGEN_ATTEMPTS; i++) {
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const result = attemptGeneration(category, difficulty, seed);
    if (result) return result;
  }

  // All attempts failed the quality guard or sanity check.
  // Fall back to an unchecked grid rather than leaving the player with nothing.
  console.warn(
    `[WordDrop] Quality threshold (${QUALITY_THRESHOLDS[difficulty] ?? QUALITY_THRESHOLDS.normal}) ` +
    `not met after ${MAX_REGEN_ATTEMPTS} attempts for category="${category}". Using fallback.`
  );
  const fallbackSeed = (Math.random() * 0xFFFFFFFF) >>> 0;
  return attemptGeneration(category, difficulty, fallbackSeed, true)
    ?? (() => { throw new Error('[WordDrop] Fallback generation failed unexpectedly'); })();
}

/**
 * Validates that a player's traced path forms a straight line in one of the
 * 8 directions. The cells array comes directly from pointer-event tracking
 * in GameScene — this does not re-check the dictionary.
 *
 * @param {{ r: number, c: number }[]} cells - Ordered path cells
 * @returns {boolean}
 */
export function isValidPath(cells) {
  if (cells.length < MIN_WORD_LEN) return false;
  const dr = cells[1].r - cells[0].r;
  const dc = cells[1].c - cells[0].c;

  // Direction must be one of the 8 unit vectors
  if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return false;
  if (dr === 0 && dc === 0) return false;

  for (let i = 1; i < cells.length; i++) {
    if (cells[i].r - cells[i - 1].r !== dr) return false;
    if (cells[i].c - cells[i - 1].c !== dc) return false;
  }
  return true;
}
