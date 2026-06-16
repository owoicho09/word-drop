/**
 * main.js — home screen logic.
 *
 * Responsibilities:
 *  - Kick off dictionary loading immediately (background).
 *  - Show difficulty picker; category is fixed to 'general'.
 *  - Check for an existing Supabase session and reflect it in the UI.
 *  - On Play: run the onboarding flow if needed, then navigate to game.html.
 */

import { wordValidator }  from './modules/wordValidator.js';
import { ensurePlayerProfile, getPlayerProfile } from './onboarding.js';

wordValidator.load();

// ── DOM refs ──────────────────────────────────────────────────────────────────

const diffButtons = document.querySelectorAll('.diff-btn');
const playerLabel = document.getElementById('player-label');
const signOutBtn  = document.getElementById('sign-out-btn');

// ── Difficulty / Play ─────────────────────────────────────────────────────────

diffButtons.forEach(btn => {
  btn.addEventListener('click', async () => {
    await startGame(btn.dataset.diff);
  });
});

async function startGame(difficulty) {
  await ensurePlayerProfile();
  const params = new URLSearchParams({ cat: 'general', diff: difficulty });
  window.location.href = `/game.html?${params}`;
}

// ── Player status in header ───────────────────────────────────────────────────

(async () => {
  const profile = getPlayerProfile();
  if (profile && !profile.isGuest) {
    if (playerLabel) playerLabel.textContent = `Hi, ${profile.displayName}`;
    if (signOutBtn) {
      signOutBtn.classList.remove('hidden');
      signOutBtn.addEventListener('click', async () => {
        const { auth } = await import('./auth.js');
        await auth.signOut();
        sessionStorage.clear();
        window.location.reload();
      });
    }
  }
})();
