import { STORAGE_KEYS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';

// Player settings, saved between visits. (Platform mute always wins over `sound`.)
export const Settings = {
  sound: true,

  async load() {
    const saved = await PlatformManager.getStoredValue(STORAGE_KEYS.settings, null);
    if (saved && typeof saved.sound === 'boolean') this.sound = saved.sound;
  },

  setSound(on) {
    this.sound = on;
    PlatformManager.setStoredValue(STORAGE_KEYS.settings, { sound: on });
  },
};
