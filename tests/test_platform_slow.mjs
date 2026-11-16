// A Playgama Bridge that is slow to start (seen: about 15 s when the game page is opened outside Playgama's own page).
// The game goes on without it, never fakes an advert meanwhile, and takes it up as soon as it is ready.
let rewardedAsked = 0;
const sent = [];
globalThis.window = { addEventListener() {}, bridge: null };
globalThis.document = { hidden: false, addEventListener() {} };
globalThis.localStorage = undefined;
let ready;
const bridge = {
  EVENT_NAME: { AUDIO_STATE_CHANGED: 'audio', PAUSE_STATE_CHANGED: 'pause', INTERSTITIAL_STATE_CHANGED: 'inter', REWARDED_STATE_CHANGED: 'rew' },
  initialize: () => new Promise((done) => { ready = done; }),
  platform: { id: 'playgama_sandbox', language: 'en', isAudioEnabled: true, isPaused: false, on() {}, sendMessage(m) { sent.push(m); } },
  advertisement: { on() {}, isInterstitialSupported: true, isRewardedSupported: true, interstitialState: 'closed', showInterstitial() {}, showRewarded() { rewardedAsked += 1; } },
  storage: { get: async () => null, set: async () => {} },
};
window.bridge = bridge;
const { PlatformManager } = await import('../src/platform/PlatformManager.js');
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
};
const started = Date.now();
await PlatformManager.initialize();
check('the game does not wait for it for ever', Date.now() - started < 9000, `${Date.now() - started} ms`);
PlatformManager.gameReady();
check('while it is still starting, no fake advert: the button is a real one', PlatformManager.rewardedAdMode() === 'platform', PlatformManager.rewardedAdMode());
check('asked for one now, there is none yet, and no reward', (await PlatformManager.showRewardedAd('revive')) === false && PlatformManager.rewardedOutcome === 'unavailable');
ready();
await new Promise((done) => setTimeout(done, 50));
check('once ready it is taken up: the platform is known', PlatformManager.platformId === 'playgama_sandbox');
check('game_ready goes to the platform late rather than never', sent.includes('game_ready'));
PlatformManager.showRewardedAd('revive');
check('and the next rewarded advert is a real one', rewardedAsked === 1);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
