import { COMBO, STORAGE_KEYS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';

// Score = survival time (game time while driving; pauses don't count).
// Also tracked: police wrecked, close calls (near misses), best combo, distance.
export class RunStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.time = 0;
    this.wrecks = 0;
    this.nearMisses = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboTimer = 0;
    this.distance = 0;
    this.shockwaves = 0;
  }

  // Police wrecked within COMBO.window seconds of the previous one extend the combo.
  addWreck() {
    this.wrecks += 1;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = COMBO.window;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    return this.combo;
  }

  update(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  summary() {
    return {
      time: this.time,
      wrecks: this.wrecks,
      nearMisses: this.nearMisses,
      combo: this.bestCombo,
      distance: Math.round(this.distance),
    };
  }
}

// Saved between visits through the platform (cloud saves where available, else the browser).
export const Records = {
  best: { time: 0, wrecks: 0, nearMisses: 0, combo: 0 },
  totals: { runs: 0, wrecks: 0, seconds: 0 },

  async load() {
    const best = await PlatformManager.getStoredValue(STORAGE_KEYS.best, null);
    const totals = await PlatformManager.getStoredValue(STORAGE_KEYS.totals, null);
    if (best && typeof best === 'object') this.best = { ...this.best, ...sanitize(best) };
    if (totals && typeof totals === 'object') this.totals = { ...this.totals, ...sanitize(totals) };
  },

  // Records a finished run. Returns { newBest, best }.
  submit(summary) {
    const newBest = summary.time > this.best.time + 1e-6;
    this.best = {
      time: Math.max(this.best.time, summary.time),
      wrecks: Math.max(this.best.wrecks, summary.wrecks),
      nearMisses: Math.max(this.best.nearMisses, summary.nearMisses),
      combo: Math.max(this.best.combo, summary.combo),
    };
    this.totals = {
      runs: this.totals.runs + 1,
      wrecks: this.totals.wrecks + summary.wrecks,
      seconds: this.totals.seconds + summary.time,
    };
    PlatformManager.setStoredValue(STORAGE_KEYS.best, this.best);
    PlatformManager.setStoredValue(STORAGE_KEYS.totals, this.totals);
    return { newBest, best: this.best };
  },
};

// Saved data could be edited or come from an older version: keep only finite numbers.
function sanitize(object) {
  const clean = {};
  for (const [key, value] of Object.entries(object)) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) clean[key] = number;
  }
  return clean;
}

// 83.4 -> "1:23.4"
export function formatTime(seconds) {
  const tenths = Math.floor(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
