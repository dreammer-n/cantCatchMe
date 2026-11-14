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
//       bridge.platform.language (read once, after initialize)
//     Checked against wiki.playgama.com/playgama/bridge-sdk/api/advertisement/interstitial, 2026-11-03:
//       bridge.advertisement.isInterstitialSupported, showInterstitial(placement)
//       EVENT_NAME.INTERSTITIAL_STATE_CHANGED: loading, opened, closed, failed. Bridge times them
//       (minimumDelayBetweenInterstitial in the config): the game only calls at each natural pause, with no timer
//       of its own.
//     Checked against wiki.playgama.com/playgama/bridge-sdk/api/advertisement/rewarded, 2026-10-31:
//       bridge.advertisement.isRewardedSupported
//       bridge.advertisement.showRewarded(placement)
//       bridge.advertisement.on(EVENT_NAME.REWARDED_STATE_CHANGED, state)
//         state: loading, opened, closed, rewarded, failed. Reward ONLY on 'rewarded', never on 'closed'.
//     Checked against wiki.playgama.com/playgama/bridge-sdk/api/analytics, 2026-11-07:
//       bridge.analytics.send(name, data): data a flat object of strings, numbers and booleans.
//   Local browser (no SDK): LocalStorage, page visibility for pause. On a platform neither is touched: progress is
//   saved only through Bridge storage, and the platform's own pause event covers a hidden page.
// Adverts: a rewarded one the player asks for, and an interstitial when a run ends. The one game event sent to
// Playgama's analytics is `performance_sample` (frame timings and error counts, systems/PerformanceSampler.js),
// through Bridge; no other requests are made.

const SDK_TIMEOUT_MS = 8000;
const SAVE_KEY = 'cantcatchme_save'; // everything is saved as one small object
const LOCAL_PREFIX = 'carchase:';
const SAVE_DELAY_MS = 400;
const AD_PLACEMENT = 'double_coins';
const INTERSTITIAL_PLACEMENT = 'game_over';
const AD_TIMEOUT_MS = 180000; // never leaves the player stuck if an ad doesn't report back
const AD_REWARD_GRACE_MS = 800; // some platforms may report 'rewarded' just after 'closed'
const AD_STUCK_MS = 1500; // an advert that never reported closing is let go by a tap on the game after this long
// After an advert says it has closed, the pause and mute that came with it are let go this soon if the platform
// hasn't lifted them itself: players saw the game sit frozen, as if lagging, after an advert had gone.
const AD_RELEASE_MS = 600;
// No pop-up advert this soon after the player watched a rewarded one (owner, 2026-11-14: fewer ads).
const NO_POPUP_AFTER_REWARDED_MS = 120000;

const state = {
  initialized: false,
  platformId: 'local',
  rewardedOutcome: null, // how the last rewarded ad went: 'rewarded', 'closed' (shut before the reward) or 'unavailable'
  rewardedShownAt: -Infinity, // when the last rewarded ad was on screen (Date.now())
  bridge: null,
  platformPaused: false,
  pageHidden: false,
  paused: false,
  readySent: false,
  audioEnabled: true,
  storageKind: 'memory',
  save: {},
  saveTimer: null,
  adOpen: false,
  interstitialOpen: false,
  adOpenedAt: 0,
  pauseFromAdvert: false, // the platform's pause / mute came with an advert (Bridge pauses and mutes while one shows)
  muteFromAdvert: false,
  language: 'en',
  onRewardedState: null,
  pendingAd: null,
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

// Paused when the platform says so, while an advert is open, or (in the local browser) while the page is hidden.
function updatePaused() {
  const paused = state.platformPaused || state.pageHidden || state.adOpen || state.interstitialOpen;
  if (state.paused === paused) return;
  state.paused = paused;
  emit(paused ? 'pause' : 'resume');
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
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
    bridge = window.bridge || null; // index.html loads the SDK before anything else, when it is there
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
    // The player's language comes only from the platform. The game is in English, which is also the fallback.
    state.language = bridge.platform.language || 'en';
  } catch {
    state.language = 'en';
  }
  try {
    state.audioEnabled = bridge.platform.isAudioEnabled !== false;
    state.platformPaused = bridge.platform.isPaused === true;
    if (events.AUDIO_STATE_CHANGED) {
      bridge.platform.on(events.AUDIO_STATE_CHANGED, (isEnabled) => {
        state.audioEnabled = Boolean(isEnabled);
        state.muteFromAdvert = !state.audioEnabled && advertOpen();
        emit('audio', state.audioEnabled);
      });
    }
    if (events.PAUSE_STATE_CHANGED) {
      bridge.platform.on(events.PAUSE_STATE_CHANGED, (isPaused) => {
        state.platformPaused = Boolean(isPaused);
        state.pauseFromAdvert = state.platformPaused && advertOpen();
        updatePaused();
      });
    }
  } catch (error) {
    console.warn('[platform] Bridge events unavailable:', error?.message || error);
  }
  try {
    if (bridge.advertisement && events.REWARDED_STATE_CHANGED) {
      bridge.advertisement.on(events.REWARDED_STATE_CHANGED, (adState) => {
        if (state.onRewardedState) state.onRewardedState(adState);
      });
    }
    if (bridge.advertisement && events.INTERSTITIAL_STATE_CHANGED) {
      const onInterstitial = (adState) => {
        const open = adState === 'opened';
        if (open && !state.interstitialOpen) {
          state.adOpenedAt = Date.now();
          holdCameWithAdvert();
        }
        const closing = state.interstitialOpen && !open;
        state.interstitialOpen = open;
        updatePaused();
        if (closing) releaseAdvertSoon();
      };
      bridge.advertisement.on(events.INTERSTITIAL_STATE_CHANGED, onInterstitial);
      onInterstitial(bridge.advertisement.interstitialState); // one may already be showing as the game starts
    }
    watchForStuckAdverts();
  } catch (error) {
    console.warn('[platform] Bridge adverts unavailable:', error?.message || error);
  }
  try {
    const saved = parseSave(await withTimeout(bridge.storage.get(SAVE_KEY), SDK_TIMEOUT_MS));
    if (saved) state.save = saved;
    state.storageKind = 'bridge';
  } catch (error) {
    console.warn('[platform] Bridge storage unavailable, keeping progress for this visit only:', error?.message || error);
  }
  return true;
}

