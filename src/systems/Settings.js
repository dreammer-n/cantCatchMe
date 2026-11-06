import { STORAGE_KEYS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';

// Player settings, saved between visits. sound: the effects; music: the music. (Platform mute always wins over both.)
// hardStart: runs start as hard as they used to (HEAT_HARD), for more coins.
export const Settings = {
  sound: true,
  music: true,
  hardStart: false,

  async load() {
    const saved = await PlatformManager.getStoredValue(STORAGE_KEYS.settings, null);
    if (saved && typeof saved.sound === 'boolean') this.sound = saved.sound;
    // A save from when one button did both: music follows what it said.
    if (saved) this.music = typeof saved.music === 'boolean' ? saved.music : this.sound;
    if (saved && typeof saved.hardStart === 'boolean') this.hardStart = saved.hardStart;
  },

  setHardStart(on) {
    this.hardStart = on;
    this.save();
  },

  setSound(on) {
    this.sound = on;
    this.save();
  },

  setMusic(on) {
    this.music = on;
    this.save();
  },

  save() {
    PlatformManager.setStoredValue(STORAGE_KEYS.settings, { sound: this.sound, music: this.music, hardStart: this.hardStart });
  },
};
