import { CARS, COINS, COMBO, MAPS, STARS, STORAGE_KEYS, UNITS_PER_METER, carById, mapById } from '../config/tuning.js';
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
  best: { time: 0, wrecks: 0, nearMisses: 0, combo: 0, distance: 0 },
  totals: { runs: 0, wrecks: 0, seconds: 0, distance: 0 },
  hardBest: 0, // the best HARD START run, in whole seconds (the leaderboard's score)

  async load() {
    const best = await PlatformManager.getStoredValue(STORAGE_KEYS.best, null);
    const totals = await PlatformManager.getStoredValue(STORAGE_KEYS.totals, null);
    if (best && typeof best === 'object') this.best = { ...this.best, ...sanitize(best) };
    if (totals && typeof totals === 'object') this.totals = { ...this.totals, ...sanitize(totals) };
    const hardBest = await PlatformManager.getStoredValue(STORAGE_KEYS.hardBest, 0);
    this.hardBest = Number.isFinite(hardBest) && hardBest > 0 ? Math.floor(hardBest) : 0;
  },

  // A finished HARD START run. Returns its score (whole seconds) if it beats the best, so it goes to the
  // leaderboard, or null.
  submitHard(seconds) {
    const score = Math.floor(seconds);
    if (score <= this.hardBest) return null;
    this.hardBest = score;
    PlatformManager.setStoredValue(STORAGE_KEYS.hardBest, score);
    return score;
  },

  // Records a finished run. Returns { newBest, best }.
  submit(summary) {
    const newBest = summary.time > this.best.time + 1e-6;
    this.best = {
      time: Math.max(this.best.time, summary.time),
      wrecks: Math.max(this.best.wrecks, summary.wrecks),
      nearMisses: Math.max(this.best.nearMisses, summary.nearMisses),
      combo: Math.max(this.best.combo, summary.combo),
      distance: Math.max(this.best.distance, summary.distance),
    };
    this.totals = {
      runs: this.totals.runs + 1,
      wrecks: this.totals.wrecks + summary.wrecks,
      seconds: this.totals.seconds + summary.time,
      distance: this.totals.distance + summary.distance,
    };
    PlatformManager.setStoredValue(STORAGE_KEYS.best, this.best);
    PlatformManager.setStoredValue(STORAGE_KEYS.totals, this.totals);
    return { newBest, best: this.best };
  },
};

// How many stars a survival time is worth.
export function starsFor(seconds) {
  return STARS.filter((needed) => seconds >= needed).length;
}

// What a finished run earned.
// hard: HARD START was on, which pays COINS.hardShare times as much. upgradeShare: the coin upgrade's extra share.
export function coinsForRun(summary, hard = false, upgradeShare = 0) {
  const time = Math.floor(summary.time * COINS.perSecond);
  const wrecks = summary.wrecks * COINS.perWreck;
  const combo = summary.combo * COINS.perCombo;
  const bonus = hard ? Math.round((time + wrecks + combo) * (COINS.hardShare - 1)) : 0;
  const upgrade = Math.round((time + wrecks + combo + bonus) * upgradeShare);
  return { time, wrecks, combo, hard: bonus, upgrade, total: time + wrecks + combo + bonus + upgrade };
}

// Which maps are open: every map's best run earns stars, and enough stars in all unlock the next map.
export const Maps = {
  best: {}, // map id -> best time
  selected: MAPS[0].id,

  async load() {
    const best = await PlatformManager.getStoredValue(STORAGE_KEYS.mapBest, null);
    const selected = await PlatformManager.getStoredValue(STORAGE_KEYS.selectedMap, MAPS[0].id);
    this.restore(best, selected);
    // Runs from before there were maps were all on the first one.
    if (!best && Records.best.time > 0) this.best[MAPS[0].id] = Records.best.time;
  },

  // Saved data could be edited or come from an older version: only what makes sense is kept.
  restore(best, selected) {
    this.best = {};
    const saved = best && typeof best === 'object' ? best : {};
    for (const map of MAPS) {
      const time = Number(saved[map.id]);
      if (Number.isFinite(time) && time > 0) this.best[map.id] = time;
    }
    const wanted = mapById(selected);
    this.selected = this.isUnlocked(wanted) ? wanted.id : MAPS[0].id;
  },

  current() {
    return mapById(this.selected);
  },

  bestTime(id) {
    return this.best[id] || 0;
  },

  totalStars() {
    return MAPS.reduce((sum, map) => sum + starsFor(this.bestTime(map.id)), 0);
  },

  isUnlocked(map) {
    return this.totalStars() >= map.stars;
  },

  // Returns whether that map is now selected.
  select(id) {
    const map = mapById(id);
    if (map.id !== id || !this.isUnlocked(map)) return false;
    this.selected = id;
    PlatformManager.setStoredValue(STORAGE_KEYS.selectedMap, id);
    return true;
  },

  // The next locked map, and how many more stars it takes. Null when every map is open.
  nextLocked() {
    const map = MAPS.find((candidate) => !this.isUnlocked(candidate));
    return map ? { map, needed: map.stars - this.totalStars() } : null;
  },

  // Records a run on the current map. Returns the maps it unlocked.
  submit(seconds) {
    const closed = MAPS.filter((map) => !this.isUnlocked(map));
    if (seconds > this.bestTime(this.selected)) {
      this.best[this.selected] = seconds;
      PlatformManager.setStoredValue(STORAGE_KEYS.mapBest, this.best);
    }
    return closed.filter((map) => this.isUnlocked(map));
  },
};

