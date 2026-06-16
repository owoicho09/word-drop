/**
 * wordValidator.js
 *
 * Builds a Trie from the pre-filtered dictionary (words_3to6.txt) and
 * exposes fast O(L) word validation. The dictionary is fetched lazily
 * while the user is on the home screen; isReady() lets callers check
 * before the game starts.
 *
 * The Trie is also used by gridGenerator's quality solver to count all
 * findable words on a finished board — prefix pruning makes this fast
 * even over 36 starting cells × 8 directions.
 */

class TrieNode {
  constructor() {
    // Map<string, TrieNode>
    this.children = new Map();
    this.isEnd = false;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(word) {
    let node = this.root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch);
    }
    node.isEnd = true;
  }

  /** Returns true if `word` is an exact dictionary entry. */
  has(word) {
    let node = this.root;
    for (const ch of word) {
      node = node.children.get(ch);
      if (!node) return false;
    }
    return node.isEnd;
  }

  /** Returns the node at the end of `prefix`, or null if no such prefix exists.
   *  Used by the grid solver to prune dead branches without re-walking from root. */
  nodeAt(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return null;
    }
    return node;
  }
}

// ── Singleton state ───────────────────────────────────────────────────────────

const trie = new Trie();
let _ready = false;
let _loadPromise = null;

// Pre-computed valid-word set for the active game, produced by solveGrid()
// before Phaser starts.  Combines dictionary words AND seeded proper nouns.
const _validWordSet = new Set();

// Legacy fallback — populated by setSessionWords() when the pre-computed set
// hasn't been set yet (shouldn't happen in normal flow after this refactor).
const _sessionWords = new Set();

// ── Public API ────────────────────────────────────────────────────────────────

export const wordValidator = {
  /**
   * Begins fetching and parsing the filtered dictionary.
   * Call this as early as possible (home screen load).
   * Safe to call multiple times — only fetches once.
   *
   * @returns {Promise<void>}
   */
  load() {
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch('/public/dictionary/words_3to6.txt')
      .then(r => {
        if (!r.ok) throw new Error(`Dictionary fetch failed: ${r.status}`);
        return r.text();
      })
      .then(text => {
        const lines = text.split('\n');
        for (const line of lines) {
          const word = line.trim().toUpperCase();
          if (word.length >= 3 && word.length <= 6) trie.insert(word);
        }
        _ready = true;
      })
      .catch(err => {
        console.error('[WordDrop] Dictionary load error:', err);
        // Allow the game to proceed; validation will fall back to sessionWords only
        _ready = true;
      });
    return _loadPromise;
  },

  /** True once the Trie is fully built. */
  isReady() {
    return _ready;
  },

  /**
   * Set the pre-computed word universe for the active game.
   * Pass the Set returned by solveGrid() — it already includes both
   * dictionary words and seeded proper nouns.
   * Must be called before the first trace can be validated.
   *
   * @param {Set<string>} wordSet  All traceable words on this board (uppercase)
   */
  setValidWords(wordSet) {
    _validWordSet.clear();
    for (const w of wordSet) _validWordSet.add(w.toUpperCase());
  },

  /** @deprecated Use setValidWords() instead. Kept for safety. */
  setSessionWords(words) {
    _sessionWords.clear();
    for (const w of words) _sessionWords.add(w.toUpperCase());
  },

  /**
   * Returns true if `word` is valid for scoring on the current board.
   * Checks the pre-computed word set first (most accurate).
   * Falls back to Trie + session words if setValidWords() wasn't called.
   *
   * @param {string} word
   */
  isValid(word) {
    const w = word.toUpperCase();
    if (_validWordSet.size > 0) return _validWordSet.has(w);
    return _sessionWords.has(w) || trie.has(w);
  },

  /**
   * Exposes the Trie root so gridGenerator's solver can traverse it
   * directly without calling isValid() on every candidate string.
   */
  get trieRoot() {
    return trie.root;
  },
};
