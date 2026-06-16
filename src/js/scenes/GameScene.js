/**
 * GameScene.js — main Phaser 3 scene.
 *
 * Touch feel is tuned via three named constants directly below the imports —
 * HIT_RADIUS_FACTOR, DIR_LOCK_FACTOR, SMOOTH_FACTOR. See their comments for
 * which direction to nudge each one if the trace still feels too jumpy or sticky.
 *
 * Key design decisions:
 *  - Direction is detected from smoothed drag angle (snapped to nearest 45°)
 *    then locked; intermediate cells are projected onto that ray, so diagonal
 *    tracing never requires the pointer to be perfectly inside a cell rectangle.
 *  - Combo multiplier: tracks time between found words (COMBO_WINDOW_MS).
 *    Points = baseScore × combo. Combo decays on a timeout, not on next word.
 *  - Sounds: Web Audio API, generated programmatically — no audio files.
 *    All sound calls are guarded by window._wdMuted and try/catch.
 *  - Hint: skips 3-letter words (too short to trace reliably); prefers 4+ letters.
 */

import { wordValidator } from '../modules/wordValidator.js';
import { scoreWord }     from '../modules/scorer.js';

const GRID = 7;

// ── Visual palette ─────────────────────────────────────────────────────────────

const C = {
  BG:          0xfaf7f2,
  TILE_IDLE:   0xffffff,
  TILE_SHADOW: 0xcfc0ad,
  TILE_TRACE:  0x7c3aed,
  TILE_HINT:   0xf59e0b,
  TEXT_IDLE:   '#2d1b69',
  TEXT_TRACE:  '#ffffff',
};

const BAND_COLORS = [
  0x7c3aed, 0x059669, 0xd97706, 0xdb2777, 0x0891b2,
  0xea580c, 0x2563eb, 0x0d9488, 0xdc2626, 0x65a30d,
];

const BAND_ALPHA = 0.45;

// ── Depth layers ──────────────────────────────────────────────────────────────

const D = { TILE: 1, BAND: 2, LINE: 3, TEXT: 4, FX: 6, FLOAT: 8 };

// ── Timing ────────────────────────────────────────────────────────────────────

const SCORE_FLOAT_MS  = 820;
const SHAKE_STEP_MS   = 50;
const SHAKE_STEPS     = 6;
const END_DELAY_MS    = 600;
const HINT_FLASH_MS   = 2400;
const COMBO_WINDOW_MS = 5000; // ms between words to chain a combo

// ── Direction snap table ──────────────────────────────────────────────────────

const SNAP_DR = [ 0,  1, 1,  1,  0, -1, -1, -1];
const SNAP_DC = [ 1,  1, 0, -1, -1, -1,  0,  1];

// ── Developer tuning panel ───────────────────────────────────────────────────
//
// DEV_MODE — set to true to show the live on-screen counter panel.
// When you have found your ideal values:
//   1. Read the three numbers from the panel.
//   2. Copy them into the three `let` constants below as the new defaults.
//   3. Set DEV_MODE back to false and redeploy.
const DEV_MODE = false;

