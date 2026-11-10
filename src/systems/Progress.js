import { LEVELS, STORAGE_KEYS, UPGRADES, WANTED } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Garage } from './ScoreSystem.js';

// XP needed to go from this level to the next.
export function xpForLevel(level) {
  return LEVELS.first + LEVELS.step * (level - 1);
}

// The WANTED level (1 to 5 stars) a run has reached after this many seconds. hard: HARD START's pace.
export function wantedAt(seconds, hard = false) {
  const steps = hard ? WANTED.hard : WANTED.normal;
  let level = 0;
  steps.forEach((step, i) => {
    if (seconds >= step.at) level = i + 1;
  });
  return Math.max(1, level);
}

export function wantedCall(level, hard = false) {
  const steps = hard ? WANTED.hard : WANTED.normal;
  return (steps[level - 1] && steps[level - 1].call) || null;
}

// The player's level and XP, and the upgrades bought (they work for every car). Saved through PlatformManager.
export const Progress = {
  level: 1,
  xp: 0, // XP toward the next level
  upgrades: { engine: 0, handling: 0, coins: 0 },

  async load() {
    this.restore(await PlatformManager.getStoredValue(STORAGE_KEYS.progress, null));
  },

  // Saved data could be edited or come from an older version: only what makes sense is kept.
  restore(saved) {
    const data = saved && typeof saved === 'object' ? saved : {};
    const level = Number(data.level);
    const xp = Number(data.xp);
    this.level = Number.isInteger(level) && level >= 1 ? level : 1;
    this.xp = Number.isFinite(xp) && xp >= 0 ? Math.floor(xp) : 0;
    const tiers = data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : {};
    this.upgrades = {};
    for (const kind of Object.keys(UPGRADES.kinds)) {
      const tier = Number(tiers[kind]);
      this.upgrades[kind] = Number.isInteger(tier) && tier >= 0 ? Math.min(tier, UPGRADES.prices.length) : 0;
    }
  },

  save() {
    PlatformManager.setStoredValue(STORAGE_KEYS.progress, { level: this.level, xp: this.xp, upgrades: this.upgrades });
  },

  // Share of the way to the next level, 0..1.
  get share() {
    return Math.min(1, this.xp / xpForLevel(this.level));
  },

  // Adds XP. Returns the levels reached (each pays LEVELS.coinsPerLevel x the level, paid here).
  addXp(amount) {
    this.xp += Math.max(0, Math.floor(amount));
    const reached = [];
    while (this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level += 1;
      reached.push(this.level);
      Garage.award(this.level * LEVELS.coinsPerLevel);
    }
    this.save();
    return reached;
  },

  tier(kind) {
    return this.upgrades[kind] || 0;
  },

  // The next tier of an upgrade: { tier, price, level } or null when it is at the top.
  next(kind) {
    const tier = this.tier(kind);
    if (tier >= UPGRADES.prices.length) return null;
    return { tier: tier + 1, price: UPGRADES.prices[tier], level: UPGRADES.levels[tier] };
  },

  canUpgrade(kind) {
    const next = this.next(kind);
    return Boolean(next) && this.level >= next.level && Garage.coins >= next.price;
  },

  // Returns whether it was bought.
  upgrade(kind) {
    if (!this.canUpgrade(kind)) return false;
    const next = this.next(kind);
    if (!Garage.spend(next.price)) return false;
    this.upgrades[kind] = next.tier;
    this.save();
    return true;
  },

  // A car's handling with the engine and handling upgrades.
  handling(base) {
    const engine = UPGRADES.kinds.engine;
    const grip = UPGRADES.kinds.handling;
    const e = this.tier('engine');
    const h = this.tier('handling');
    return {
      ...base,
      topSpeed: base.topSpeed * (1 + e * engine.topSpeed),
      acceleration: base.acceleration * (1 + e * engine.acceleration),
      maxTurnRateDeg: base.maxTurnRateDeg * (1 + h * grip.turn),
      gripTurning: base.gripTurning * (1 + h * grip.grip),
    };
  },

  // The coin upgrade's extra share of a run's coins.
  coinBonus() {
    return this.tier('coins') * UPGRADES.kinds.coins.coins;
  },
};
