import { COINS, MAPS, STARS, applyMapPalette, carSpecs } from '../config/tuning.js';
import { carMesh } from '../render/carModels.js';
import { paintMesh, projectMesh } from '../render/lowpoly.js';
import { drawMapDiorama } from '../render/mapDiorama.js';
import { projection } from '../render/projection.js';
import { Garage, Maps, formatClock, formatDistance, starsFor } from '../systems/ScoreSystem.js';
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
    this.node.hidden = false;
    this.node.classList.remove('leaving');
  }

  hide() {
    this.node.hidden = true;
  }
}

const formatCoins = (n) => Math.round(n).toLocaleString('en-US');

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

// Counts a number up on screen. Returns a function that stops it.
function countUp(node, from, to, ms, format = formatCoins) {
  const start = performance.now();
  let frame = 0;
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
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

export class MenuScreen extends Screen {
  constructor({ onPlay, onSound, onMusic, onGarage, onMaps, onHardStart, onBoard }) {
    const logo = el('h1', 'logo', [dt('logo-line', "CAN'T"), dt('logo-line', 'CATCH'), dt('logo-line logo-me', 'ME!')]);
    const play = textButton('btn-primary btn-play', 'PLAY', onPlay, 'Play', ICONS.play);
    const mapName = dt('menu-map', '');
    const sound = soundButton(onSound);
    const music = musicButton(onMusic);
    const hint = dt('menu-hint', '');
    // HARD START: a switch. Off, it says what it would do; on, it says it is on and what it pays.
    const hardLabel = dt('', '');
    const hard = button('btn btn-secondary btn-hard', '', () => onHardStart(), 'Hard start on / off');
    hard.append(hardLabel);
    hard.setOn = (on) => {
      setDisplay(hardLabel, on ? `HARD START: ON · COINS ×${COINS.hardShare}` : 'HARD START: OFF');
      hard.classList.toggle('on', on);
      hard.setAttribute('aria-pressed', String(on));
    };
    // The leaderboard, only where there is one to show.
    const board = button('btn btn-icon btn-board', ICONS.trophy, () => onBoard(), 'Hard start leaderboard');
    super('menu', [
      el('div', 'menu-top', [logo]),
      el('div', 'menu-bottom', [mapName, play, el('div', 'menu-row', [textButton('btn-secondary', 'GARAGE', onGarage, 'Garage'), textButton('btn-secondary', 'MAPS', onMaps, 'Maps'), sound, music, board]), hard, hint]),
    ]);
    this.hard = hard;
    this.board = board;
    this.balance = coinBadge();
    this.stars = starBadge();
    this.node.append(this.balance, this.stars);
    this.mapName = mapName;
    this.sound = sound;
    this.music = music;
    this.hint = hint;
  }

  refresh(coins) {
    this.balance.setCoins(coins);
    this.stars.setStars(Maps.totalStars());
    setDisplay(this.mapName, Maps.current().name);
  }

  show({ soundOn, musicOn, touch, coins, hardStart, boardShown }) {
    this.refresh(coins);
    this.hard.setOn(hardStart);
    this.board.hidden = !boardShown;
    this.sound.setOn(soundOn);
    this.music.setOn(musicOn);
    setDisplay(this.hint, touch ? 'HOLD LEFT OR RIGHT TO STEER · DOUBLE TAP: POWER-UP' : 'STEER WITH A D OR ARROWS · SPACE: POWER-UP');
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

// After a crash: carry on for coins, or for an ad, before the results. Counts down by itself.
export class ReviveScreen extends Screen {
  constructor({ onPay, onAd, onDecline }) {
    const count = dt('revive-count', '5');
    const pay = textButton('btn-primary', 'REVIVE', onPay, 'Revive with coins');
    const ad = textButton('btn-secondary', 'WATCH AD: REVIVE', onAd, 'Watch an ad to revive');
    const balance = coinBadge();
    super('revive', [
      balance,
      el('h2', 'screen-title', [dt('', 'CONTINUE?')]),
      count,
      pay,
      ad,
      textButton('btn-secondary', 'NO THANKS', onDecline, 'See the results'),
    ]);
    this.count = count;
    this.pay = pay;
    this.ad = ad;
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

  setAdState(state) {
    this.ad.disabled = state === 'busy';
    this.pay.disabled = state === 'busy';
    if (state === 'ready') this.ad.setText('WATCH AD: REVIVE');
    if (state === 'busy') this.ad.setText('LOADING AD...');
    if (state === 'failed') this.ad.setText('NO AD - TRY AGAIN');
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
  constructor({ onRetry, onMenu, onGarage, onDouble }) {
    const cause = dt('over-cause', '');
    const time = dt('over-time', '00:00.00');
    const stars = starRow('over-star');
    const badge = dt('over-badge', '');
    const next = dt('over-next', '');
    const rows = el('div', 'over-rows', '');
    const earned = dt('over-coins-value', '0');
    const earnedRow = el('div', 'over-coins', [coinGlyph(), dt('over-coins-plus', '+'), earned, dt('over-coins-label', 'COINS')]);
    const breakdown = dt('over-breakdown', '');
    const double = textButton('btn-gold', '', onDouble, 'Double your coins by watching an ad', ICONS.film);
    // Two groups: stacked on a tall screen, side by side on a phone held sideways.
    super('over', [
      el('div', 'over-group', [el('h2', 'screen-title over-title', [dt('', 'BUSTED!')]), cause, time, el('div', 'over-stars', stars), badge, next]),
      el('div', 'over-group', [
        rows,
        earnedRow,
        breakdown,
        double,
        textButton('btn-primary', 'RETRY', onRetry, 'Retry', ICONS.retry),
        el('div', 'menu-row', [textButton('btn-secondary', 'GARAGE', onGarage, 'Garage'), textButton('btn-secondary', 'MENU', onMenu, 'Main menu')]),
      ]),
    ]);
    this.balance = coinBadge();
    this.node.append(this.balance);
    Object.assign(this, { cause, time, stars, badge, next, rows, earned, breakdown, double });
  }

  showCoins(coins) {
    this.balance.setCoins(coins);
  }

  setDoubleState(state) {
    const node = this.double;
    node.disabled = state === 'busy' || state === 'done';
    node.classList.toggle('btn-done', state === 'done');
    if (state === 'ready') node.setText(`WATCH AD: DOUBLE COINS (+${formatCoins(this.coinTotal)})`);
    if (state === 'busy') node.setText('LOADING AD...');
    if (state === 'failed') node.setText('NO AD - TRY AGAIN');
    if (state === 'done') node.setText('COINS DOUBLED!');
  }

  // The tally and the balance climb to their new totals.
  showDoubled(extra, balance) {
    if (this.stopCount) this.stopCount();
    this.setDoubleState('done');
    this.stopCount = countUp(this.earned, this.coinTotal, this.coinTotal + extra, COINS.tallyMs);
    this.coinTotal += extra;
    this.showCoins(balance);
  }

  show({ summary, best, newBest, cause, coins, mapUnlocks, nextMap, doubled, balance, adMode }) {
    this.showCoins(balance);
    this.coinTotal = coins.total;
    setDisplay(this.breakdown, `TIME +${formatCoins(coins.time)} · WRECKS +${formatCoins(coins.wrecks)} · COMBO +${formatCoins(coins.combo)}${coins.hard ? ` · HARD START +${formatCoins(coins.hard)}` : ''}`);
    if (this.stopCount) this.stopCount();
    this.stopCount = countUp(this.earned, 0, doubled ? coins.total * 2 : coins.total, COINS.tallyMs);
    this.double.hidden = adMode === 'none' || coins.total === 0;
    this.setDoubleState(doubled ? 'done' : 'ready');
    setDisplay(this.cause, CAUSES[cause] || CAUSES.police);
    setDisplay(this.time, formatClock(summary.time));
    const earnedStars = starsFor(summary.time);
    this.stars.forEach((star, i) => {
      star.classList.toggle('lit', i < earnedStars);
      star.style.animationDelay = `${0.15 + i * 0.16}s`;
    });
    const news = (mapUnlocks || []).map((map) => `${map.name} UNLOCKED!`);
    if (newBest) news.unshift('NEW RECORD!');
    setDisplay(this.badge, news.join(' · '));
    this.badge.hidden = news.length === 0;
    setDisplay(this.next, nextMap ? `${nextMap.needed} MORE ${nextMap.needed === 1 ? 'STAR' : 'STARS'} TO UNLOCK ${nextMap.map.name}` : '');
    this.next.hidden = !nextMap;
    const row = (label, value, record) => el('div', 'over-row', [dt('over-row-label', label), dt('over-row-value', value), dt('over-row-record', `RECORD ${record}`)]);
    this.rows.replaceChildren(
      row('TOP DISTANCE', formatDistance(summary.distance), formatDistance(best.distance)),
      row('CAR CRASHES', String(summary.wrecks), String(best.wrecks)),
    );
    super.show();
  }
}

const SHOWN_HEADING = 0; // nose up and to the right, seen from behind and above
const SPEC_BLOCKS = 10;
const ZOOM_SHARE = 1 / 260; // how big a car is drawn, against the shorter side of the screen
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
  constructor({ onPrev, onNext, onAction, onBack }) {
    const canvas = el('canvas', 'garage-canvas');
    const name = dt('garage-name', '');
    const count = dt('garage-count', '');
    const lock = el('span', 'garage-lock');
    lock.innerHTML = ICONS.lock;
    const statusText = dt('garage-status-text', '');
    const status = el('div', 'garage-price', [lock, statusText]);
    const action = textButton('btn-primary garage-action', '', onAction, 'Buy or select this car');
    const specs = el('div', 'garage-specs', '');
    const stage = el('div', 'garage-stage', [canvas, ...arrows(onPrev, onNext)]);
    super('garage', [el('div', 'garage-heading', [name, count]), stage, el('div', 'garage-details', [status, specs, action])]);
    this.back = textButton('btn-secondary garage-back', 'BACK', onBack, 'Back');
    this.balance = coinBadge();
    this.node.append(this.back, this.balance);
    Object.assign(this, { canvas, name, count, status, statusText, lock, action, specs });
    this.ctx = canvas.getContext('2d');
    this.drawn = '';
  }

  showCar(car, index, total) {
    this.balance.setCoins(Garage.coins);
    setDisplay(this.name, car.name);
    setDisplay(this.count, `${index + 1}/${total}`);
    const owned = Garage.owns(car.id);
    const selected = Garage.selected === car.id;
    this.status.classList.toggle('owned', owned);
    this.lock.hidden = owned;
    setDisplay(this.statusText, owned ? 'UNLOCKED' : `LOCKED - ${formatCoins(car.price)} COINS`);
    const action = this.action;
    action.classList.toggle('btn-done', selected);
    action.disabled = selected || (!owned && !Garage.canBuy(car.id));
    if (selected) action.setText('SELECTED');
    else if (owned) action.setText('SELECT');
    else action.setText(`BUY FOR ${formatCoins(car.price)} COINS`);
    this.showSpecs(car);
    this.car = car;
    this.drawCar();
  }

  // Blocks out of SPEC_BLOCKS, so that even the car with the least of something shows one.
  showSpecs(car) {
    const specs = carSpecs(car);
    const line = (label, share) => {
      const lit = 1 + Math.round(share * (SPEC_BLOCKS - 1));
      const blocks = Array.from({ length: SPEC_BLOCKS }, (_, i) => el('span', i < lit ? 'spec-block lit' : 'spec-block'));
      return el('div', 'garage-spec', [dt('garage-spec-label', label), el('div', 'spec-blocks', blocks)]);
    };
    this.specs.replaceChildren(
      line('SPEED', specs.speed),
      line('ACCELERATION', specs.acceleration),
      line('HANDLING', specs.handling),
      line('DURABILITY', specs.durability),
    );
  }

  // Called every frame, but only draws when the car or the size of the screen has changed.
  drawCar() {
    const { canvas, ctx, car } = this;
    if (!car) return;
    const key = `${car.id}:${canvas.clientWidth}:${canvas.clientHeight}`;
    if (key === this.drawn) return;
    const size = prepareCanvas(canvas, ctx);
    if (!size) return;
    this.drawn = key;
    const zoom = Math.max(1, Math.min(1.9, Math.min(size.width, size.height) * ZOOM_SHARE * 2.2)) * car.scale;
    ctx.setTransform(size.ratio * zoom, 0, 0, size.ratio * zoom, (size.width * size.ratio) / 2, (size.height * size.ratio) * 0.55);
    const mesh = carMesh(car.id);
    this.drawSoftShadow(ctx, mesh, SHOWN_HEADING, size.ratio * zoom);
    paintMesh(ctx, projectMesh(mesh, SHOWN_HEADING, projection));
  }

  forget() {
    this.drawn = '';
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
  constructor({ onPrev, onNext, onAction, onBack }) {
    const canvas = el('canvas', 'map-canvas');
    const name = dt('map-name', '');
    const count = dt('garage-count', '');
    const lock = el('span', 'garage-lock');
    lock.innerHTML = ICONS.lock;
    const statusText = dt('map-status-text', '');
    const status = el('div', 'garage-price', [lock, statusText]);
    const stars = starRow('over-star map-star');
    const action = textButton('btn-primary map-start', 'START', onAction, 'Start');
    const stage = el('div', 'garage-stage', arrows(onPrev, onNext));
    const plate = el('div', 'map-plate', [el('div', 'over-stars', stars), status]);
    super('garage map-screen', [el('div', 'garage-heading', [name, count]), stage, el('div', 'garage-details', [plate, action])]);
    this.back = textButton('btn-secondary garage-back', 'BACK', onBack, 'Back');
    this.starsTotal = starBadge();
    this.node.prepend(canvas);
    this.node.append(this.back, this.starsTotal);
    Object.assign(this, { canvas, stage, name, count, status, statusText, lock, stars, action });
    this.ctx = canvas.getContext('2d');
    this.drawn = '';
  }

  showMap(map, index) {
    this.map = map;
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
    this.starsTotal.setStars(Maps.totalStars());
    this.drawMap();
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
    // Drawn in that map's colours, whichever one the game is on.
    applyMapPalette(map);
    const zoom = size.ratio * Math.max(0.42, Math.min(1, Math.min(size.width, size.height) * MAP_ZOOM_SHARE * 1.0));
    const stage = this.stage.getBoundingClientRect();
    const focusX = (stage.left + stage.width / 2) * size.ratio;
    const focusY = (stage.top + stage.height / 2) * size.ratio;
    drawMapDiorama(ctx, map, Garage.selected, canvas.width, canvas.height, zoom, focusX, focusY);
    applyMapPalette(Maps.current());
    if (!Maps.isUnlocked(map)) {
      ctx.fillStyle = MAP_DIM;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
}
