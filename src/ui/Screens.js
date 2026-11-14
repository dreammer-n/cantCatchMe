import { ADS, COINS, FEEDBACK, LEVELS, MAPS, STARS, UPGRADES, carSpecs, withMapPalette } from '../config/tuning.js';
import { carMesh } from '../render/carModels.js';
import { paintMesh, projectMesh } from '../render/lowpoly.js';
import { drawMapDiorama } from '../render/mapDiorama.js';
import { projection } from '../render/projection.js';
import { Garage, Maps, Records, formatClock, formatDistance, starsFor } from '../systems/ScoreSystem.js';
import { Missions } from '../systems/Missions.js';
import { Progress } from '../systems/Progress.js';
import { dt, setDisplay } from './displayFont.js';
import { ICONS, button, el, uiRoot } from './dom.js';

// Full-screen menus: title, pause, results, garage and maps. Each has one primary action that Enter / Space /
// gamepad A also trigger (see the scenes), so every screen works with any input device.

function iconSpan(svg) {
  const span = el('span', 'btn-glyph');
  span.innerHTML = svg;
  return span;
}

// A button with the game's lettering. node.setText(text) changes what it says.
function textButton(className, text, onPress, label, icon) {
  const words = dt('', text);
  const node = button(`btn ${className}`, el('span', 'btn-inner', [icon ? iconSpan(icon) : null, words]), onPress, label);
  node.setText = (value) => setDisplay(words, value);
  return node;
}

function toggleButton(onToggle, iconOn, iconOff, label) {
  const node = button('btn btn-icon btn-sound', iconOn, () => onToggle(), label);
  node.setOn = (on) => {
    node.innerHTML = on ? iconOn : iconOff;
    node.setAttribute('aria-pressed', String(on));
    node.classList.toggle('off', !on);
  };
  return node;
}

const soundButton = (onToggle) => toggleButton(onToggle, ICONS.soundOn, ICONS.soundOff, 'Sound effects on / off');
const musicButton = (onToggle) => toggleButton(onToggle, ICONS.musicOn, ICONS.musicOff, 'Music on / off');

class Screen {
  constructor(className, children) {
    this.node = el('div', `screen ${className}`, [el('div', 'screen-panel', children)]);
    this.node.hidden = true;
    uiRoot().append(this.node);
  }

  show() {
    this.stopMoving();
    this.node.hidden = false;
    this.node.classList.remove('leaving');
  }

  hide() {
    this.stopMoving();
    this.node.hidden = true;
  }

  // ---- The move between PLAY's steps: one camera going in (or back out) ----
  // The screen going away keeps showing (it can't be pressed) until the new one is drawn and ready; then both move
  // together on the same frame: going on, the old one grows and fades as the new one comes up from a little
  // smaller; going back, the reverse. Nothing heavy runs while they move, so it stays smooth.

  // Called by the screen coming in, after it has drawn itself.
  zoom(back = false) {
    this.stopMoving();
    const node = this.node;
    node.hidden = false;
    node.classList.add('zoom-pre');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        node.classList.remove('zoom-pre');
        node.classList.add(back ? 'zoom-back' : 'zoom-in');
        for (const other of [...OUTGOING]) other.runLeave();
        this.moveTimer = setTimeout(() => node.classList.remove('zoom-in', 'zoom-back'), ZOOM_MS);
      }),
    );
  }

  // Called by the screen going away: it waits for the next one (or a moment, if none comes).
  leave(back = false) {
    if (this.node.hidden || this.leaving) return;
    this.stopMoving();
    this.leaving = back ? 'zoom-leave-back' : 'zoom-leave';
    this.node.classList.add('zoom-hold');
    OUTGOING.add(this);
    this.fallback = setTimeout(() => this.runLeave(), LEAVE_WAIT_MS);
  }

  runLeave() {
    if (!OUTGOING.has(this)) return;
    OUTGOING.delete(this);
    clearTimeout(this.fallback);
    this.node.classList.add(this.leaving);
    this.moveTimer = setTimeout(() => this.hide(), ZOOM_MS);
  }

  stopMoving() {
    OUTGOING.delete(this);
    clearTimeout(this.fallback);
    clearTimeout(this.moveTimer);
    this.leaving = null;
    this.node.classList.remove('zoom-pre', 'zoom-in', 'zoom-back', 'zoom-hold', 'zoom-leave', 'zoom-leave-back');
  }
}

const ZOOM_MS = 420; // as long as the .zoom-* animations in main.css
const LEAVE_WAIT_MS = 300;
const OUTGOING = new Set();

export const formatCoins = (n) => Math.round(n).toLocaleString('en-US');

function coinGlyph() {
  const glyph = el('span', 'coin-glyph');
  glyph.innerHTML = ICONS.coin;
  return glyph;
}

// The player's coins, in the top-right corner of a screen.
function coinBadge() {
  const value = dt('coin-balance-value', '0');
  const node = el('div', 'coin-balance', [coinGlyph(), value]);
  node.setCoins = (coins) => setDisplay(value, formatCoins(coins));
  return node;
}