// The player's coins and cars, saved through the platform like everything else.
export const Garage = {
  coins: 0,
  unlocked: [CARS[0].id],
  selected: CARS[0].id,
  listeners: new Set(),

  async load() {
    const coins = Number(await PlatformManager.getStoredValue(STORAGE_KEYS.totalCoins, 0));
    const unlocked = await PlatformManager.getStoredValue(STORAGE_KEYS.unlockedCars, []);
    const selected = await PlatformManager.getStoredValue(STORAGE_KEYS.selectedCar, CARS[0].id);
    this.restore(coins, unlocked, selected);
  },

  // Saved data could be edited or come from an older version: only what makes sense is kept. The first car
  // is always owned, and only an owned car can be selected.
  restore(coins, unlocked, selected) {
    this.coins = Number.isFinite(coins) && coins > 0 ? Math.floor(coins) : 0;
    const list = Array.isArray(unlocked) ? unlocked : [];
    this.unlocked = CARS.filter((car, i) => i === 0 || list.includes(car.id)).map((car) => car.id);
    this.selected = this.unlocked.includes(selected) ? selected : CARS[0].id;
  },

  car() {
    return carById(this.selected);
  },

  owns(id) {
    return this.unlocked.includes(id);
  },

  canBuy(id) {
    return !this.owns(id) && CARS.some((car) => car.id === id) && this.coins >= carById(id).price;
  },

  // A car won (a survival challenge): owned, free. Returns whether it was new.
  grant(id) {
    if (this.owns(id) || !CARS.some((car) => car.id === id)) return false;
    this.unlocked.push(id);
    this.save();
    return true;
  },

  // Cars won by surviving long enough (CARS challenge): the ones this run's best times have just won.
  checkChallenges(bestNormal, bestHard) {
    const won = [];
    for (const car of CARS) {
      if (!car.challenge || this.owns(car.id)) continue;
      if (bestNormal >= car.challenge.normal || bestHard >= car.challenge.hard) {
        this.grant(car.id);
        won.push(car);
      }
    }
    return won;
  },

  // Returns whether the car was bought.
  buy(id) {
    if (!this.canBuy(id)) return false;
    this.coins -= carById(id).price;
    this.unlocked.push(id);
    this.save();
    return true;
  },

  // Returns whether that car is now selected.
  select(id) {
    if (!this.owns(id)) return false;
    this.selected = id;
    this.save();
    return true;
  },

  // Returns whether the coins were there to spend.
  spend(coins) {
    if (this.coins < coins) return false;
    this.coins -= coins;
    this.save();
    return true;
  },

  award(coins) {
    this.coins += Math.max(0, Math.floor(coins));
    this.save();
  },

  save() {
    PlatformManager.setStoredValue(STORAGE_KEYS.totalCoins, this.coins);
    PlatformManager.setStoredValue(STORAGE_KEYS.unlockedCars, this.unlocked);
    PlatformManager.setStoredValue(STORAGE_KEYS.selectedCar, this.selected);
    for (const listener of this.listeners) listener();
  },

  // Called whenever coins or cars change. Returns a function that stops it.
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
// 83.45 -> "01:23.45"
export function formatClock(seconds) {
  const hundredths = Math.floor(Math.max(0, seconds) * 100);
  const minutes = Math.floor(hundredths / 6000);
  const rest = (hundredths % 6000) / 100;
  return `${minutes < 10 ? '0' : ''}${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(2)}`;
}

// World units -> "48.82 M"
export function formatDistance(units) {
  const metres = Math.max(0, units) / UNITS_PER_METER;
  return `${metres.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
}