// Safety net. The game sleeps while an advert is open and wakes when the platform says it has closed; if that word
// never comes, the game would stay frozen. While an advert covers the page, taps land on the advert, so a tap that
// lands on the game's own canvas or buttons means the advert has gone: the game carries on.
// Bridge's own pause and mute that came with the advert are let go too; a pause or mute the platform gave for any
// other reason is left alone.
function advertOpen() {
  return state.interstitialOpen || state.adOpen;
}

// The platform may pause and mute a moment before it says an advert has opened: those count as the advert's too.
function holdCameWithAdvert() {
  if (state.platformPaused) state.pauseFromAdvert = true;
  if (!state.audioEnabled) state.muteFromAdvert = true;
}

// Lets go of the pause and mute an advert brought, a moment after it has closed, unless the platform already has or
// another advert has opened. A pause or mute the platform gave for any other reason is left alone.
function releaseAdvertSoon() {
  clearTimeout(state.releaseTimer);
  state.releaseTimer = setTimeout(() => {
    if (advertOpen()) return;
    if (state.pauseFromAdvert) {
      state.platformPaused = false;
      state.pauseFromAdvert = false;
    }
    if (state.muteFromAdvert) {
      state.audioEnabled = true;
      state.muteFromAdvert = false;
      emit('audio', true);
    }
    updatePaused();
  }, AD_RELEASE_MS);
}

function watchForStuckAdverts() {
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (!advertOpen() && !state.pauseFromAdvert && !state.muteFromAdvert) return;
      if (Date.now() - state.adOpenedAt < AD_STUCK_MS) return;
      const target = event.target;
      if (!target || typeof target.closest !== 'function' || !target.closest('#game, #ui')) return;
      state.interstitialOpen = false;
      if (state.pauseFromAdvert) state.platformPaused = false;
      state.pauseFromAdvert = false;
      if (state.muteFromAdvert) {
        state.audioEnabled = true;
        state.muteFromAdvert = false;
        emit('audio', true);
      }
      updatePaused();
      // A rewarded ad: as if it had closed, so the reward still depends only on its 'rewarded' word.
      if (state.adOpen && state.onRewardedState) state.onRewardedState('closed');
    },
    { capture: true, passive: true },
  );
}

function watchPageVisibility() {
  state.pageHidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    state.pageHidden = document.hidden;
    updatePaused();
    if (document.hidden && state.saveTimer) {
      clearTimeout(state.saveTimer);
      writeSave(); // save right away when the player leaves
    }
  });
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
  if (localStore && !state.bridge) {
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
      // Keep playing; the copy in memory lasts for this visit.
    }
  }
}

