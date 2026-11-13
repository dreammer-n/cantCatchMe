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

// The player's level and XP, and the upgrades bought: ENGINE and HANDLING for each car (cars: { id: { engine,
// handling } }), COIN BONUS for the player. Saved through PlatformManager.
const tierOf = (value) => {
  const tier = Number(value);
  return Number.isInteger(tier) && tier >= 0 ? Math.min(tier, UPGRADES.prices.length) : 0;
};

export const Progress = {
  level: 1,
  xp: 0, // XP toward the next level
  upgrades: { coins: 0 }, // the player's own (COIN BONUS)
  cars: {}, // each car's ENGINE and HANDLING
  legacy: null, // from an older save, where they were the same for every car: see adopt()
  freeUsed: false, // the one free upgrade (UPGRADES.free) has been taken

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
    this.upgrades = { coins: tierOf(tiers.coins) };
    this.freeUsed = Boolean(data.freeUsed);
    this.cars = {};
    const cars = data.cars && typeof data.cars === 'object' ? data.cars : {};
    for (const [id, own] of Object.entries(cars)) {
      if (!own || typeof own !== 'object') continue;
      this.cars[id] = {};
      for (const kind of UPGRADES.perCar) this.cars[id][kind] = tierOf(own[kind]);
    }
    // An older save had ENGINE and HANDLING for every car at once: they go to each car owned (adopt()).
    const legacy = {};
    for (const kind of UPGRADES.perCar) legacy[kind] = tierOf(tiers[kind]);
    this.legacy = !data.cars && UPGRADES.perCar.some((kind) => legacy[kind] > 0) ? legacy : null;
  },

  // After the garage has loaded: upgrades from an older save go to every car the player owns, so nothing bought
  // is lost.
  adopt(ownedIds) {
    if (!this.legacy) return;
    for (const id of ownedIds) this.cars[id] = { ...this.legacy, ...this.cars[id] };
    this.legacy = null;
    this.save();
  },

  save() {
    PlatformManager.setStoredValue(STORAGE_KEYS.progress, { level: this.level, xp: this.xp, upgrades: this.upgrades, cars: this.cars, freeUsed: this.freeUsed });
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

  // carId: whose (ENGINE and HANDLING are each car's; the selected car if none is named).
  tier(kind, carId = Garage.selected) {
    if (!UPGRADES.perCar.includes(kind)) return this.upgrades[kind] || 0;
    return (this.cars[carId] && this.cars[carId][kind]) || 0;
  },

  // The next tier of an upgrade: { tier, price, level } or null when it is at the top.
  next(kind, carId = Garage.selected) {
    const tier = this.tier(kind, carId);
    if (tier >= UPGRADES.prices.length) return null;
    return { tier: tier + 1, price: UPGRADES.prices[tier], level: UPGRADES.levels[tier] };
  },

  // The one free upgrade: the first tier of UPGRADES.free on a car the player owns, once ever.
  isFree(kind, carId = Garage.selected) {
    return kind === UPGRADES.free && !this.freeUsed && this.tier(kind, carId) === 0 && Garage.owns(carId);
  },

  // A car's own upgrades need the car to be owned.
  canUpgrade(kind, carId = Garage.selected) {
    if (this.isFree(kind, carId)) return true;
    const next = this.next(kind, carId);
    if (UPGRADES.perCar.includes(kind) && !Garage.owns(carId)) return false;
    return Boolean(next) && this.level >= next.level && Garage.coins >= next.price;
  },

  // Returns whether it was bought.
  upgrade(kind, carId = Garage.selected) {
    if (!this.canUpgrade(kind, carId)) return false;
    const next = this.next(kind, carId);
    if (this.isFree(kind, carId)) this.freeUsed = true;
    else if (!Garage.spend(next.price)) return false;
    if (UPGRADES.perCar.includes(kind)) this.cars[carId] = { ...this.cars[carId], [kind]: next.tier };
    else this.upgrades[kind] = next.tier;
    this.save();
    return true;
  },

  // A car's handling with its own engine and handling upgrades.
  handling(base, carId = Garage.selected) {
    const engine = UPGRADES.kinds.engine;
    const grip = UPGRADES.kinds.handling;
    const e = this.tier('engine', carId);
    const h = this.tier('handling', carId);
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
