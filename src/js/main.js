/**
 * main.js — home screen logic.
 *
 * Responsibilities:
 *  - Kick off dictionary loading immediately (background).
 *  - Render category cards with flat vector icon chips and difficulty buttons.
 *  - Check for an existing Supabase session and reflect it in the UI.
 *  - On Play: run the onboarding flow if needed, then navigate to game.html.
 *  - Save selected category to sessionStorage as a backup so game.js always
 *    has it even if URL params are dropped during auth redirects.
 */

import { wordValidator }  from './modules/wordValidator.js';
import { CATEGORIES }     from '../data/words/index.js';
import { ensurePlayerProfile, getPlayerProfile } from './onboarding.js';

wordValidator.load();

// ── Category metadata ─────────────────────────────────────────────────────────
// icon: inline SVG string (Feather/Lucide stroke style, 24×24 viewBox)
// color: CSS color used for the icon chip background + card accent

const CATEGORY_META = {
  animals: {
    color: '#16a34a',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 1 1.261-.472 1.96-1.898 2.344-3z"/>
      <path d="M14 5.172c0-1.39 1.577-2.493 3.5-2.172 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.96-1.898-2.344-3z"/>
      <path d="M8 14s-1 4 4 4 4-4 4-4"/>
      <path d="M9 9h.01M15 9h.01"/>
      <path d="M10 14.172C10 15.562 8.423 16.665 6.5 16.344c-1.2-.2-2.5-1.5-2.5-3.844 0-1.39 1.577-2.493 3.5-2.172C9.261 10.8 10 12.4 10 14.172z"/>
      <path d="M14 14.172c0 1.39 1.577 2.493 3.5 2.172 1.2-.2 2.5-1.5 2.5-3.844 0-1.39-1.577-2.493-3.5-2.172-1.261.472-2.5 2.072-2.5 3.844z"/>
    </svg>`,
  },
  countries: {
    color: '#0284c7',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`,
  },
  names: {
    color: '#7c3aed',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>`,
  },
  general: {
    color: '#6366f1',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
    </svg>`,
  },
  food: {
    color: '#dc2626',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
      <path d="M7 2v20"/>
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
    </svg>`,
  },
  sports: {
    color: '#ea580c',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>`,
  },
  cities: {
    color: '#0891b2',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>`,
  },
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const catGrid     = document.getElementById('category-grid');
const catSection  = document.getElementById('category-section');
const diffSection = document.getElementById('difficulty-section');
const diffButtons = document.querySelectorAll('.diff-btn');
const backBtn     = document.getElementById('back-btn');
const playerLabel = document.getElementById('player-label');
const signOutBtn  = document.getElementById('sign-out-btn');

// ── State ─────────────────────────────────────────────────────────────────────

let selectedCategory = null;

// ── Render category cards ─────────────────────────────────────────────────────

CATEGORIES.forEach(({ id, label }) => {
  const meta = CATEGORY_META[id] ?? { color: '#6366f1', icon: CATEGORY_META.general.icon };

  const card = document.createElement('button');
  card.className = 'cat-card';
  card.dataset.id = id;
  card.style.setProperty('--cat-color', meta.color);
  card.innerHTML = `
    <div class="cat-chip">${meta.icon}</div>
    <span class="cat-name">${label}</span>
  `;
  card.addEventListener('click', () => selectCategory(id));
  catGrid.appendChild(card);
});

function selectCategory(id) {
  selectedCategory = id;
  sessionStorage.setItem('worddrop_pending_cat', id);
  catSection.classList.add('hidden');
  diffSection.classList.remove('hidden');
}

// ── Back button ───────────────────────────────────────────────────────────────

backBtn.addEventListener('click', () => {
  diffSection.classList.add('hidden');
  catSection.classList.remove('hidden');
});

// ── Difficulty / Play ─────────────────────────────────────────────────────────

diffButtons.forEach(btn => {
  btn.addEventListener('click', async () => {
    await startGame(btn.dataset.diff);
  });
});

async function startGame(difficulty) {
  await ensurePlayerProfile();
  const params = new URLSearchParams({ cat: selectedCategory, diff: difficulty });
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
