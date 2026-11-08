import { STORAGE_KEYS, TUTORIAL } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Records } from './ScoreSystem.js';

// Which one-time hints a player has seen (scenes/Coach.js), saved between visits. 'steer' is the first drive's
// steering lesson: until it is done, a new player starts on the road rather than the title.
export const Tips = {
  seen: new Set(),

  async load() {
    const saved = await PlatformManager.getStoredValue(STORAGE_KEYS.tips, null);
    this.seen = new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []);
  },

  has(id) {
    return this.seen.has(id);
  },

  mark(id) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    PlatformManager.setStoredValue(STORAGE_KEYS.tips, [...this.seen]);
  },

  // A brand-new player: no run ever played, steering not learnt yet.
  firstDrive() {
    return !this.seen.has('steer') && Records.totals.runs === 0;
  },

  // The basic hints are for new players only; someone who has played a while knows them already.
  wantsBasics() {
    return Records.totals.runs < TUTORIAL.basicsRuns;
  },
};
