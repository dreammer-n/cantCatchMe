// The platform boundary with a stand-in Playgama Bridge: an advert's pause and mute are let go soon after it closes,
// even if the platform never lifts them (players saw the game sit frozen after an advert).
let popups = 0;
const listeners = new Map();
const on = (name, fn) => listeners.set(name, fn);
const fire = (name, value) => listeners.get(name)(value);
globalThis.window = { addEventListener() {}, bridge: null };
globalThis.document = { hidden: false, addEventListener() {} };
const bridge = {
  EVENT_NAME: { AUDIO_STATE_CHANGED: 'audio', PAUSE_STATE_CHANGED: 'pause', INTERSTITIAL_STATE_CHANGED: 'inter', REWARDED_STATE_CHANGED: 'rew' },
  initialize: async () => {},
  platform: { id: 'youtube', language: 'en', isAudioEnabled: true, isPaused: false, on, sendMessage() {} },
  advertisement: { on, isInterstitialSupported: true, isRewardedSupported: true, interstitialState: 'closed', showInterstitial() { popups += 1; }, showRewarded() {} },
  storage: { get: async () => null, set: async () => {} },
};
window.bridge = bridge;
const { PlatformManager } = await import('../src/platform/PlatformManager.js');
let pass = 0;
let fail = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass += 1;
  else fail += 1;
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
await PlatformManager.initialize();
const log = [];
PlatformManager.onPause(() => log.push('pause'));
PlatformManager.onResume(() => log.push('resume'));
PlatformManager.onAudioEnabledChange((on) => log.push(on ? 'sound' : 'mute'));

// The platform pauses and mutes a moment before the advert says it opened, and never lifts them.
fire('pause', true);
fire('audio', false);
fire('inter', 'opened');
check('the game is paused while the advert shows', PlatformManager.isPaused());
fire('inter', 'closed');
check('still held for a moment after it closes', PlatformManager.isPaused());
await wait(700);
check('then the game wakes even though the platform never said so', !PlatformManager.isPaused() && log.includes('resume'));
check('and its sound comes back', PlatformManager.isAudioEnabled() && log.includes('sound'));

// A rewarded advert the same way; the reward still needs the platform's word.
fire('pause', true);
const ad = PlatformManager.showRewardedAd('revive');
fire('rew', 'opened');
fire('rew', 'rewarded');
fire('rew', 'closed');
check('the reward is given', (await ad) === true);
await wait(700);
check('and the game wakes after it', !PlatformManager.isPaused());

check('a reward earned is reported as such', PlatformManager.rewardedOutcome === 'rewarded');
PlatformManager.showInterstitial();
check('no pop-up advert straight after a rewarded one', popups === 0);

// Rewarded ads that give nothing say why: closed early, or none to show.
const early = PlatformManager.showRewardedAd('revive');
fire('rew', 'opened');
fire('rew', 'closed');
check('closed before the reward: no reward, and the game knows it was closed early', (await early) === false && PlatformManager.rewardedOutcome === 'closed');
await wait(700);
const none = PlatformManager.showRewardedAd('revive');
fire('rew', 'failed');
check('no ad to show: no reward, and the game knows there was none', (await none) === false && PlatformManager.rewardedOutcome === 'unavailable');

// A pause that has nothing to do with an advert is left alone.
fire('pause', true);
await wait(700);
check('a platform pause of its own stays', PlatformManager.isPaused());
fire('pause', false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
