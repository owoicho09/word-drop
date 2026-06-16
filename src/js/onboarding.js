/**
 * onboarding.js
 *
 * Controls the "Play as Guest / Register" modal shown before the first game.
 * Persists the user's choice in sessionStorage (same tab only — cleared on close).
 * Registered users have their profile in localStorage via the Supabase session.
 */

import { auth } from './auth.js';
import { generateUniqueName } from './modules/nameGenerator.js';

const SESSION_KEY = 'worddrop_player';

/** Returns the current player profile from sessionStorage, or null. */
export function getPlayerProfile() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

/** Saves a player profile to sessionStorage. */
function savePlayerProfile(profile) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
}

/**
 * Opens the onboarding modal and resolves with the player profile once the
 * user has made a choice.
 *
 * @returns {Promise<{ isGuest: boolean, userId?: string, displayName?: string, email?: string }>}
 */
export function promptOnboarding() {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById('onboarding-modal');
    const guestBtn = document.getElementById('guest-btn');
    const registerForm = document.getElementById('register-form');
    const emailInput = document.getElementById('reg-email');
    const nameInput = document.getElementById('reg-name');
    const autoNameBtn = document.getElementById('auto-name-btn');
    const submitBtn = document.getElementById('reg-submit-btn');
    const errorEl = document.getElementById('reg-error');
    const spinner = document.getElementById('reg-spinner');

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    // ── Guest path ─────────────────────────────────────────────────────────
    guestBtn.addEventListener('click', () => {
      const profile = { isGuest: true };
      savePlayerProfile(profile);
      modal.classList.add('hidden');
      // Fire-and-forget: notify owner about new guest player.
      fetch('/api/send-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'guest' }),
      }).then(async res => {
        if (!res.ok) console.error('[WordDrop] send-email (guest) failed:', res.status, await res.text());
      }).catch(err => console.error('[WordDrop] send-email (guest) request failed:', err));
      resolve(profile);
    }, { once: true });

    // ── Auto-generate name ─────────────────────────────────────────────────
    autoNameBtn.addEventListener('click', async () => {
      autoNameBtn.disabled = true;
      autoNameBtn.textContent = '…';
      try {
        nameInput.value = await generateUniqueName();
      } finally {
        autoNameBtn.disabled = false;
        autoNameBtn.textContent = 'Auto';
      }
    });

    // ── Register path ──────────────────────────────────────────────────────
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      submitBtn.disabled = true;
      spinner.classList.remove('hidden');

      try {
        const email = emailInput.value.trim();
        const displayName = nameInput.value.trim();

        if (!email || !displayName) throw new Error('Email and display name are required.');

        const user = await auth.register({ email, displayName });
        const profile = {
          isGuest:     false,
          userId:      user.id,
          displayName: user.display_name,
          email:       user.email,
        };
        savePlayerProfile(profile);
        modal.classList.add('hidden');
        resolve(profile);
      } catch (err) {
        errorEl.textContent = err.message;
        submitBtn.disabled = false;
        spinner.classList.add('hidden');
      }
    });
  });
}

/**
 * Resolves immediately if the player already has a profile (registered or guest),
 * otherwise opens the onboarding modal.
 */
export async function ensurePlayerProfile() {
  // Check if a Supabase session exists from a previous visit
  const serverUser = await auth.getCurrentUser();
  if (serverUser) {
    const profile = {
      isGuest:     false,
      userId:      serverUser.id,
      displayName: serverUser.display_name,
      email:       serverUser.email,
    };
    savePlayerProfile(profile);
    return profile;
  }

  const cached = getPlayerProfile();
  if (cached) return cached;

  return promptOnboarding();
}
