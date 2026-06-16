/**
 * game.js — bootstraps Phaser on game.html, wires the HTML shell to scene events,
 * and coordinates session creation, score submission, sharing, and streak updates.
 */

import { wordValidator }           from './modules/wordValidator.js';
import { generateGrid, solveGrid } from './modules/gridGenerator.js';
import { CATEGORY_IDS }            from '../data/words/index.js';
import { sessionManager }  from './modules/sessionManager.js';
import { leaderboard }     from './modules/leaderboard.js';
import { shareManager }    from './modules/shareManager.js';
import { streakManager }   from './modules/streakManager.js';
import { GameScene }       from './scenes/GameScene.js';
import { getPlayerProfile } from './onboarding.js';
import { auth } from './auth.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const TIMERS = { easy: 120, normal: 120, hard: 120 };

const CATEGORY_LABELS = {
  animals: 'Animals', countries: 'Countries', names: 'Names',
  general: 'General', food: 'Food & Drinks', sports: 'Sports',
  cities:  'Cities',
};

const CATEGORY_COLORS = {
  animals: '#16a34a', countries: '#0284c7', names: '#7c3aed',
  general: '#6366f1', food: '#dc2626',    sports: '#ea580c',
  cities:  '#0891b2',
};

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── DOM refs ───────────────────────────────────────────────────────────────────

const scoreEl         = document.getElementById('score');
const wordCountEl     = document.getElementById('word-count');
const timerTextEl     = document.getElementById('timer-text');
const timerFillEl     = document.getElementById('timer-fill');
const categoryLabelEl = document.getElementById('category-label');
const categoryChipEl  = document.getElementById('category-chip');
const hintBtn         = document.getElementById('hint-btn');
const muteBtn         = document.getElementById('mute-btn');
const muteIconOn      = document.getElementById('mute-icon-on');
const muteIconOff     = document.getElementById('mute-icon-off');
const comboBadge      = document.getElementById('combo-badge');
const comboCount      = document.getElementById('combo-count');
const foundWordsTray  = document.getElementById('found-words');
const shareDuringBtn  = document.getElementById('share-during-btn');
const resultOverlay   = document.getElementById('result-overlay');
const finalScoreEl    = document.getElementById('final-score');
const resultWordsEl   = document.getElementById('result-words-found');
const shareBtn        = document.getElementById('share-btn');
const playAgainBtn    = document.getElementById('play-again-btn');
const lbList          = document.getElementById('leaderboard-list');
const lbSection       = document.getElementById('result-leaderboard');
const shareCopy       = document.getElementById('share-copy-feedback');

// ── Mute button ────────────────────────────────────────────────────────────────

function initMute() {
  const stored = localStorage.getItem('worddrop_muted') === '1';
  window._wdMuted = stored;
  applyMuteUI(stored);

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      window._wdMuted = !window._wdMuted;
      localStorage.setItem('worddrop_muted', window._wdMuted ? '1' : '0');
      applyMuteUI(window._wdMuted);
    });
  }
}

