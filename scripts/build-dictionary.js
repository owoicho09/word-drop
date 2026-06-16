#!/usr/bin/env node
/**
 * scripts/build-dictionary.js
 *
 * Pre-filters the raw dwyl words_alpha.txt to only 3-6 letter words,
 * then writes public/dictionary/words_3to6.txt.
 *
 * Run once after downloading words_alpha.txt, or add to your CI pipeline:
 *   node scripts/build-dictionary.js
 *
 * Input:  public/dictionary/words_alpha.txt   (~4 MB, ~370k words)
 * Output: public/dictionary/words_3to6.txt    (~200 KB, ~40k words)
 *
 * Vercel auto-gzips text responses, so the browser receives ~60-80 KB
 * over the wire — appropriate for mobile connections.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const inputPath  = resolve(root, 'public/dictionary/words_alpha.txt');
const outputPath = resolve(root, 'public/dictionary/words_3to6.txt');

console.log('Reading words_alpha.txt...');
const raw = readFileSync(inputPath, 'utf8');
const lines = raw.split('\n');

const filtered = lines
  .map(l => l.trim().toLowerCase())
  .filter(w => {
    if (w.length < 3 || w.length > 6) return false;
    // Keep only pure alpha words (no hyphens, apostrophes, digits)
    return /^[a-z]+$/.test(w);
  });

// Deduplicate and sort (sorted output compresses better)
const unique = [...new Set(filtered)].sort();

writeFileSync(outputPath, unique.join('\n'), 'utf8');

console.log(`Done. ${lines.length.toLocaleString()} input words → ` +
  `${unique.length.toLocaleString()} output words (3-6 letters).`);
console.log(`Wrote: ${outputPath}`);