// ── Touch tuning ─────────────────────────────────────────────────────────────
//
// HIT_RADIUS_FACTOR — how close (fraction of cell size) a touch must land to a
//   tile centre for that tile to be selected on finger-down. 0.65 ≈ 35 px on a
//   54 px grid. The closest tile always wins; this only filters out touches that
//   miss the board entirely.
//   ↑ raise if the first tile is hard to tap accurately
//   ↓ lower if a neighbouring tile gets grabbed by accident on touch-start
let HIT_RADIUS_FACTOR = 0.65;
//
// DIR_LOCK_FACTOR — minimum drag distance (fraction of cell size) before the
//   trace direction snaps and locks. Prevents finger wobble at the start of a
//   drag from locking the wrong direction.
//   ↑ raise if direction still snaps wrong on short taps (feels jumpy at start)
//   ↓ lower if the trace feels sticky or slow to start moving
let DIR_LOCK_FACTOR = 0.42;
//
// SMOOTH_FACTOR — weight given to the previous smoothed position each frame
//   (0 = raw pointer, no smoothing; 1 = pointer never moves). Values above ~0.35
//   introduce visible lag; the default 0.18 kills micro-jitter with ~1 frame lag.
//   ↑ raise if tile selection still oscillates during a slow careful drag
//   ↓ lower if the trace feels sticky or lags noticeably behind your finger
let SMOOTH_FACTOR = 0.18;

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  init(data) {
    const d = (data && data.grid) ? data : (window.GAME_DATA ?? {});

    this.gridData     = d.grid;
    this.hiddenWords  = d.hiddenWords  ?? [];
    this.totalTimer   = d.timerSeconds ?? 120;
    this.sessionId    = d.sessionId    ?? null;
    this.isGuest      = d.isGuest      ?? true;
    this.category     = d.category     ?? 'general';
    this.difficulty   = d.difficulty   ?? 'normal';
    this.allWords     = d.allWords     ?? [];

    this.foundWords     = new Set();
    this.score          = 0;
    this.bandColorIndex = 0;
    this._hintUsed      = false;
    this._ended         = false;
    this.timeRemaining  = this.totalTimer;

    // Combo state
    this._combo        = 1;
    this._lastWordTime = 0;
    this._comboTimer   = null;

    // Web Audio
    this._ctx = null;

    // Trace state
    this.tracedCells  = [];
    this.traceDr      = null;
    this.traceDc      = null;
    this.traceStartPx = null;
    this._smoothX     = 0;
    this._smoothY     = 0;

    // Layout
    this.cellSize   = 0;
    this.gridX      = 0;
    this.gridY      = 0;
    this.cells      = [];
    this.lineGfx    = null;
    this.bandGfx    = null;
    this.timerEvent = null;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor(C.BG);

    this.cellSize = Math.min(
      Math.floor(Math.min(width, height) * 0.9 / GRID),
      54
    );
    const gridPx = this.cellSize * GRID;
    this.gridX   = Math.round((width  - gridPx) / 2);
    this.gridY   = Math.round((height - gridPx) / 2);

    this.bandGfx = this.add.graphics().setDepth(D.BAND);
    this.lineGfx = this.add.graphics().setDepth(D.LINE);

    for (let r = 0; r < GRID; r++) {
      this.cells[r] = [];
      for (let c = 0; c < GRID; c++) {
        this.cells[r][c] = this._makeCell(r, c);
      }
    }

    this.input.on('pointerdown', this._onDown,   this);
    this.input.on('pointermove', this._onMove,   this);
    this.input.on('pointerup',   this._onUp,     this);
    this.input.on('pointerout',  this._onCancel, this);

    this.game.events.on('showHint', this._onShowHint, this);

    // Disable browser scroll, pull-to-refresh, double-tap zoom, and text
    // selection on the canvas so they don't interrupt the drag trace.
    const canvas = this.sys.game.canvas;
    if (!canvas._wdTouchDisabled) {
      canvas._wdTouchDisabled            = true;
      canvas.style.touchAction           = 'none';
      canvas.style.userSelect            = 'none';
      canvas.style.webkitUserSelect      = 'none';
      canvas.style.webkitTouchCallout    = 'none';
      canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
      canvas.addEventListener('touchmove',  e => e.preventDefault(), { passive: false });
    }

    this._startTimer();
    if (DEV_MODE) this._buildDevPanel();
  }

  // ── Tile construction ─────────────────────────────────────────────────────────

  _makeCell(r, c) {
    const cs  = this.cellSize;
    const pad = Math.max(2, Math.round(cs * 0.06));
    const sz  = cs - pad * 2;
    const rad = Math.round(sz * 0.22);
    const cx  = this.gridX + c * cs + cs / 2;
    const cy  = this.gridY + r * cs + cs / 2;

    const gfx = this.add.graphics({ x: cx, y: cy }).setDepth(D.TILE);
    this._drawTileBg(gfx, sz, rad, C.TILE_IDLE, false);

    const text = this.add.text(cx, cy, this.gridData[r][c], {
      fontSize:   `${Math.round(cs * 0.38)}px`,
      fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
      color:      C.TEXT_IDLE,
      fontStyle:  'bold',
    }).setOrigin(0.5).setDepth(D.TEXT);

    return { gfx, text, cx, cy, sz, rad };
  }

  _drawTileBg(gfx, sz, rad, fill, isActive) {
    gfx.clear();
    if (!isActive) {
      gfx.fillStyle(C.TILE_SHADOW, 1);
      gfx.fillRoundedRect(-sz / 2, -sz / 2 + 3, sz, sz, rad);
    }
    gfx.fillStyle(fill, 1);
    gfx.fillRoundedRect(-sz / 2, -sz / 2, sz, isActive ? sz : sz - 2, rad);
  }

  _setTile(r, c, fill, textColor, isActive = false) {
    const { gfx, sz, rad, text } = this.cells[r][c];
    this._drawTileBg(gfx, sz, rad, fill, isActive);
    text.setColor(textColor);
  }

  _resetTile(r, c) {
    this._setTile(r, c, C.TILE_IDLE, C.TEXT_IDLE, false);
    const { gfx, text } = this.cells[r][c];
    this.tweens.killTweensOf([gfx, text]);
    gfx.setScale(1);
    text.setScale(1);
  }

  _pressCell(r, c) {
    this._setTile(r, c, C.TILE_TRACE, C.TEXT_TRACE, true);
    const { gfx, text } = this.cells[r][c];
    this.tweens.killTweensOf([gfx, text]);
    this.tweens.add({
      targets:  [gfx, text],
      scaleX:   1.08,
      scaleY:   1.08,
      duration: 80,
      ease:     'Back.easeOut',
      yoyo:     true,
    });
  }

  // ── Web Audio ────────────────────────────────────────────────────────────────

  _audioCtx() {
    if (!this._ctx) {
      try {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch { return null; }
    }
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  }

  _playSound(type, wordLength = 4, combo = 1) {
    if (window._wdMuted) return;
    const ctx = this._audioCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    try {
      if (type === 'word') {
        // Rising pop — pitch scales with word length and combo
        const baseF = 340 + (wordLength - 3) * 60 + (combo - 1) * 18;
        const layers = wordLength >= 5 ? 2 : 1;
        for (let i = 0; i < layers; i++) {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          const delay = i * 0.055;
          const freq  = baseF * (i === 0 ? 1 : 1.26);
          osc.frequency.setValueAtTime(freq * 0.72, t + delay);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.45, t + delay + 0.07);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.18, t + delay + 0.22);
          gain.gain.setValueAtTime(0.0001, t + delay);
          gain.gain.linearRampToValueAtTime(0.18 - i * 0.04, t + delay + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.28);
          osc.start(t + delay);
          osc.stop(t + delay + 0.30);
        }
      } else if (type === 'combo') {
        // Ascending arpeggio — one extra note per combo level
        const root = 440 + (combo - 2) * 50;
        const ratios = [1, 1.25, 1.5, 2].slice(0, Math.min(combo - 1, 4));
        ratios.forEach((ratio, i) => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'triangle';
          osc.frequency.value = root * ratio;
          gain.gain.setValueAtTime(0.0001, t + i * 0.072);
          gain.gain.linearRampToValueAtTime(0.13,  t + i * 0.072 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.072 + 0.20);
          osc.start(t + i * 0.072);
          osc.stop( t + i * 0.072 + 0.22);
        });
      } else if (type === 'combo-break') {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, t);
        osc.frequency.exponentialRampToValueAtTime(85, t + 0.22);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.14, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.start(t);
        osc.stop(t + 0.30);
      }
    } catch { /* Web Audio unavailable — ignore */ }
  }

  // ── Input ─────────────────────────────────────────────────────────────────────

  _onDown(pointer) {
    // Init AudioContext on first touch (satisfies browser autoplay policy)
    if (!this._ctx) this._audioCtx();

    // Select the tile whose centre is closest to the touch point.
    // Using closest-centre (rather than floor-division) means touches near cell
    // edges reliably land on the intended tile, not the neighbouring one.
    const hitR2 = (this.cellSize * HIT_RADIUS_FACTOR) ** 2;
    let bestRow = -1, bestCol = -1, bestD2 = Infinity;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const { cx, cy } = this.cells[row][col];
        const d2 = (pointer.x - cx) ** 2 + (pointer.y - cy) ** 2;
        if (d2 < bestD2) { bestD2 = d2; bestRow = row; bestCol = col; }
      }
    }
    if (bestD2 > hitR2) return; // touch is outside the board area

    // Seed the smoothed position so the first _onMove frame has no initial lag.
    this._smoothX = pointer.x;
    this._smoothY = pointer.y;

    this.traceStartPx = { x: pointer.x, y: pointer.y };
    this.tracedCells  = [{ r: bestRow, c: bestCol }];
    this.traceDr      = null;
    this.traceDc      = null;
    this._pressCell(bestRow, bestCol);
    this._redrawLine();
  }

  _onMove(pointer) {
    if (!this.traceStartPx || this.tracedCells.length === 0) return;

    // Exponential smoothing: absorbs micro-jitter from the touch sensor without
    // introducing visible lag. SMOOTH_FACTOR=0 means raw pointer; raise it if
    // tiles still oscillate during a slow drag, lower it if the trace lags.
    this._smoothX = this._smoothX * SMOOTH_FACTOR + pointer.x * (1 - SMOOTH_FACTOR);
    this._smoothY = this._smoothY * SMOOTH_FACTOR + pointer.y * (1 - SMOOTH_FACTOR);
    const px = this._smoothX;
    const py = this._smoothY;

    const { x: startX, y: startY } = this.traceStartPx;
    const dx   = px - startX;
    const dy   = py - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Phase 1: wait for minimum drag, then lock direction.
    if (this.traceDr === null) {
      if (dist < this.cellSize * DIR_LOCK_FACTOR) return;
      const angle = Math.atan2(dy, dx);
      const snap  = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
      this.traceDr = SNAP_DR[snap];
      this.traceDc = SNAP_DC[snap];
    }

    // Phase 2: project smoothed pointer onto the locked direction ray.
    const { r: r0, c: c0 } = this.tracedCells[0];
    const { cx: startCx, cy: startCy } = this.cells[r0][c0];

    const dr = this.traceDr;
    const dc = this.traceDc;

    const proj     = (px - startCx) * dc + (py - startCy) * dr;
    const stepDist = Math.sqrt(dr * dr + dc * dc) * this.cellSize;
    const k        = Math.max(0, Math.round(proj / stepDist));
    const currentK = this.tracedCells.length - 1;

    if (k > currentK) {
      for (let i = currentK + 1; i <= k; i++) {
        const nr = r0 + i * dr;
        const nc = c0 + i * dc;
        if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) break;
        this.tracedCells.push({ r: nr, c: nc });
        this._pressCell(nr, nc);
      }
    } else if (k < currentK) {
      for (let i = currentK; i > k; i--) {
        this._resetTile(this.tracedCells[i].r, this.tracedCells[i].c);
        this.tracedCells.pop();
      }
      if (k === 0) { this.traceDr = null; this.traceDc = null; }
    }

    this._redrawLine();
  }

  _onUp() {
    if (this.tracedCells.length < 2) {
      this._clearTrace();
      return;
    }

    // Words can be traced in either direction along the line — a forward
    // trace and its reverse both count, since the hint/visual line gives no
    // indication of which end is the "start".
    const forward = this.tracedCells.map(({ r, c }) => this.gridData[r][c]).join('');
    const backward = [...forward].reverse().join('');

    let word  = forward;
    let cells = this.tracedCells;

    if (!wordValidator.isValid(forward) && wordValidator.isValid(backward)) {
      word  = backward;
      cells = [...this.tracedCells].reverse();
    }

    if (this.foundWords.has(word)) {
      this._onInvalidWord();
      return;
    }

    if (wordValidator.isValid(word)) {
      const color = BAND_COLORS[this.bandColorIndex % BAND_COLORS.length];
      this.bandColorIndex++;
      this._onValidWord(word, [...cells], color);
    } else {
      this._onInvalidWord();
    }
  }

  _onCancel() {
    this._clearTrace();
  }

  // ── Dev tuning panel (DEV_MODE only) ─────────────────────────────────────────

  _buildDevPanel() {
    if (document.getElementById('wd-dev-toggle')) return; // guard against double-init

    const style = document.createElement('style');
    style.id = 'wd-dev-style';
    style.textContent = `
      #wd-dev-toggle {
        position: fixed; top: 8px; right: 8px; z-index: 9999;
        width: 34px; height: 34px;
        background: rgba(20,10,50,0.82); color: #a78bfa;
        border: 1px solid #5b21b6; border-radius: 8px;
        font-size: 17px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        touch-action: manipulation; user-select: none; -webkit-user-select: none;
      }
      #wd-dev-panel {
        position: fixed; top: 48px; right: 8px; z-index: 9999;
        background: rgba(10,5,28,0.94); color: #e2d9f3;
        border: 1px solid #5b21b6; border-radius: 10px;
        padding: 10px 12px;
        font-family: 'Inter', system-ui, monospace, sans-serif;
        display: none; min-width: 190px;
      }
      #wd-dev-panel.wd-open { display: block; }
      .wd-heading {
        font-size: 9px; font-weight: 700; letter-spacing: 0.10em;
        text-transform: uppercase; color: #7c3aed;
        text-align: center; margin-bottom: 9px;
      }
      .wd-row {
        display: flex; align-items: center; gap: 5px;
        margin-bottom: 7px;
      }
      .wd-row:last-child { margin-bottom: 0; }
      .wd-label {
        flex: 1; font-size: 11px; font-weight: 600;
        color: #a78bfa; letter-spacing: 0.02em;
      }
      .wd-val {
        width: 40px; text-align: center;
        font-size: 13px; font-weight: 700; color: #f3eeff;
        font-variant-numeric: tabular-nums;
      }
      .wd-btn {
        width: 28px; height: 28px;
        background: rgba(91,33,182,0.35); color: #c4b5fd;
        border: 1px solid #6d28d9; border-radius: 6px;
        font-size: 16px; cursor: pointer; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        touch-action: manipulation;
        user-select: none; -webkit-user-select: none;
      }
      .wd-btn:active { background: rgba(124,58,237,0.65); }
    `;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'wd-dev-toggle';
    toggle.textContent = '⚙';
    toggle.setAttribute('aria-label', 'Dev touch-tuning panel');
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'wd-dev-panel';

    const heading = document.createElement('div');
    heading.className = 'wd-heading';
    heading.textContent = 'touch tuning';
    panel.appendChild(heading);

    // Each entry: label shown, step per tap, clamp bounds, getter/setter for
    // the module-level `let` variable. Steps: 0.05 for HIT_R and LOCK (coarser
    // effect), 0.02 for SMTH (finer, more sensitive to small changes).
    const params = [
      {
        label: 'HIT_R', step: 0.05, min: 0.30, max: 1.20,
        get()  { return HIT_RADIUS_FACTOR; },
        set(v) { HIT_RADIUS_FACTOR = v; },
      },
      {
        label: 'LOCK',  step: 0.05, min: 0.10, max: 0.80,
        get()  { return DIR_LOCK_FACTOR; },
        set(v) { DIR_LOCK_FACTOR = v; },
      },
      {
        label: 'SMTH',  step: 0.02, min: 0.00, max: 0.50,
        get()  { return SMOOTH_FACTOR; },
        set(v) { SMOOTH_FACTOR = v; },
      },
    ];

    params.forEach(p => {
      const row   = document.createElement('div');
      row.className = 'wd-row';

      const label = document.createElement('span');
      label.className = 'wd-label';
      label.textContent = p.label;

      const valEl = document.createElement('span');
      valEl.className = 'wd-val';
      valEl.textContent = p.get().toFixed(2);

      const minus = document.createElement('button');
      minus.className = 'wd-btn';
      minus.textContent = '−';
      minus.setAttribute('aria-label', `Decrease ${p.label}`);

      const plus = document.createElement('button');
      plus.className = 'wd-btn';
      plus.textContent = '+';
      plus.setAttribute('aria-label', `Increase ${p.label}`);

      const adjust = delta => {
        // Round to 3 decimal places to avoid floating-point drift (e.g. 0.060000000001)
        const next = Math.round((p.get() + delta) * 1000) / 1000;
        p.set(Math.min(p.max, Math.max(p.min, next)));
        valEl.textContent = p.get().toFixed(2);
      };

      minus.addEventListener('click', () => adjust(-p.step));
      plus.addEventListener('click',  () => adjust(+p.step));

      row.appendChild(label);
      row.appendChild(minus);
      row.appendChild(valEl);
      row.appendChild(plus);
      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    toggle.addEventListener('click', () => panel.classList.toggle('wd-open'));
  }

  // ── Word outcome ──────────────────────────────────────────────────────────────

  _onValidWord(word, cells, color) {
    this.foundWords.add(word);

    // ── Combo ─────────────────────────────────────────────────────────────────
    const prevCombo = this._combo;
    const now       = this.time.now;

    if (this._comboTimer) { this._comboTimer.remove(); this._comboTimer = null; }

    if (this._lastWordTime > 0 && now - this._lastWordTime < COMBO_WINDOW_MS) {
      this._combo = Math.min(this._combo + 1, 8);
    } else {
      this._combo = 1;
    }
    this._lastWordTime = now;
    const comboChanged = this._combo !== prevCombo;

    // Schedule combo expiry
    if (this._combo > 1) {
      this._comboTimer = this.time.delayedCall(COMBO_WINDOW_MS, () => {
        const old = this._combo;
        this._combo        = 1;
        this._lastWordTime = 0;
        this._comboTimer   = null;
        this._playSound('combo-break');
        this.game.events.emit('comboReset', { prev: old });
      });
    }

    const points = scoreWord(word) * this._combo;
    this.score  += points;

    // ── Band ──────────────────────────────────────────────────────────────────
    this._drawFoundBand(cells, color);

    // Clear trace immediately so the player can start the next word
    this.tracedCells  = [];
    this.traceDr      = null;
    this.traceDc      = null;
    this.traceStartPx = null;
    this._redrawLine();

    // ── Pop flash animation ───────────────────────────────────────────────────
    const colorHex  = '#' + color.toString(16).padStart(6, '0');
    const popScale  = 1.13 + Math.min(this._combo - 1, 5) * 0.013;
    const popDur    = 65 + (word.length - 3) * 8;

    cells.forEach(({ r, c }) => {
      this._setTile(r, c, color, '#ffffff', true);
      const cell = this.cells[r][c];
      this.tweens.killTweensOf([cell.gfx, cell.text]);
      this.tweens.add({
        targets:  [cell.gfx, cell.text],
        scaleX:   popScale,
        scaleY:   popScale,
        duration: popDur,
        ease:     'Back.easeOut',
        yoyo:     true,
        onComplete: () => {
          this._resetTile(r, c);
          this.cells[r][c].text.setColor(colorHex);
        },
      });
    });

    // ── Score float ───────────────────────────────────────────────────────────
    const mid = cells[Math.floor(cells.length / 2)];
    const { cx, cy } = this.cells[mid.r][mid.c];
    const floatSz    = 16 + (word.length - 3) * 2 + Math.min(this._combo - 1, 5) * 2;
    const floatLabel = this._combo > 1 ? `+${points} ×${this._combo}` : `+${points}`;

    const float = this.add.text(cx, cy - 8, floatLabel, {
      fontSize:   `${floatSz}px`,
      fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
      fontStyle:  'bold',
      color:      colorHex,
    }).setOrigin(0.5).setDepth(D.FLOAT);

    this.tweens.add({
      targets:    float,
      y:          cy - 54 - Math.min(this._combo - 1, 5) * 5,
      scaleX:     1.22,
      scaleY:     1.22,
      alpha:      0,
      duration:   SCORE_FLOAT_MS,
      ease:       'Cubic.easeOut',
      onComplete: () => float.destroy(),
    });

    // ── Burst ring ────────────────────────────────────────────────────────────
    const ringR    = this.cellSize * (0.27 + (word.length - 3) * 0.04);
    const ringW    = 2 + Math.min(this._combo - 1, 4) * 0.4;
    const endScale = 2.6 + (word.length - 3) * 0.2 + Math.min(this._combo - 1, 4) * 0.2;

    const ring = this.add.graphics().setDepth(D.FX);
    ring.lineStyle(ringW, color, 0.85);
    ring.strokeCircle(cx, cy, ringR);
    this.tweens.add({
      targets:    ring,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   380 + (word.length - 3) * 22,
      ease:       'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // ── Sound ─────────────────────────────────────────────────────────────────
    this._playSound('word', word.length, this._combo);
    if (comboChanged && this._combo > 1) {
      this.time.delayedCall(85, () => this._playSound('combo', word.length, this._combo));
    }

    // ── Events ────────────────────────────────────────────────────────────────
    this.game.events.emit('wordFound', {
      word, points, score: this.score, count: this.foundWords.size,
      combo: this._combo, comboChanged,
    });

    // Win condition
    if (this.hiddenWords.length > 0 &&
        this.hiddenWords.every(h => this.foundWords.has(h.word))) {
      this._endGame();
    }
  }

  _onInvalidWord() {
    this.tracedCells.forEach(({ r, c }) => {
      this._setTile(r, c, 0xfca5a5, C.TEXT_IDLE, true);
    });

    const saved = this.tracedCells.map(({ r, c }) => ({ r, c }));

    this.tracedCells  = [];
    this.traceDr      = null;
    this.traceDc      = null;
    this.traceStartPx = null;
    this._redrawLine();

    const origX = saved.map(({ r, c }) => this.cells[r][c].gfx.x);

    let step = 0;
    const doShake = () => {
      if (step >= SHAKE_STEPS) {
        saved.forEach(({ r, c }, i) => {
          const cell = this.cells[r][c];
          cell.gfx.x  = origX[i];
          cell.text.x = cell.cx;
          this._resetTile(r, c);
        });
        return;
      }
      const offset = (step % 2 === 0 ? 3 : -3) * (1 - step / SHAKE_STEPS);
      saved.forEach(({ r, c }, i) => {
        const cell   = this.cells[r][c];
        cell.gfx.x  = origX[i] + offset;
        cell.text.x = cell.cx  + offset;
      });
      step++;
      this.time.delayedCall(SHAKE_STEP_MS, doShake);
    };
    doShake();
  }

  // ── Hint ──────────────────────────────────────────────────────────────────────

  _onShowHint() {
    if (this._hintUsed) return;

    const unfound = this.hiddenWords.filter(h => !this.foundWords.has(h.word));
    if (unfound.length === 0) { this.game.events.emit('hintUsed'); return; }

    this._hintUsed = true;

    try {
      // Prefer words with 4+ letters — they're easier to trace and more satisfying.
      // Fall back to whatever remains if all unfound words are 3 letters.
      const candidates = unfound.filter(h => h.word.length >= 4);
      const pool       = candidates.length > 0 ? candidates : unfound;
      const target     = pool.reduce((a, b) => a.word.length <= b.word.length ? a : b);

      // Reconstruct cell list if it wasn't persisted in the DB row
      const cells = (Array.isArray(target.cells) && target.cells.length > 0)
        ? target.cells
        : Array.from({ length: target.word.length }, (_, i) => ({
            r: target.row + i * target.direction[0],
            c: target.col + i * target.direction[1],
          }));

      // Save per-cell text colour so we can restore it after the flash
      const savedColors = cells.map(({ r, c }) => this.cells[r][c].text.style.color);

      // Layer 1 (depth 1): amber tile background (visible if no band on top)
      cells.forEach(({ r, c }) => {
        this._setTile(r, c, C.TILE_HINT, C.TEXT_IDLE, false);
      });

      // Layer 2 (depth 3.5): overlay above found-word bands
      const { sz, rad } = this.cells[cells[0].r][cells[0].c];
      const hintGfx = this.add.graphics().setDepth(3.5).setAlpha(0);

      cells.forEach(({ r, c }) => {
        const { cx, cy } = this.cells[r][c];
        hintGfx.fillStyle(C.TILE_HINT, 1);
        hintGfx.fillRoundedRect(cx - sz / 2 + 1, cy - sz / 2 + 1, sz - 2, sz - 3, rad);
      });

      if (cells.length > 1) {
        hintGfx.lineStyle(sz * 0.2, C.TILE_HINT, 0.45);
        hintGfx.beginPath();
        const { cx: fx, cy: fy } = this.cells[cells[0].r][cells[0].c];
        hintGfx.moveTo(fx, fy);
        for (let i = 1; i < cells.length; i++) {
          const { cx, cy } = this.cells[cells[i].r][cells[i].c];
          hintGfx.lineTo(cx, cy);
        }
        hintGfx.strokePath();
      }

      this.tweens.add({ targets: hintGfx, alpha: 1, duration: 300, ease: 'Sine.easeOut' });

      this.time.delayedCall(HINT_FLASH_MS - 300, () => {
        if (!hintGfx.active) return;
        this.tweens.add({
          targets:    hintGfx,
          alpha:      0,
          duration:   300,
          ease:       'Sine.easeIn',
          onComplete: () => {
            if (hintGfx.active) hintGfx.destroy();
            cells.forEach(({ r, c }, i) => {
              this._setTile(r, c, C.TILE_IDLE, savedColors[i], false);
            });
            this.game.events.emit('hintUsed');
          },
        });
      });

    } catch (err) {
      console.error('[WordDrop] Hint error:', err);
      this.game.events.emit('hintUsed');
    }
  }

  // ── Persistent band ───────────────────────────────────────────────────────────

  _drawFoundBand(cells, color) {
    const R = this.cellSize * 0.29;

    if (cells.length > 1) {
      this.bandGfx.lineStyle(R * 2, color, BAND_ALPHA * 0.9);
      this.bandGfx.beginPath();
      const f = this.cells[cells[0].r][cells[0].c];
      this.bandGfx.moveTo(f.cx, f.cy);
      for (let i = 1; i < cells.length; i++) {
        const { cx, cy } = this.cells[cells[i].r][cells[i].c];
        this.bandGfx.lineTo(cx, cy);
      }
      this.bandGfx.strokePath();
    }

    this.bandGfx.fillStyle(color, BAND_ALPHA);
    for (const { r, c } of cells) {
      const { cx, cy } = this.cells[r][c];
      this.bandGfx.fillCircle(cx, cy, R);
    }
  }

  // ── Trace line ────────────────────────────────────────────────────────────────

  _clearTrace() {
    this.tracedCells.forEach(({ r, c }) => this._resetTile(r, c));
    this.tracedCells  = [];
    this.traceDr      = null;
    this.traceDc      = null;
    this.traceStartPx = null;
    this._redrawLine();
  }

  _redrawLine() {
    this.lineGfx.clear();
    const n = this.tracedCells.length;
    if (n === 0) return;

    const lineW = this.cellSize * 0.22;

    if (n >= 2) {
      this.lineGfx.lineStyle(lineW, C.LINE, 0.55);
      this.lineGfx.beginPath();
      const first = this.tracedCells[0];
      this.lineGfx.moveTo(this.cells[first.r][first.c].cx, this.cells[first.r][first.c].cy);
      for (let i = 1; i < n; i++) {
        const { r, c } = this.tracedCells[i];
        this.lineGfx.lineTo(this.cells[r][c].cx, this.cells[r][c].cy);
      }
      this.lineGfx.strokePath();
    }

    this.lineGfx.fillStyle(C.LINE, 0.65);
    for (const { r, c } of this.tracedCells) {
      const { cx, cy } = this.cells[r][c];
      this.lineGfx.fillCircle(cx, cy, lineW / 2);
    }
  }

  // ── Timer ─────────────────────────────────────────────────────────────────────

  _startTimer() {
    this.timeRemaining = this.totalTimer;
    this.game.events.emit('timerUpdate', {
      remaining: this.timeRemaining,
      total:     this.totalTimer,
    });

    this.timerEvent = this.time.addEvent({
      delay:    1000,
      repeat:   this.totalTimer - 1,
      callback: () => {
        this.timeRemaining--;
        this.game.events.emit('timerUpdate', {
          remaining: this.timeRemaining,
          total:     this.totalTimer,
        });
        if (this.timeRemaining <= 0) this._endGame();
      },
    });
  }

  // ── Game end ──────────────────────────────────────────────────────────────────

  _endGame() {
    if (this._ended) return;
    this._ended = true;

    if (this.timerEvent) this.timerEvent.remove();
    if (this._comboTimer) { this._comboTimer.remove(); this._comboTimer = null; }

    this.input.off('pointerdown', this._onDown,   this);
    this.input.off('pointermove', this._onMove,   this);
    this.input.off('pointerup',   this._onUp,     this);
    this.input.off('pointerout',  this._onCancel, this);
    this.game.events.off('showHint', this._onShowHint, this);

    const timeTaken = this.totalTimer - (this.timeRemaining ?? 0);

    this.time.delayedCall(END_DELAY_MS, () => {
      this.game.events.emit('gameEnd', {
        score:       this.score,
        foundWords:  [...this.foundWords],
        hiddenWords: this.hiddenWords,
        sessionId:   this.sessionId,
        isGuest:     this.isGuest,
        timeTaken,
        allWords:    this.allWords,
      });
    });
  }
}