function applyMuteUI(muted) {
  if (!muteBtn) return;
  muteBtn.classList.toggle('muted', muted);
  if (muteIconOn)  muteIconOn.style.display  = muted ? 'none'  : '';
  if (muteIconOff) muteIconOff.style.display = muted ? ''      : 'none';
  muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

async function boot() {
  wordValidator.load();
  initMute();

  let player = getPlayerProfile();
  if (!player) {
    const serverUser = await auth.getCurrentUser().catch(() => null);
    if (serverUser) {
      player = {
        isGuest:     false,
        userId:      serverUser.id,
        displayName: serverUser.display_name,
        email:       serverUser.email,
      };
      sessionStorage.setItem('worddrop_player', JSON.stringify(player));
    } else {
      const fwd = new URLSearchParams(window.location.search);
      window.location.href = `/${fwd.toString() ? '?' + fwd : ''}`;
      return;
    }
  }

  const params    = new URLSearchParams(window.location.search);
  const sharedSid = shareManager.parseSessionFromURL();
  const isShared  = Boolean(sharedSid);

  const rawCat   = params.get('cat') || sessionStorage.getItem('worddrop_pending_cat') || 'general';
  const paramCat = CATEGORY_IDS.includes(rawCat) ? rawCat : 'general';
  sessionStorage.removeItem('worddrop_pending_cat');

  const paramDiff = params.get('diff') || 'normal';

  let grid, hiddenWords, seed, sessionId = null, allWords;
  let category   = paramCat;
  let difficulty = paramDiff;

  if (isShared) {
    const session = await sessionManager.fetchSession(sharedSid);
    if (!session) { window.location.href = '/expired.html'; return; }
    grid        = session.grid;
    hiddenWords = session.hidden_words;
    seed        = session.seed;
    sessionId   = session.session_id;
    category    = session.category;
    difficulty  = session.difficulty;

    await wordValidator.load();
    allWords = solveGrid(grid, hiddenWords.map(h => h.word));
  } else {
    await wordValidator.load();
    const result = generateGrid(category, difficulty);
    grid        = result.grid;
    hiddenWords = result.hiddenWords;
    seed        = result.seed;
    allWords    = result.allWords ?? solveGrid(grid, hiddenWords.map(h => h.word));

    if (!player.isGuest) {
      try {
        sessionId = await sessionManager.createSession({
          grid, hiddenWords, category, difficulty, seed,
        });
      } catch (err) {
        console.error('[WordDrop] Session create failed:', err);
      }
    }
  }

  wordValidator.setValidWords(allWords);

  if (categoryChipEl)  categoryChipEl.style.background  = CATEGORY_COLORS[category] ?? '#7c3aed';
  if (categoryLabelEl) categoryLabelEl.textContent = CATEGORY_LABELS[category] ?? category;

  const timerSeconds = TIMERS[difficulty] ?? 120;

  if (!player.isGuest && sessionId) {
    shareDuringBtn.classList.remove('hidden');
    shareDuringBtn.addEventListener('click', () => handleShare(sessionId));
  }

  window.GAME_DATA = {
    grid, hiddenWords, timerSeconds, sessionId,
    isGuest: player.isGuest,
    category, difficulty, allWords,
  };

  const canvasW = Math.min(window.innerWidth, 480);
  const canvasH = Math.max(window.innerHeight - 56 - 28 - 80, 320);

  const phaserGame = new Phaser.Game({
    type:            Phaser.AUTO,
    width:           canvasW,
    height:          canvasH,
    parent:          'game-canvas',
    backgroundColor: '#faf7f2',
    scene:           [GameScene],
    scale: {
      mode:       Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: { touch: { capture: false } },
  });

  // ── Hint ──────────────────────────────────────────────────────────────────────

  if (hintBtn) {
    const hintLabelEl = document.getElementById('hint-label');
    hintBtn.addEventListener('click', () => {
      hintBtn.disabled = true;
      if (hintLabelEl) hintLabelEl.textContent = '…';
      phaserGame.events.emit('showHint');
    });
    phaserGame.events.on('hintUsed', () => {
      hintBtn.disabled = true;
      hintBtn.classList.add('used');
      if (hintLabelEl) hintLabelEl.textContent = 'Used';
    });
  }

  // ── Timer ─────────────────────────────────────────────────────────────────────

  phaserGame.events.on('timerUpdate', ({ remaining, total }) => {
    timerTextEl.textContent = formatTime(remaining);
    timerFillEl.style.width = `${(remaining / total) * 100}%`;
    if (remaining <= 20) {
      timerFillEl.classList.add('urgent');
    } else {
      timerFillEl.classList.remove('urgent');
    }
  });

  // ── Word found ────────────────────────────────────────────────────────────────

  phaserGame.events.on('wordFound', ({ word, score, count, combo, comboChanged }) => {
    scoreEl.textContent     = score;
    wordCountEl.textContent = `${count} word${count !== 1 ? 's' : ''}`;

    // Combo badge
    if (comboBadge && comboCount) {
      if (combo > 1) {
        comboCount.textContent = combo;
        comboBadge.classList.remove('hidden');
        if (comboChanged) {
          comboBadge.classList.remove('combo-pop');
          void comboBadge.offsetWidth; // force reflow to restart animation
          comboBadge.classList.add('combo-pop');
        }
      } else {
        comboBadge.classList.add('hidden');
      }
    }

    // Word tag in tray
    const tag = document.createElement('span');
    tag.className   = 'word-tag';
    tag.textContent = word.toLowerCase();
    foundWordsTray.prepend(tag);
    if (foundWordsTray.children.length > 50) foundWordsTray.lastChild?.remove();
  });

  phaserGame.events.on('comboReset', () => {
    if (comboBadge) comboBadge.classList.add('hidden');
  });

  // ── Game end ──────────────────────────────────────────────────────────────────

  phaserGame.events.on('gameEnd', async (data) => {
    await handleGameEnd(data, player);
  });
}

// ── Game end handler ───────────────────────────────────────────────────────────

async function handleGameEnd({ score, foundWords, hiddenWords, sessionId, isGuest, timeTaken, allWords }, player) {
  finalScoreEl.textContent  = score;
  resultWordsEl.textContent = `${foundWords.length} word${foundWords.length !== 1 ? 's' : ''} found`;

  renderWordsBreakdown(hiddenWords ?? [], foundWords);

  // ── Streak + high score (registered only) ────────────────────────────────────
  const streakPanel      = document.getElementById('streak-panel');
  const streakStats      = document.getElementById('streak-stats');
  const streakGuestEl    = document.getElementById('streak-guest-prompt');
  const streakCountEl    = document.getElementById('streak-count');
  const highScoreValEl   = document.getElementById('high-score-val');

  if (streakPanel) streakPanel.classList.remove('hidden');

  if (!isGuest && player.userId) {
    try {
      const stats = await streakManager.updateAfterGame(player.userId, score);
      if (streakStats)    streakStats.classList.remove('hidden');
      if (streakCountEl)  streakCountEl.textContent  = stats.streak;
      if (highScoreValEl) highScoreValEl.textContent = stats.highScore;
    } catch (err) {
      console.error('[WordDrop] Streak update failed:', err);
      if (streakPanel) streakPanel.classList.add('hidden');
    }
  } else {
    if (streakGuestEl) streakGuestEl.classList.remove('hidden');
  }

  // ── Score submit + leaderboard ────────────────────────────────────────────────
  if (!isGuest && sessionId) {
    try {
      await leaderboard.submitScore({
        sessionId,
        userId:      player.userId,
        displayName: player.displayName,
        score,
        wordsFound:  foundWords.length,
        timeTaken,
      });
    } catch (err) {
      console.error('[WordDrop] Score submit failed:', err);
    }

    shareBtn.classList.remove('hidden');
    shareBtn.addEventListener('click', () => handleShare(sessionId));

    try {
      const rows = await leaderboard.fetchForSession(sessionId);
      renderLeaderboard(rows, lbList);
      lbSection.classList.remove('hidden');
    } catch (err) {
      console.error('[WordDrop] Leaderboard fetch failed:', err);
    }
  }

  // Show result
  resultOverlay.classList.remove('hidden');
  requestAnimationFrame(() => resultOverlay.classList.add('visible'));

  playAgainBtn.addEventListener('click', () => {
    window.location.href = '/';
  }, { once: true });
}

// ── Words breakdown ────────────────────────────────────────────────────────────
// Shows only the category words seeded into THIS grid — found vs missed.
// Dictionary bonus words are intentionally excluded (too many, mostly obscure).

function renderWordsBreakdown(hiddenWords, foundWords) {
  const foundListEl  = document.getElementById('wb-found-list');
  const missedListEl = document.getElementById('wb-missed-list');
  const foundCountEl  = document.getElementById('wb-found-count');
  const missedCountEl = document.getElementById('wb-missed-count');
  if (!foundListEl || !missedListEl) return;

  const foundSet = new Set(foundWords.map(w => w.toUpperCase()));

  const foundSeeded  = hiddenWords.filter(h =>  foundSet.has(h.word.toUpperCase()));
  const missedSeeded = hiddenWords.filter(h => !foundSet.has(h.word.toUpperCase()));

  if (foundCountEl)  foundCountEl.textContent  = foundSeeded.length;
  if (missedCountEl) missedCountEl.textContent = missedSeeded.length;

  foundListEl.innerHTML = '';
  for (const { word } of foundSeeded) {
    const chip = document.createElement('span');
    chip.className   = 'word-chip word-chip--found';
    chip.textContent = word.toLowerCase();
    foundListEl.appendChild(chip);
  }

  missedListEl.innerHTML = '';
  for (const { word } of missedSeeded) {
    const chip = document.createElement('span');
    chip.className   = 'word-chip word-chip--missed';
    chip.textContent = word.toLowerCase();
    missedListEl.appendChild(chip);
  }
}

// ── Sharing ────────────────────────────────────────────────────────────────────

async function handleShare(sessionId) {
  const link = shareManager.generateShareLink(sessionId);
  const ok   = await shareManager.copyToClipboard(link);
  if (shareCopy) {
    shareCopy.textContent = ok ? 'Link copied!' : link;
    shareCopy.classList.remove('hidden');
    setTimeout(() => shareCopy.classList.add('hidden'), 2500);
  }
}

// ── Leaderboard render ─────────────────────────────────────────────────────────

function renderLeaderboard(rows, listEl) {
  listEl.innerHTML = '';
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escHtml(row.display_name)}</span>
      <span class="lb-score">${row.score} pts</span>
      <span class="lb-words">${row.words_found}w</span>
    `;
    listEl.appendChild(li);
  });
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ── Run ────────────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error('[WordDrop] Boot error:', err);
  document.body.innerHTML = `<div class="boot-error">
    <p>Something went wrong loading the game.</p>
    <a href="/">Go back</a>
  </div>`;
});