// The stars earned so far, in the top-left corner of a screen.
function starBadge() {
  const glyph = el('span', 'star-glyph');
  glyph.innerHTML = ICONS.star;
  const value = dt('', '0');
  const node = el('div', 'star-balance', [value, glyph]);
  node.setStars = (stars) => setDisplay(value, String(stars));
  return node;
}

function starRow(className, count = STARS.length) {
  return Array.from({ length: count }, () => {
    const star = el('span', className);
    star.innerHTML = ICONS.star;
    return star;
  });
}

// The player's level and a bar toward the next one.
function levelBar(className) {
  const label = dt('level-label', '');
  const fill = el('span', 'level-fill');
  const node = el('div', `level-bar ${className}`, [label, el('span', 'level-track', [fill])]);
  node.set = (level, share) => {
    setDisplay(label, `LEVEL ${level}`);
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`;
  };
  return node;
}

// The three missions: what each asks, and its reward (or how far it has got, for those that add up over runs).
function missionList() {
  const rows = Array.from({ length: 3 }, () => {
    const text = dt('mission-text', '');
    const side = dt('mission-side', '');
    return { node: el('div', 'mission-row', [text, side]), text, side };
  });
  const node = el('div', 'mission-list', rows.map((row) => row.node));
  node.set = (missions) => {
    rows.forEach((row, i) => {
      const m = missions[i];
      row.node.hidden = !m;
      if (!m) return;
      setDisplay(row.text, Missions.describe(m));
      const progress = Missions.progressText(m);
      setDisplay(row.side, progress ? `${progress} · +${m.reward}` : `+${m.reward}`);
    });
  };
  return node;
}

// Counts a number up on screen. Returns a function that stops it.
function countUp(node, from, to, ms, format = formatCoins) {
  const start = performance.now();
  let frame = 0;
  // The clock is read here rather than trusted from the frame callback, and a missing or bad length shows the final
  // number at once: the tally must never read NaN.
  const step = () => {
    const elapsed = performance.now() - start;
    const t = Number.isFinite(elapsed) && ms > 0 ? Math.min(1, Math.max(0, elapsed / ms)) : 1;
    setDisplay(node, format(from + (to - from) * (1 - (1 - t) * (1 - t))));
    if (t < 1) frame = requestAnimationFrame(step);
  };
  setDisplay(node, format(from));
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    setDisplay(node, format(to));
  };
}

// Stands in for a rewarded ad when there is no platform to show one (local testing).
export function simulateAd() {
  return new Promise((resolve) => {
    const text = dt('ad-sim-text', 'SIMULATING AD... 2...');
    const node = el('div', 'ad-sim', [text]);
    uiRoot().append(node);
    setTimeout(() => setDisplay(text, 'SIMULATING AD... 1...'), 1000);
    setTimeout(() => setDisplay(text, 'REWARD GRANTED!'), 2000);
    setTimeout(() => {
      node.remove();
      resolve(true);
    }, 2500);
  });
}

// The HARD START leaderboard, on platforms where the game draws it itself.
export class LeaderboardScreen extends Screen {
  constructor({ onClose, onHardStart }) {
    const list = el('ol', 'board-list');
    const status = dt('board-status', '');
    const mine = dt('board-mine', '');
    // Only HARD START runs go on the board: with it off, say so and offer to turn it on.
    const join = el('div', 'board-join', [
      dt('board-join-text', 'TURN ON HARD START TO GET ON THE BOARD'),
      textButton('btn-secondary', 'TURN ON HARD START', () => onHardStart(), 'Turn on hard start'),
    ]);
    super('board', [
      el('h2', 'screen-title', [dt('', 'HARD START')]),
      dt('board-sub', 'LONGEST RUNS'),
      list,
      status,
      mine,
      join,
      textButton('btn-primary', 'BACK', onClose, 'Back'),
    ]);
    this.list = list;
    this.status = status;
    this.mine = mine;
    this.join = join;
  }

  showLoading(best, hardOn) {
    this.list.replaceChildren();
    setDisplay(this.status, 'LOADING');
    setDisplay(this.mine, best > 0 ? `YOUR BEST: ${formatClock(best)}` : 'NO HARD START RUN YET');
    this.setHardOn(hardOn);
    this.show();
  }

  setHardOn(on) {
    this.join.hidden = on;
  }

  // entries: [{ name, score, rank }] or null if they couldn't be had.
  showEntries(entries, shown) {
    if (!entries) {
      setDisplay(this.status, "COULDN'T LOAD THE LEADERBOARD");
      return;
    }
    setDisplay(this.status, entries.length ? '' : 'NO RUNS YET: BE THE FIRST');
    this.list.replaceChildren(
      ...entries.slice(0, shown).map((entry, i) => {
        // Names are the players' own: plain text, never the game's lettering, which can't draw every character.
        const name = el('span', 'board-name');
        name.textContent = entry.name || 'PLAYER';
        return el('li', 'board-row', [dt('board-rank', String(entry.rank || i + 1)), name, dt('board-time', formatClock(entry.score))]);
      }),
    );
  }
}

// The title: the logo, one mission, PLAY, and small icons. PLAY leads on to the map, then the car (MapScene,
// GarageScene), one choice per screen.
export class MenuScreen extends Screen {
  constructor({ onPlay, onSound, onMusic, onBoard }) {
    // A small logo at the top (owner, 2026-11-14): the map, the car and the police cruising round it are the title.
    const logo = el('h1', 'logo', [dt('logo-line', "CAN'T CATCH"), dt('logo-line logo-me', 'ME!')]);
    const play = textButton('btn-primary btn-play', 'PLAY', onPlay, 'Play', ICONS.play);
    const sound = soundButton(onSound);
    const music = musicButton(onMusic);
    // The leaderboard, only where there is one to show.
    const board = button('btn btn-icon btn-board', ICONS.trophy, () => onBoard(), 'Hard start leaderboard');
    // The first mission on one line; a tap opens all three.
    const missionLine = dt('menu-mission-line', '');
    const missions = missionList();
    missions.hidden = true;
    const goals = button('menu-goals', '', () => {
      missions.hidden = !missions.hidden;
      missionLine.hidden = !missions.hidden;
    }, 'Missions');
    goals.append(missionLine, missions);
    super('menu', [
      el('div', 'menu-top', [logo]),
      el('div', 'menu-bottom', [goals, play, el('div', 'menu-row', [sound, music, board])]),
    ]);
    // Your level: a small badge in the corner, under the stars.
    const level = levelBar('menu-level-badge');
    Object.assign(this, { play, board, level, missions, missionLine, sound, music });
    this.balance = coinBadge();
    this.stars = starBadge();
    this.node.append(this.balance, this.stars, level);
  }

  refresh(coins) {
    this.balance.setCoins(coins);
    this.stars.setStars(Maps.totalStars());
    this.level.set(Progress.level, Progress.share);
    this.missions.set(Missions.active);
    const first = Missions.active[0];
    setDisplay(this.missionLine, first ? `MISSION: ${Missions.describe(first)} +${first.reward}` : '');
  }

  show({ soundOn, musicOn, coins, boardShown }) {
    this.refresh(coins);
    this.board.hidden = !boardShown;
    this.sound.setOn(soundOn);
    this.music.setOn(musicOn);
    super.show();
  }
}

export class PauseScreen extends Screen {
  constructor({ onResume, onRestart, onMenu, onSound, onMusic }) {
    const resume = textButton('btn-primary', 'RESUME', onResume, 'Resume', ICONS.play);
    const sound = soundButton(onSound);
    const music = musicButton(onMusic);
    super('pause', [
      el('h2', 'screen-title', [dt('', 'PAUSED')]),
      resume,
      el('div', 'menu-row', [textButton('btn-secondary', 'RESTART', onRestart, 'Restart'), textButton('btn-secondary', 'MENU', onMenu, 'Main menu')]),
      el('div', 'menu-row', [sound, music]),
    ]);
    this.sound = sound;
    this.music = music;
  }

  show({ soundOn, musicOn }) {
    this.sound.setOn(soundOn);
    this.music.setOn(musicOn);
    super.show();
  }
}

// The line under an ad button saying why it gave nothing (ADS.notes): no ad to show, or closed before the end.
function adNote() {
  const node = dt('ad-note', '');
  node.hidden = true;
  node.say = (outcome) => {
    node.hidden = !outcome;
    if (outcome) setDisplay(node, ADS.notes[outcome] || ADS.notes.unavailable);
  };
  return node;
}

// After a crash: carry on for coins, or for an ad, before the results. Counts down by itself.
export class ReviveScreen extends Screen {
  constructor({ onPay, onAd, onDecline }) {
    const count = dt('revive-count', '5');
    const pay = textButton('btn-primary', 'REVIVE', onPay, 'Revive with coins');
    const ad = textButton('btn-secondary', 'WATCH AD: REVIVE', onAd, 'Watch an ad to revive');
    const note = adNote();
    const balance = coinBadge();
    super('revive', [
      balance,
      el('h2', 'screen-title', [dt('', 'CONTINUE?')]),
      count,
      pay,
      ad,
      note,
      textButton('btn-secondary', 'NO THANKS', onDecline, 'See the results'),
    ]);
    this.count = count;
    this.pay = pay;
    this.ad = ad;
    this.note = note;
    this.balance = balance;
  }

  show({ cost, canPay, adMode, coins }) {
    this.cost = cost;
    this.pay.hidden = !canPay;
    this.pay.setText(`REVIVE · ${formatCoins(cost)} COINS`);
    this.ad.hidden = adMode === 'none';
    this.setAdState('ready');
    this.balance.setCoins(coins);
    this.setCount(5);
    super.show();
  }

  setCount(seconds) {
    setDisplay(this.count, String(Math.max(0, Math.ceil(seconds))));
  }

  // failed: outcome says why (PlatformManager.rewardedOutcome), on a line under the button.
  setAdState(state, outcome = 'unavailable') {
    this.ad.disabled = state === 'busy';
    this.pay.disabled = state === 'busy';
    if (state === 'ready') this.ad.setText('WATCH AD: REVIVE');
    if (state === 'busy') this.ad.setText('LOADING AD...');
    if (state === 'failed') this.ad.setText('TRY AGAIN');
    this.note.say(state === 'failed' ? outcome : null);
  }
}

const CAUSES = {
  police: 'RAMMED BY THE POLICE',
  pinned: 'BOXED IN BY THE POLICE',
  wreck: 'YOU HIT A BURNING WRECK',
  obstacle: 'YOU CRASHED INTO THE SCENERY',
  void: 'FELL INTO THE VOID',
  roadblock: 'YOU HIT A ROADBLOCK',
  bearcat: 'FLATTENED BY A SWAT TRUCK',
  airstrike: 'CAUGHT IN THE AIRSTRIKE',
  flipped: 'FLIPPED OVER',
};

export class GameOverScreen extends Screen {
  constructor({ onRetry, onMenu, onGarage, onDouble, onFeedback }) {
    let garageButton = null;
    // One question, once (FEEDBACK): a tap on an answer sends it and says thanks.
    const feedbackText = dt('over-feedback-text', FEEDBACK.question);
    const feedbackChoices = el('div', 'over-feedback-choices', FEEDBACK.choices.map((c) => textButton('btn-secondary over-feedback-choice', c.text, () => onFeedback(c.id), c.text)));
    const feedback = el('div', 'over-feedback', [feedbackText, feedbackChoices]);
    feedback.hidden = true;
    const cause = dt('over-cause', '');
    const time = dt('over-time', '00:00.00');
    const stars = starRow('over-star');
    const badge = dt('over-badge', '');
    const next = dt('over-next', '');
    const advice = dt('over-tip', ''); // a new player's tip on why the crash happened
    const rows = el('div', 'over-rows', '');
    // Missions done in this run, and the level bar filling (LEVEL UP! when it gets there).
    const doneList = el('div', 'over-missions', '');
    const level = levelBar('over-level');
    const levelUp = dt('over-levelup', '');
    const earned = dt('over-coins-value', '0');
    const earnedRow = el('div', 'over-coins', [coinGlyph(), dt('over-coins-plus', '+'), earned, dt('over-coins-label', 'COINS')]);
    const breakdown = dt('over-breakdown', '');
    const double = textButton('btn-gold', '', onDouble, 'Double your coins by watching an ad', ICONS.film);
    const adLine = adNote();
    // Two groups: stacked on a tall screen, side by side on a phone held sideways.
    super('over', [
      el('div', 'over-group', [el('h2', 'screen-title over-title', [dt('', 'BUSTED!')]), cause, time, el('div', 'over-stars', stars), badge, next, advice]),
      el('div', 'over-group', [
        doneList,
        level,
        levelUp,
        rows,
        earnedRow,
        breakdown,
        double,
        adLine,
        feedback,
        textButton('btn-primary', 'RETRY', onRetry, 'Retry', ICONS.retry),
        el('div', 'menu-row over-small-row', [(garageButton = textButton('btn-secondary', 'GARAGE', onGarage, 'Garage')), textButton('btn-secondary', 'MENU', onMenu, 'Main menu')]),
      ]),
    ]);
    this.balance = coinBadge();
    this.node.append(this.balance);
    Object.assign(this, { cause, time, stars, badge, next, advice, rows, earned, breakdown, double, adLine, doneList, level, levelUp, feedback, feedbackText, feedbackChoices, garageButton });
  }

  thankFeedback() {
    setDisplay(this.feedbackText, FEEDBACK.thanks);
    this.feedbackChoices.hidden = true;
  }

  showCoins(coins) {
    this.balance.setCoins(coins);
  }

  // failed: outcome says why (PlatformManager.rewardedOutcome), on a line under the button.
  setDoubleState(state, outcome = 'unavailable') {
    const node = this.double;
    node.disabled = state === 'busy' || state === 'done';
    node.classList.toggle('btn-done', state === 'done');
    if (state === 'ready') node.setText(`WATCH AD: DOUBLE COINS (+${formatCoins(this.coinTotal)})`);
    if (state === 'busy') node.setText('LOADING AD...');
    if (state === 'failed') node.setText('TRY AGAIN');
    if (state === 'done') node.setText('COINS DOUBLED!');
    this.adLine.say(state === 'failed' ? outcome : null);
  }

  // The tally and the balance climb to their new totals.
  showDoubled(extra, balance) {
    if (this.stopCount) this.stopCount();
    this.setDoubleState('done');
    this.stopCount = countUp(this.earned, this.coinTotal, this.coinTotal + extra, COINS.tallyMs);
    this.coinTotal += extra;
    this.showCoins(balance);
  }

  // Minimal: BUSTED!, the time and stars, ONE line, the coins (and doubling them), RETRY, then GARAGE and MENU small.
  show({ summary, best, newBest, cause, coins, mapUnlocks, nextMap, doubled, balance, adMode, canDouble = true, crashTip, missions = [], progress = null, askFeedback = false, goal = null, carWon = null, garagePointer = false }) {
    this.feedback.hidden = !askFeedback;
    this.feedbackChoices.hidden = false;
    setDisplay(this.feedbackText, FEEDBACK.question);
    // Kept short: one highlight line, the coins (missions folded in), the level bar, the buttons.
    this.advice.hidden = true;
    this.doneList.hidden = true;
    this.levelUp.hidden = true;
    this.next.hidden = true;
    this.rows.hidden = true;
    this.cause.hidden = true; // why it ended: the one line below covers it when it matters (the crash tip)
    this.level.hidden = true; // a level-up is the one line
    let levelLine = null;
    if (progress) {
      // From where the bar was before the run to where it is now (empty first if a level was reached).
      this.level.set(progress.before.level, progress.before.share);
      clearTimeout(this.levelTimer);
      this.levelTimer = setTimeout(() => this.level.set(progress.level, progress.share), 350);
      const reached = progress.levelUps;
      if (reached.length) {
        const pay = reached.reduce((sum, lv) => sum + lv * LEVELS.coinsPerLevel, 0);
        levelLine = `LEVEL UP! LEVEL ${reached[reached.length - 1]} · +${formatCoins(pay)} COINS`;
      }
    }
    // The one line, in order: a car won, a map opened, a new record, a level-up, the garage pointed out (after the
    // first drive), what to aim for next (GOALS), the tip on why it crashed.
    const unlocked = (mapUnlocks || [])[0];
    const big = carWon ? `${carWon.toUpperCase()} WON!` : unlocked ? `${unlocked.name} UNLOCKED!` : newBest ? 'NEW RECORD!' : levelLine;
    const small = garagePointer ? '' : goal || crashTip || ''; // the garage's own arrow says it (GUIDE)
    const highlight = big || small;
    setDisplay(this.badge, highlight);
    this.badge.hidden = !highlight;
    this.badge.classList.toggle('over-badge-tip', !big && Boolean(small));
    this.showCoins(balance);
    this.coinTotal = coins.total;
    const missionCoins = missions.reduce((sum, m) => sum + m.reward, 0);
    setDisplay(this.breakdown, missions.length ? `${missions.length} ${missions.length === 1 ? 'MISSION' : 'MISSIONS'} DONE +${formatCoins(missionCoins)}` : '');
    this.breakdown.hidden = true; // the missions' coins are in the total
    if (this.stopCount) this.stopCount();
    this.stopCount = countUp(this.earned, 0, doubled ? coins.total * 2 : coins.total, COINS.tallyMs);
    this.double.hidden = adMode === 'none' || coins.total === 0 || !canDouble; // only after a run worth it (ADS)
    this.setDoubleState(doubled ? 'done' : 'ready');
    setDisplay(this.cause, CAUSES[cause] || CAUSES.police);
    setDisplay(this.time, formatClock(summary.time));
    const earnedStars = starsFor(summary.time);
    this.stars.forEach((star, i) => {
      star.classList.toggle('lit', i < earnedStars);
      star.style.animationDelay = `${0.15 + i * 0.16}s`;
    });
    super.show();
  }
}

// A car won by surviving: what it takes, and the player's best so far.
function challengeLine(car) {
  const c = car.challenge;
  const best = Math.max(Records.best.time, Records.hardBest);
  const mins = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `WIN IT: SURVIVE ${mins(c.normal)} · BEST ${mins(best)}`; // HARD START's time is in the goal line; the price is on BUY
}

const SHOWN_HEADING = 0; // nose up and to the right, seen from behind and above
const SPEC_BLOCKS = 10;
const ZOOM_SHARE = 1 / 260; // how big a car is drawn, against the shorter side of the screen
const BACKDROP_DIM = 'rgba(14, 15, 18, 0.22)'; // over the map behind the car
// Pixels per world unit for the car on show, from the size of its canvas (before the car's own scale).
const carZoom = (width, height) => Math.max(1, Math.min(1.9, Math.min(width, height) * ZOOM_SHARE * 2.2));
const SHADOW_FAR = 4000; // the shadow's shape is drawn off the canvas; only its blur lands on it
const footprint = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
const screenPoint = { x: 0, y: 0 };

// Sets a canvas up to draw at twice its size at least, and clears it. Returns its size, or null if unseen.
function prepareCanvas(canvas, ctx) {
  const ratio = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return { width, height, ratio };
}

function arrows(onPrev, onNext) {
  return [
    button('garage-arrow garage-prev', el('span', 'garage-triangle'), onPrev, 'Previous'),
    button('garage-arrow garage-next', el('span', 'garage-triangle'), onNext, 'Next'),
  ];
}

// One car at a time, small and still on plain road, with its name, how to get it and how it drives. Drawn live
// on a canvas, so no drawing sheets are needed to browse.
export class GarageScreen extends Screen {
  constructor({ onPrev, onNext, onAction, onBack, onUpgrade, onHardStart, onToggle = null }) {
    const canvas = el('canvas', 'garage-canvas');
    const name = dt('garage-name', '');
    const count = dt('garage-count', '');
    const lock = el('span', 'garage-lock');
    lock.innerHTML = ICONS.lock;
    const statusText = dt('garage-status-text', '');
    const status = el('div', 'garage-price', [lock, statusText]);
    const action = textButton('btn-primary garage-action', '', onAction, 'Buy or select this car');
    const specs = el('div', 'garage-specs', '');
    const browse = arrows(onPrev, onNext);
    const stage = el('div', 'garage-stage', [canvas, ...browse]);
    // Upgrades work for every car: shown instead of the car's specs when UPGRADES is pressed.
    const level = levelBar('garage-level');
    const upgradeRows = Object.entries(UPGRADES.kinds).map(([kind, def]) => {
      const blocks = Array.from({ length: UPGRADES.prices.length }, () => el('span', 'spec-block'));
      const buy = textButton('btn-secondary upgrade-buy', '', () => onUpgrade(kind), `Upgrade ${def.name}`);
      return { kind, blocks, buy, node: el('div', 'upgrade-row', [dt('garage-spec-label', def.name), el('div', 'spec-blocks', blocks), buy]) };
    });
    const upgrades = el('div', 'garage-upgrades', [level, ...upgradeRows.map((row) => row.node)]);
    upgrades.hidden = true;
    // HARD START: a small switch by the DRIVE button, shown only on the way into a run (on, it pays more coins).
    const hardLabel = dt('', '');
    const hard = button('btn btn-secondary btn-hard', '', () => onHardStart(), 'Hard start on / off');
    hard.append(hardLabel);
    hard.setOn = (on) => {
      setDisplay(hardLabel, on ? `HARD START: ON ×${COINS.hardShare}` : 'HARD START: OFF');
      hard.classList.toggle('on', on);
      hard.setAttribute('aria-pressed', String(on));
    };
    const carPanel = el('div', 'garage-car-panel', [status, specs, action, hard]);
    const toggle = textButton('btn-secondary garage-toggle', 'UPGRADES', () => this.toggleUpgrades(), 'Show upgrades or cars');
    const step = dt('step-label', '');
    super('garage car-screen', [step, el('div', 'garage-heading', [name, count]), stage, el('div', 'garage-details', [toggle, carPanel, upgrades])]);
    Object.assign(this, { upgrades, upgradeRows, level, carPanel, toggle, hard, step, nextArrow: browse[1], onToggle });
    // The map you are about to drive, close up round the car: the same place as the map screen, nearer.
    const backdrop = el('canvas', 'map-canvas');
    this.node.prepend(backdrop);
    this.backdrop = backdrop;
    this.backdropCtx = backdrop.getContext('2d');
    this.backdropDrawn = '';
    this.back = textButton('btn-secondary garage-back', 'BACK', onBack, 'Back');
    this.balance = coinBadge();
    this.node.append(this.back, this.balance);
    Object.assign(this, { canvas, name, count, status, statusText, lock, action, specs });
    this.ctx = canvas.getContext('2d');
    this.drawn = '';
  }

  // flow: on the way into a run (from PLAY), where the big button reads DRIVE and HARD START is offered.
  // hint: a line in place of the step's label (the first time a new player is sent here).
  setFlow(flow, hardOn, hint = null) {
    this.flow = flow;
    this.node.classList.toggle('flow', flow); // see-through: the car is the one in the world, the camera close on it
    this.hard.hidden = true; // HARD START is on the map screen now, the last step before the run
    this.hard.setOn(hardOn);
    this.step.hidden = !flow && !hint;
    setDisplay(this.step, hint || 'CHOOSE YOUR CAR');
    this.back.setText('BACK');
  }

  showCar(car, index, total) {
    this.balance.setCoins(Garage.coins);
    setDisplay(this.name, car.name);
    setDisplay(this.count, `${index + 1}/${total}`);
    const owned = Garage.owns(car.id);
    const selected = Garage.selected === car.id;
    this.status.classList.toggle('owned', owned);
    this.lock.hidden = owned;
    setDisplay(this.statusText, owned ? 'UNLOCKED' : car.challenge ? challengeLine(car) : `LOCKED - ${formatCoins(car.price)} COINS`);
    const action = this.action;
    if (this.flow) {
      // On the way into a run: an owned car drives at once; a locked one is bought first.
      action.classList.remove('btn-done');
      action.disabled = !owned && !Garage.canBuy(car.id);
      action.setText(owned ? 'NEXT' : `BUY FOR ${formatCoins(car.price)} COINS`);
    } else {
      // From the results: the chosen car's button reads DRIVE, straight on to choosing a map.
      action.classList.remove('btn-done');
      action.disabled = !owned && !Garage.canBuy(car.id);
      if (selected) action.setText('DRIVE');
      else if (owned) action.setText('SELECT');
      else action.setText(`BUY FOR ${formatCoins(car.price)} COINS`);
    }
    this.car = car;
    this.showSpecs(car);
    this.showUpgrades();
    this.drawCar();
  }

  showCarsPanel() {
    this.upgrades.hidden = true;
    this.carPanel.hidden = false;
    this.toggle.setText('UPGRADES');
  }

  toggleUpgrades() {
    const showing = this.upgrades.hidden;
    this.upgrades.hidden = !showing;
    this.carPanel.hidden = showing;
    this.toggle.setText(showing ? 'CARS' : 'UPGRADES');
    this.showUpgrades();
    if (this.onToggle) this.onToggle(showing);
  }

  // Each upgrade's tiers, and what the next one costs or needs.
  // The car on show's own ENGINE and HANDLING (it must be owned), and the player's COIN BONUS.
  showUpgrades() {
    const id = this.car ? this.car.id : Garage.selected;
    this.level.set(Progress.level, Progress.share);
    for (const row of this.upgradeRows) {
      const tier = Progress.tier(row.kind, id);
      row.blocks.forEach((block, i) => block.classList.toggle('lit', i < tier));
      const next = Progress.next(row.kind, id);
      if (Progress.isFree(row.kind, id)) row.buy.setText('FREE');
      else if (!next) row.buy.setText('MAX');
      else if (UPGRADES.perCar.includes(row.kind) && !Garage.owns(id)) row.buy.setText('LOCKED');
      else if (Progress.level < next.level) row.buy.setText(`LEVEL ${next.level}`);
      else row.buy.setText(`${formatCoins(next.price)}`);
      row.buy.disabled = !Progress.canUpgrade(row.kind, id);
    }
  }

  // Blocks out of SPEC_BLOCKS, so that even the car with the least of something shows one.
  // The car's own specs, and in a lighter shade the blocks its upgrades add.
  showSpecs(car) {
    const specs = carSpecs(car);
    const tuned = carSpecs(car, (h) => Progress.handling(h, car.id));
    const blocksFor = (share) => Math.min(SPEC_BLOCKS, 1 + Math.round(Math.max(0, share) * (SPEC_BLOCKS - 1)));
    const line = (label, name) => {
      const lit = blocksFor(specs[name]);
      const boosted = Math.max(lit, blocksFor(tuned[name]));
      const blocks = Array.from({ length: SPEC_BLOCKS }, (_, i) => el('span', i < lit ? 'spec-block lit' : i < boosted ? 'spec-block lit boost' : 'spec-block'));
      return el('div', 'garage-spec', [dt('garage-spec-label', label), el('div', 'spec-blocks', blocks)]);
    };
    this.specs.replaceChildren(line('SPEED', 'speed'), line('ACCELERATION', 'acceleration'), line('HANDLING', 'handling'), line('DURABILITY', 'durability'));
  }

  // Called every frame, but only draws when the car or the size of the screen has changed.
  drawCar() {
    const { canvas, ctx, car } = this;
    if (!car || this.flow) return; // in the flow the world draws the car
    this.drawBackdrop();
    const key = `${car.id}:${canvas.clientWidth}:${canvas.clientHeight}`;
    if (key === this.drawn) return;
    const size = prepareCanvas(canvas, ctx);
    if (!size) return;
    this.drawn = key;
    const zoom = carZoom(size.width, size.height) * car.scale;
    ctx.setTransform(size.ratio * zoom, 0, 0, size.ratio * zoom, (size.width * size.ratio) / 2, (size.height * size.ratio) * 0.55);
    const mesh = carMesh(car.id);
    this.drawSoftShadow(ctx, mesh, SHOWN_HEADING, size.ratio * zoom);
    paintMesh(ctx, projectMesh(mesh, SHOWN_HEADING, projection));
  }

  forget() {
    this.drawn = '';
    this.backdropDrawn = '';
  }

  // The map's own ground and props, drawn at the car's scale with its start road under the car, toned down a
  // little so the car stands out. Only when the map or the screen's size changes.
  drawBackdrop() {
    const { backdrop, backdropCtx: ctx, canvas } = this;
    const map = Maps.current();
    const key = `${map.id}:${backdrop.clientWidth}:${backdrop.clientHeight}:${canvas.clientWidth}:${canvas.clientHeight}`;
    if (key === this.backdropDrawn) return;
    const size = prepareCanvas(backdrop, ctx);
    if (!size || !canvas.clientWidth) return;
    this.backdropDrawn = key;
    // Measured against the screen itself, so a zoom running on it doesn't move anything.
    const box = this.node.getBoundingClientRect();
    const scale = box.width / (this.node.offsetWidth || box.width || 1) || 1;
    const rect = canvas.getBoundingClientRect();
    const focusX = ((rect.left - box.left) / scale + canvas.clientWidth / 2) * size.ratio;
    const focusY = ((rect.top - box.top) / scale + canvas.clientHeight * 0.55) * size.ratio;
    const zoom = carZoom(canvas.clientWidth, canvas.clientHeight) * size.ratio;
    // In the chosen map's colours (the world behind keeps its own until the run starts).
    withMapPalette(map, () => drawMapDiorama(ctx, map, null, backdrop.width, backdrop.height, zoom, focusX, focusY, false));
    ctx.fillStyle = BACKDROP_DIM;
    ctx.fillRect(0, 0, backdrop.width, backdrop.height);
  }

  // Blurred, so it reads as light falling softly round the car: one tight and dark right under it, one wider
  // and fainter, thrown away from the sun. scale: canvas pixels per world unit, for the blur.
  drawSoftShadow(ctx, mesh, heading, scale) {
    let hw = 0;
    let hl = 0;
    // Sized from what is near the ground: a canopy or a roof overhang shouldn't make it bigger.
    for (const part of mesh) {
      for (const v of part.verts) {
        if (v[2] > 16) continue;
        hw = Math.max(hw, Math.abs(v[0]));
        hl = Math.max(hl, Math.abs(v[1]));
      }
    }
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].forEach(([x, y], i) => {
      projection.toScreen(x * cos + y * sin, x * sin - y * cos, 0, screenPoint);
      footprint[i].x = screenPoint.x;
      footprint[i].y = screenPoint.y;
    });
    const pass = (blur, alpha, offsetX, offsetY) => {
      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
      ctx.shadowBlur = blur * scale;
      ctx.shadowOffsetX = SHADOW_FAR + offsetX * scale;
      ctx.shadowOffsetY = offsetY * scale;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      footprint.forEach((p, i) => {
        const x = p.x - SHADOW_FAR / scale;
        if (i === 0) ctx.moveTo(x, p.y);
        else ctx.lineTo(x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    pass(10, 0.42, -9, -4);
    pass(5, 0.62, 0, 0);
  }
}

const MAP_ZOOM_SHARE = 1 / 760; // how much of a map shows, against the shorter side of the screen
const MAP_DIM = 'rgba(16, 18, 24, 0.5)'; // over a map still locked

// Choosing where to drive: the map itself fills the screen, with your car waiting on it. Its name, its stars, and
// how many more it takes to unlock.
export class MapScreen extends Screen {
  constructor({ onPrev, onNext, onAction, onBack, onHardStart }) {
    const canvas = el('canvas', 'map-canvas');
    const name = dt('map-name', '');
    const count = dt('garage-count', '');
    const lock = el('span', 'garage-lock');
    lock.innerHTML = ICONS.lock;
    const statusText = dt('map-status-text', '');
    const status = el('div', 'garage-price', [lock, statusText]);
    const stars = starRow('over-star map-star');
    const action = textButton('btn-primary map-start', 'START', onAction, 'Start the run');
    const browse = arrows(onPrev, onNext);
    const stage = el('div', 'garage-stage', browse);
    const plate = el('div', 'map-plate', [el('div', 'over-stars', stars), status]);
    // HARD START: a small switch under START (on, it pays more coins).
    const hardLabel = dt('', '');
    const hard = button('btn btn-secondary btn-hard', '', () => onHardStart(), 'Hard start on / off');
    hard.append(hardLabel);
    hard.setOn = (on) => {
      setDisplay(hardLabel, on ? `HARD START: ON ×${COINS.hardShare}` : 'HARD START: OFF');
      hard.classList.toggle('on', on);
      hard.setAttribute('aria-pressed', String(on));
    };
    super('garage map-screen', [dt('step-label', 'CHOOSE A MAP'), el('div', 'garage-heading', [name, count]), stage, el('div', 'garage-details', [plate, action, hard])]);
    this.hard = hard;
    this.nextArrow = browse[1];
    this.back = textButton('btn-secondary garage-back', 'BACK', onBack, 'Back');
    this.starsTotal = starBadge();
    this.node.prepend(canvas);
    this.node.append(this.back, this.starsTotal);
    Object.assign(this, { canvas, stage, name, count, status, statusText, lock, stars, action });
    this.ctx = canvas.getContext('2d');
    this.drawn = '';
  }

  // The map itself is the world behind (GameScene.previewMap); this is its name, stars and whether it is open.
  showMap(map, index, hardOn = false) {
    this.map = map;
    this.hard.setOn(hardOn);
    setDisplay(this.name, map.name);
    setDisplay(this.count, `${index + 1}/${MAPS.length}`);
    const open = Maps.isUnlocked(map);
    const best = Maps.bestTime(map.id);
    this.lock.hidden = open;
    this.status.classList.toggle('owned', open);
    setDisplay(this.statusText, open ? `BEST ${formatClock(best)}` : `LOCKED - ${map.stars} STARS`);
    const earned = starsFor(best);
    this.stars.forEach((star, i) => star.classList.toggle('on', i < earned));
    this.action.disabled = !open;
    this.action.setText(open ? 'START' : 'LOCKED');
    this.node.classList.toggle('locked', !open);
    this.starsTotal.setStars(Maps.totalStars());
  }

  // Called every frame, but only draws when the map or the size of the screen has changed.
  drawMap() {
    const { canvas, ctx, map } = this;
    if (!map) return;
    const key = `${map.id}:${Garage.selected}:${canvas.clientWidth}:${canvas.clientHeight}`;
    if (key === this.drawn) return;
    const size = prepareCanvas(canvas, ctx);
    if (!size) return;
    this.drawn = key;
    // Drawn in that map's colours; the world behind keeps its own (withMapPalette puts them back).
    const zoom = size.ratio * Math.max(0.42, Math.min(1, Math.min(size.width, size.height) * MAP_ZOOM_SHARE * 1.0));
    // Measured against the screen itself, so a zoom running on it (Screen.zoom) doesn't move the focus.
    const stage = this.stage.getBoundingClientRect();
    const box = this.node.getBoundingClientRect();
    const scale = box.width / (this.node.offsetWidth || box.width || 1) || 1;
    const focusX = ((stage.left + stage.width / 2 - box.left) / scale) * size.ratio;
    const focusY = ((stage.top + stage.height / 2 - box.top) / scale) * size.ratio;
    withMapPalette(map, () => drawMapDiorama(ctx, map, Garage.selected, canvas.width, canvas.height, zoom, focusX, focusY));
    if (!Maps.isUnlocked(map)) {
      ctx.fillStyle = MAP_DIM;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
}
