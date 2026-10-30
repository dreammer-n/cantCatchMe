// The only place that knows which platform the game runs on.
// Gameplay code calls these neutral methods and never talks to a platform SDK directly.
//
// Adapters:
//   Playgama Bridge v2 (YouTube Playables, Playgama and the other portals Bridge supports).
//     The SDK file `playgama-bridge.js` is bundled next to index.html (see vite.config.js and
//     README); it is loaded from there, never from the internet.
//     Calls used (checked against wiki.playgama.com, Bridge 2.3, 2026-10-29):
//       bridge.initialize()                              -> Promise
//       bridge.platform.id                               -> 'youtube', 'playgama', ... 'mock' locally
//       bridge.platform.sendMessage('game_ready')         required, once the player can interact
//       bridge.platform.sendMessage('level_started' | 'level_failed' | 'level_paused' | 'level_resumed')
//       bridge.platform.isAudioEnabled + EVENT_NAME.AUDIO_STATE_CHANGED (isEnabled)
//       bridge.platform.isPaused       + EVENT_NAME.PAUSE_STATE_CHANGED (isPaused)
//       bridge.storage.get(key) -> Promise(value | null), bridge.storage.set(key, value) -> Promise
//   Local browser (no SDK): LocalStorage, page visibility for pause.
// No adverts, analytics or external requests are made.

const SDK_FILE = './playgama-bridge.js';
const SDK_TIMEOUT_MS = 8000;
const SAVE_KEY = 'cantcatchme_save'; // everything is saved as one small object
const LOCAL_PREFIX = 'carchase:';
const SAVE_DELAY_MS = 400;

const state = {
  initialized: false,
  platformId: 'local',
  bridge: null,
  platformPaused: false,
  pageHidden: false,
  paused: false,
  readySent: false,
  audioEnabled: true,
  storageKind: 'memory',
  save: {},
  saveTimer: null,
};

const listeners = {
  pause: new Set(),
  resume: new Set(),
  audio: new Set(),
};

let localStore = null;

function emit(type, value) {
  listeners[type].forEach((callback) => callback(value));
}

function subscribe(type, callback) {
  listeners[type].add(callback);
  return () => listeners[type].delete(callback);
}

function openLocalStorage() {
  try {
    const testKey = `${LOCAL_PREFIX}__test`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

// Paused when the platform says so OR the page is hidden (tab switched, phone locked).
function updatePaused() {
  const paused = state.platformPaused || state.pageHidden;
  if (state.paused === paused) return;
  state.paused = paused;
  emit(paused ? 'pause' : 'resume');
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

// Loads the bundled SDK file, if it exists. Resolves to window.bridge or null.
function loadBridgeScript() {
  if (window.bridge) return Promise.resolve(window.bridge);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_FILE;
    script.async = true;
    script.onload = () => resolve(window.bridge || null);
    script.onerror = () => {
      script.remove();
      resolve(null);
    };
    document.head.appendChild(script);
  });
}

function parseSave(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function connectBridge() {
  let bridge = null;
  try {
    bridge = await withTimeout(loadBridgeScript(), SDK_TIMEOUT_MS);
    if (!bridge) return false;
    await withTimeout(bridge.initialize(), SDK_TIMEOUT_MS);
  } catch (error) {
    console.warn('[platform] Playgama Bridge unavailable, running locally:', error?.message || error);
    return false;
  }
  state.bridge = bridge;
  state.platformId = bridge.platform?.id || 'unknown';
  const events = bridge.EVENT_NAME || {};
  try {
    state.audioEnabled = bridge.platform.isAudioEnabled !== false;
    state.platformPaused = bridge.platform.isPaused === true;
    if (events.AUDIO_STATE_CHANGED) {
      bridge.platform.on(events.AUDIO_STATE_CHANGED, (isEnabled) => {
        state.audioEnabled = Boolean(isEnabled);
        emit('audio', state.audioEnabled);
      });
    }
    if (events.PAUSE_STATE_CHANGED) {
      bridge.platform.on(events.PAUSE_STATE_CHANGED, (isPaused) => {
        state.platformPaused = Boolean(isPaused);
        updatePaused();
      });
    }
  } catch (error) {
    console.warn('[platform] Bridge events unavailable:', error?.message || error);
  }
  try {
    const saved = parseSave(await withTimeout(bridge.storage.get(SAVE_KEY), SDK_TIMEOUT_MS));
    if (saved) state.save = saved;
    state.storageKind = 'bridge';
  } catch (error) {
    console.warn('[platform] Bridge storage unavailable, using the browser:', error?.message || error);
  }
  return true;
}

function sendMessage(message) {
  if (!state.bridge) return;
  try {
    const result = state.bridge.platform.sendMessage(message);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Messages are optional except game_ready; never let them break the game.
  }
}

function writeSave() {
  state.saveTimer = null;
  const raw = JSON.stringify(state.save);
  if (localStore) {
    try {
      localStore.setItem(LOCAL_PREFIX + SAVE_KEY, raw);
    } catch {
      // Storage full or blocked: the in-memory copy still lasts for this visit.
    }
  }
  if (state.bridge && state.storageKind === 'bridge') {
    try {
      const result = state.bridge.storage.set(SAVE_KEY, raw);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Keep playing; the local copy is still there.
    }
  }
}

export const PlatformManager = {
  async initialize() {
    if (state.initialized) return;
    localStore = openLocalStorage();
    state.storageKind = localStore ? 'localStorage' : 'memory';
    if (localStore) state.save = parseSave(localStore.getItem(LOCAL_PREFIX + SAVE_KEY)) || {};

    await connectBridge();

    // Page visibility as a safety net on every platform (the platform's own pause event, when
    // there is one, is followed too).
    state.pageHidden = document.hidden;
    document.addEventListener('visibilitychange', () => {
      state.pageHidden = document.hidden;
      updatePaused();
      if (document.hidden && state.saveTimer) {
        clearTimeout(state.saveTimer);
        writeSave(); // save right away when the player leaves
      }
    });
    updatePaused();
    state.initialized = true;
  },

  get platformId() {
    return state.platformId;
  },

  get storageKind() {
    return state.storageKind;
  },

  get readySent() {
    return state.readySent;
  },

  // Call once, when the player can first interact with the game (the menu is showing).
  gameReady() {
    if (state.readySent) return;
    state.readySent = true;
    sendMessage('game_ready');
  },

  // Run lifecycle (optional platform analytics messages, no data leaves the platform SDK).
  runStarted() {
    sendMessage('level_started');
  },

  runFailed() {
    sendMessage('level_failed');
  },

  runPaused() {
    sendMessage('level_paused');
  },

  runResumed() {
    sendMessage('level_resumed');
  },

  isPaused() {
    return state.paused;
  },

  onPause(callback) {
    return subscribe('pause', callback);
  },

  onResume(callback) {
    return subscribe('resume', callback);
  },

  // Platform audio permission. In-game sound settings must never override this.
  isAudioEnabled() {
    return state.audioEnabled;
  },

  onAudioEnabledChange(callback) {
    return subscribe('audio', callback);
  },

  async getStoredValue(key, fallback = null) {
    const value = state.save[key];
    return value === undefined || value === null ? fallback : JSON.parse(JSON.stringify(value));
  },

  // Saved shortly after the last change (several values changing together = one write).
  async setStoredValue(key, value) {
    state.save[key] = value;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(writeSave, SAVE_DELAY_MS);
  },

  // Writes pending changes now (e.g. right after a run ends).
  flush() {
    if (!state.saveTimer) return;
    clearTimeout(state.saveTimer);
    writeSave();
  },
};