export const PlatformManager = {
  async initialize() {
    if (state.initialized) return;
    if (!(await connectBridge())) {
      // The local browser, with no platform: its own storage and page visibility. On a platform neither is used.
      localStore = openLocalStorage();
      state.storageKind = localStore ? 'localStorage' : 'memory';
      if (localStore) state.save = parseSave(localStore.getItem(LOCAL_PREFIX + SAVE_KEY)) || {};
      watchPageVisibility();
    } else if (state.platformId === 'mock') {
      watchPageVisibility(); // the SDK's stand-in outside a real platform: nothing else would pause a hidden page
    }
    updatePaused();
    state.initialized = true;
  },

  get platformId() {
    return state.platformId;
  },

  // The player's language, as the platform gives it ('en' without one). The game is in English only.
  get language() {
    return state.language;
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

  // One game event for Playgama's analytics (a stable snake_case name; data flat, no player details). Never throws;
  // nothing happens without a platform.
  sendEvent(name, data = {}) {
    if (!state.bridge || state.platformId === 'mock') return;
    try {
      const analytics = state.bridge.analytics;
      if (analytics && typeof analytics.send === 'function') analytics.send(name, data);
    } catch {
      // Telemetry must never break the game.
    }
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

  // How a rewarded ad works here: 'platform' (a real one), 'none' (the platform has none: offer no button) or
  // 'simulated' (no platform at all: local testing, including the SDK's own 'mock' platform).
  // How the last rewarded ad went, so the screen can say why nothing came of it: 'rewarded', 'closed' or 'unavailable'.
  get rewardedOutcome() {
    return state.rewardedOutcome;
  },

  rewardedAdMode() {
    if (!state.bridge || state.platformId === 'mock') return 'simulated';
    return state.bridge.advertisement?.isRewardedSupported ? 'platform' : 'none';
  },

  // Shows a real rewarded ad. Resolves to true only if the platform says the reward was earned. The game is
  // paused and silent while it is open. Call only when the player has asked for one. placement: what it is for.
  showRewardedAd(placement = AD_PLACEMENT) {
    if (state.pendingAd) return state.pendingAd;
    if (this.rewardedAdMode() !== 'platform') return Promise.resolve(false);
    state.pendingAd = new Promise((resolve) => {
      let earned = false;
      let opened = false;
      let timer = null;
      const finish = () => {
        clearTimeout(timer);
        state.rewardedOutcome = earned ? 'rewarded' : opened ? 'closed' : 'unavailable';
        if (opened || earned) state.rewardedShownAt = Date.now();
        state.onRewardedState = null;
        state.pendingAd = null;
        state.adOpen = false;
        updatePaused();
        releaseAdvertSoon();
        resolve(earned);
      };
      state.onRewardedState = (adState) => {
        if (adState === 'opened') {
          opened = true;
          if (!state.adOpen) {
            state.adOpenedAt = Date.now();
            holdCameWithAdvert();
          }
          state.adOpen = true;
          updatePaused();
        } else if (adState === 'rewarded') {
          earned = true;
          if (!state.adOpen) finish();
        } else if (adState === 'closed') {
          state.adOpen = false;
          clearTimeout(timer);
          timer = setTimeout(finish, earned ? 0 : AD_REWARD_GRACE_MS);
        } else if (adState === 'failed') {
          finish();
        }
      };
      timer = setTimeout(finish, AD_TIMEOUT_MS);
      try {
        const result = state.bridge.advertisement.showRewarded(placement);
        if (result && typeof result.catch === 'function') result.catch(finish);
      } catch {
        finish();
      }
    });
    return state.pendingAd;
  },

  // At a natural pause (a run has ended). Bridge decides whether an advert is due, so there is no timer here, and
  // while one is open the game is paused and silent (updatePaused). Nothing happens without a platform.
  showInterstitial() {
    const ads = state.bridge && state.bridge.advertisement;
    if (!ads || !ads.isInterstitialSupported) return;
    if (Date.now() - state.rewardedShownAt < NO_POPUP_AFTER_REWARDED_MS) return; // they have just watched one
    try {
      const result = ads.showInterstitial(INTERSTITIAL_PLACEMENT);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // No advert: carry on.
    }
  },

  // ---- Leaderboards ----
  // How this platform does leaderboards (Bridge): 'not_available' (none), 'in_game' (the game draws it from
  // leaderboardEntries), 'native' (the platform shows it; the game only sends scores) or 'native_popup' (the game
  // opens the platform's own window with showLeaderboard).
  leaderboardMode() {
    if (!state.bridge || !state.bridge.leaderboards) return 'not_available';
    return state.bridge.leaderboards.type || 'not_available';
  },

  // Sends a score. Never throws and never holds the game up.
  submitScore(id, score) {
    if (this.leaderboardMode() === 'not_available') return;
    try {
      withTimeout(Promise.resolve(state.bridge.leaderboards.setScore(id, score)), SDK_TIMEOUT_MS).catch(() => {});
    } catch {
      // A leaderboard that fails must not break the game.
    }
  },

  // The top of a leaderboard: [{ name, score, rank }], or null if it can't be had here or now.
  async leaderboardEntries(id) {
    if (this.leaderboardMode() !== 'in_game') return null;
    try {
      const entries = await withTimeout(Promise.resolve(state.bridge.leaderboards.getEntries(id)), SDK_TIMEOUT_MS);
      return Array.isArray(entries) ? entries.map((e) => ({ name: String(e.name || ''), score: Number(e.score) || 0, rank: Number(e.rank) || 0 })) : null;
    } catch {
      return null;
    }
  },

  showLeaderboard(id) {
    if (this.leaderboardMode() !== 'native_popup') return;
    try {
      withTimeout(Promise.resolve(state.bridge.leaderboards.showNativePopup(id)), SDK_TIMEOUT_MS).catch(() => {});
    } catch {
      // Nothing to do.
    }
  },

  // Writes pending changes now (e.g. right after a run ends).
  flush() {
    if (!state.saveTimer) return;
    clearTimeout(state.saveTimer);
    writeSave();
  },
};
