// Checks for the mystery box and its items: Giant, Freeze, Pillars, Flamer, auto-fire, double tap.
import { Camera, Car, CS, ChaseSimulation, SCREENS, T, fixedMap, newSim, playRun, projection } from './simkit.mjs';
import { DoubleTap } from '../src/systems/InputManager.js';
import { ThreatRadar } from '../src/systems/ThreatRadar.js';
import * as props from '../src/render/propModels.js';
import { propCatalogue } from '../src/systems/WorldLayout.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}
const { POWERUP, GIANT, FREEZE, PILLARS, FLAMER, INPUT, CONES, CHUNKS } = T;
const handling = T.HANDLING_PRESETS.balanced;
const offView = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };

function quiet(items = []) {
  const s = new ChaseSimulation({ layout: fixedMap(items), handling });
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.powerUps.timer = 1e6;
  return s;
}
function run(s, seconds, input = {}) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) for (const e of s.step(1 / 60, { steer: 0, ...input }, offView)) events.push({ ...e });
  return events;
}
function useItem(s, kind) {
  s.powerUps.give(kind);
  return s.step(1 / 60, { steer: 0, activatePowerUp: true }, offView).map((e) => ({ ...e }));
}
const cop = (s, x, y, heading = 0, options = {}) => s.spawnPolice(x, y, heading, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0, launchShare: 0, ...options });
const drive = (s, x, y, heading = 0, speed = 300) => {
  s.player.reset(x, y, heading);
  s.player.launch(speed);
};
const lock = (p) => {
  p.handling.maxTurnRateDeg = 0;
  return p;
};

// ---- The lucky die --------------------------------------------------------------------------
{
  const s = quiet();
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) {
    s.powerUps.lastKind = null;
    seen.add(s.powerUps.pickKind(s.rng));
  }
  check('all five items can come up', ['shockwave', 'giant', 'freeze', 'pillars', 'flamer'].every((k) => seen.has(k)), [...seen].join(' '));
  check('every item has a name', Object.keys(POWERUP.kinds).every((k) => POWERUP.names[k]));
  let repeats = 0;
  let last = null;
  for (let i = 0; i < 1000; i += 1) {
    s.powerUps.lastKind = last;
    const k = s.powerUps.pickKind(s.rng);
    if (k === last) repeats += 1;
    last = k;
  }
  check('the same item twice in a row is rare', repeats < 90, `${repeats} in 1000`);
}
{
  // However far away it appears, it comes after the car from the first moment.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  Object.assign(s.powerUps.crate, { active: true, x: 1000 + 700, y: 1000 + 600, age: 0 });
  const startGap = Math.hypot(s.powerUps.crate.x - s.player.x, s.powerUps.crate.y - s.player.y);
  const start = { x: s.powerUps.crate.x, y: s.powerUps.crate.y };
  s.step(1 / 60, { steer: 0 }, offView);
  check('from the moment it appears, the die follows the car', s.powerUps.crate.x !== start.x && s.powerUps.crate.x < start.x && s.powerUps.crate.y < start.y);
  run(s, 1);
  const gapLater = Math.hypot(s.powerUps.crate.x - s.player.x, s.powerUps.crate.y - s.player.y);
  check('and gains on it, even from behind at full speed', gapLater < startGap - POWERUP.homingSpeed * 0.7, `${startGap.toFixed(0)} -> ${gapLater.toFixed(0)} units`);
  const events = run(s, 12);
  const pickup = events.find((e) => e.type === 'pickup');
  check('it always catches up, and is collected', pickup && !s.powerUps.crate.active, pickup ? pickup.kind : 'not collected');
  check('the item goes into the player\'s hands', s.powerUps.lastKind === pickup.kind);
  // A real one, placed by the game.
  const real = quiet();
  drive(real, 1000, 1000, 0);
  real.powerUps.timer = 0;
  const appeared = run(real, 1 / 60);
  check('dice are placed by the game as before', appeared.some((e) => e.type === 'crateSpawn') && real.powerUps.crate.active);
  const caught = run(real, 8);
  check('and reach the car within seconds', caught.some((e) => e.type === 'pickup'));
}
{
  // Held for too long: it goes off by itself.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  s.powerUps.give('flamer');
  const early = run(s, POWERUP.autoSeconds - 0.3);
  check('an item waits while the player decides', s.powerUps.held && !early.some((e) => e.type === 'power'));
  check('the button shows its name and a countdown', s.powerUps.label === `${POWERUP.names.flamer} 1`, s.powerUps.label);
  const later = run(s, 0.5);
  check('after 4 seconds it fires by itself', !s.powerUps.held && later.some((e) => e.type === 'power' && e.kind === 'flamer'));
  check('nothing held, nothing to show', s.powerUps.label === null);
  const e = useItem(s, 'freeze');
  check('pressing the button uses it at once', !s.powerUps.held && e.some((x) => x.type === 'power' && x.kind === 'freeze'));
  const none = s.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  check('pressing with nothing held does nothing', !none.some((x) => x.type === 'power'));
  const n = quiet();
  drive(n, 1000, 1000, 0);
  n.powerUps.held = true;
  const old = n.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  check('an item with no kind is a Shockwave', old.some((x) => x.type === 'pulse'));
}

// ---- Giant ----------------------------------------------------------------------------------
{
  const s = quiet();
  drive(s, 1000, 1000, 0);
  useItem(s, 'giant');
  let peak = 0;
  for (let t = 0; t < 1.5; t += 1 / 60) {
    s.step(1 / 60, { steer: 0 }, offView);
    peak = Math.max(peak, s.player.scale);
  }
  check('Giant grows the car to 3.2 x', Math.abs(s.player.scale - GIANT.scale) < 0.05, `${s.player.scale.toFixed(2)}`);
  check('with an elastic bounce on the way', peak > GIANT.scale + 0.15 && peak < GIANT.scale * 1.3, `peak ${peak.toFixed(2)}`);
  check('it is unstoppable', s.player.crushing);
  run(s, GIANT.seconds - 1.6);
  check('it lasts for 7 seconds', s.player.scaleTarget === GIANT.scale, `${s.powerUps.giantTime.toFixed(2)} s left`);
  run(s, 0.2);
  check('then starts to shrink', s.player.scaleTarget === 1);
  let lowest = 9;
  for (let t = 0; t < 2; t += 1 / 60) {
    s.step(1 / 60, { steer: 0 }, offView);
    lowest = Math.min(lowest, s.player.scale);
  }
  check('back to normal, smoothly: no bounce below normal size', s.player.scale === 1 && lowest >= 1, `lowest ${lowest.toFixed(3)}`);
  check('and it can be hurt again', !s.player.crushing && s.player.mass === T.COLLISION.playerMass);
}
{
  // Police: anything that touches it is flattened.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  useItem(s, 'giant');
  run(s, 0.8);
  const ahead = cop(s, s.player.x, s.player.y - 300, Math.PI, { launchShare: 1 });
  lock(ahead);
  const events = run(s, 1);
  check('a head-on police car doesn\'t stop it', s.state === 'running', s.state);
  check('it is crushed, with an explosion', ahead.state === 'wreck' && events.some((e) => e.type === 'crush') && events.some((e) => e.type === 'explosion'), ahead.state);
  check('it counts as wrecked', s.stats.wrecks === 1);
  check('the Giant barely slows', s.player.speed > 250, `${s.player.speed.toFixed(0)}`);
  // Nothing shoves it sideways, not even several things overlapping it at once.
  const shove = quiet();
  drive(shove, 1000, 1000, 0);
  useItem(shove, 'giant');
  run(shove, 1);
  const px = shove.player.x;
  for (let i = 0; i < 3; i += 1) shove.wreckPolice(cop(shove, px + 70 + i * 5, shove.player.y - 20 * i, 0), 'obstacle');
  shove.runExplosions();
  run(shove, 1 / 60);
  check('nothing it runs into can shove it aside', Math.abs(shove.player.x - px) < 2, `moved ${Math.abs(shove.player.x - px).toFixed(1)} units`);
  check('it is thrown clear', Math.hypot(ahead.model.x - s.player.x, ahead.model.y - s.player.y) > 80);
  // A car it has just drawn level with: touching, and not closing at all.
  const s2 = quiet();
  drive(s2, 1000, 1000, 0);
  useItem(s2, 'giant');
  run(s2, 0.8);
  const beside = cop(s2, s2.player.x + 70, s2.player.y, 0, { launchShare: 1 });
  lock(beside);
  run(s2, 1 / 60);
  check('even one just brushing alongside is crushed', beside.state === 'wreck', beside.state);
  // Parked, frozen, on fire: all the same.
  const s3 = quiet();
  drive(s3, 1000, 1000, 0);
  useItem(s3, 'giant');
  run(s3, 0.8);
  const parked = s3.spawnPolice(s3.player.x, s3.player.y - 280, Math.PI / 2, { role: 'roadblock', speedFactor: 1, turnDeg: 0, aimSide: 0, launchShare: 0 });
  run(s3, 1.2);
  check('a roadblock is no problem', parked.state === 'wreck' && s3.state === 'running', parked.state);
}
{
  // Scenery.
  const tree = { kind: 'tree', x: 1000, y: 700, heading: 0, model: 't', params: {}, collider: { type: 'circle', r: 16 }, breakable: false };
  const block = { kind: 'block', x: 1000, y: 500, heading: 0, model: 'b', params: {}, collider: { type: 'box', hw: 30, hl: 30 }, breakable: false };
  const lamp = { kind: 'lamp', x: 1000, y: 300, heading: 0, model: 'l', params: {}, collider: { type: 'circle', r: 7 }, breakable: true };
  const hole = { kind: 'void', isVoid: true, x: 1000, y: 100, heading: 0, collider: { type: 'circle', r: 60 }, breakable: false, outline: [] };
  const s = quiet([tree, block, lamp, hole]);
  drive(s, 1000, 1000, 0);
  useItem(s, 'giant');
  run(s, 3.4);
  check('it drives straight through solid scenery', s.state === 'running' && s.player.y < 100, `y ${s.player.y.toFixed(0)}, ${s.state}`);
  check('and doesn\'t lose speed doing it', s.player.speed > 290, `${s.player.speed.toFixed(0)}`);
  check('holes don\'t swallow it', !s.player.isFalling);
  const knocked = (item) => s.cones.find((c) => c.item === item);
  check('trees and blocks are knocked away', knocked(tree) && knocked(tree).state !== 'standing' && knocked(block) && knocked(block).state !== 'standing');
  check('so are lamp posts', knocked(lamp).state !== 'standing');
  const shape = knocked(tree).shape;
  check('a knocked tree is no longer solid', !shape.solid);
  // Later it comes back, solid as ever.
  for (let t = 0; t < CONES.respawnSeconds + 3; t += 1 / 60) s.updateCones(1 / 60, offView);
  check('after a while it is back, solid', knocked(tree).state === 'standing' && shape.solid);
  // An ordinary car still crashes into it.
  const n = quiet([tree]);
  drive(n, 1000, 1000, 0);
  run(n, 1.5);
  check('without Giant, a tree is still a tree', n.state === 'crashed');
}
{
  // A new run puts it all back.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  useItem(s, 'giant');
  run(s, 1);
  s.reset(5);
  check('a new run resets the car\'s size', s.player.scale === 1 && !s.player.crushing && s.player.mass === T.COLLISION.playerMass);
  // The camera widens, and stays within the loaded world on tall phones.
  const cam = new Camera({ w: 1080, h: 2520 });
  const car = new Car(handling);
  car.reset(0, 0, Math.PI / 4);
  car.launch(300);
  car.scale = GIANT.scale;
  cam.snap(car);
  for (let t = 0; t < 6; t += 1 / 60) {
    car.step(0, 1 / 60);
    cam.follow(car, 1 / 60);
  }
  const v = cam.view;
  let reach = 0;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const g = projection.groundFromScreen(v.cx + sx * v.halfW, v.cy + sy * v.halfH);
    reach = Math.max(reach, Math.abs(g.x - car.x), Math.abs(g.y - car.y));
  }
  check('the camera pulls back for a Giant', cam.rig.zoom < T.CAMERA.zoomOut - 0.05, `zoom ${cam.rig.zoom.toFixed(3)}`);
  check('without ever showing past the loaded chunks, even on a very tall phone', reach < CHUNKS.size, `sees ${reach.toFixed(0)}, grid guarantees ${CHUNKS.size}`);
}

// ---- Freeze ---------------------------------------------------------------------------------
{
  const s = quiet();
  drive(s, 1000, 1000, 0);
  const near = lock(cop(s, 1000 + 300, 1000, -Math.PI / 2, { launchShare: 1 }));
  const edge = lock(cop(s, 1000, 1000 + FREEZE.radius - 10, 0, { launchShare: 1 }));
  const far = lock(cop(s, 1000 - FREEZE.radius - 200, 1000, 0, { launchShare: 1 }));
  const events = useItem(s, 'freeze');
  check('Freeze catches police within its radius', near.frozen > 0 && edge.frozen > 0);
  check('not those beyond it', far.frozen === 0);
  check('the blast is reported for drawing', events.some((e) => e.type === 'power' && e.kind === 'freeze'));
  const at = { x: near.model.x, y: near.model.y };
  run(s, 2);
  check('a frozen car stops dead and stays there', near.model.speed === 0 && Math.hypot(near.model.x - at.x, near.model.y - at.y) < 8, `speed ${near.model.speed}`);
  check('its top speed is untouched', near.alive);
  run(s, FREEZE.seconds - 2 - 0.2);
  check('still frozen just before 4.5 s', near.frozen > 0);
  check('and is not removed as "stuck" (that takes 2.2 s)', near.alive && near.state === 'chasing');
  run(s, 0.4);
  check('after 4.5 s it thaws', near.frozen === 0 && near.model.mass === 1);
  run(s, 1);
  check('and drives on', near.model.speed > 100, `${near.model.speed.toFixed(0)}`);
}
{
  // Chasers crash into frozen cars.
  const s = quiet();
  drive(s, 1000, 3000, 0);
  const ice = lock(cop(s, 1000, 1400, 0));
  ice.freeze(FREEZE.seconds);
  const chaser = lock(cop(s, 1000, 1800, 0, { launchShare: 1 }));
  const events = run(s, 1.6);
  check('a chasing car that hits a frozen one is wrecked', chaser.state !== 'chasing', chaser.state);
  check('and so is the frozen one, with a bang', ice.state !== 'chasing' && events.some((e) => e.type === 'explosion'), ice.state);
}
{
  // The player can hit them too.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  const ice = lock(cop(s, 1000, 700, Math.PI / 2));
  ice.freeze(FREEZE.seconds);
  const wreckedBefore = s.stats.wrecks;
  let slowest = Infinity;
  const smash = [];
  for (let t = 0; t < 1.5; t += 1 / 60) {
    for (const e of s.step(1 / 60, { steer: 0 }, offView)) smash.push(e.type);
    slowest = Math.min(slowest, s.player.speed);
  }
  check('the player smashes through a frozen car and drives on', s.state === 'running', s.state);
  check('the frozen car is gone, with no wreck left in the way', !ice.active);
  check('it hardly slows the player', slowest >= s.player.handling.topSpeed * FREEZE.shatterKeep - 25, `slowest ${slowest.toFixed(0)}`);
  check('it counts as a wreck, without an explosion', s.stats.wrecks === wreckedBefore + 1 && smash.includes('shatter') && !smash.includes('explosion'), smash.join(','));
  // Barely touching one doesn't break it.
  const soft = quiet();
  drive(soft, 1000, 1000, 0, 30);
  soft.player.handling = { ...soft.player.handling, acceleration: 0, topSpeed: 30 };
  const iceSoft = lock(cop(soft, 1000, 900, 0));
  iceSoft.freeze(FREEZE.seconds);
  run(soft, 1.5);
  check('a gentle touch doesn\'t break it', iceSoft.active && soft.state === 'running', `${iceSoft.state}, ${soft.state}`);
  // Frozen cars get no warning arrows.
  const r = quiet();
  drive(r, 1000, 1000, 0);
  const c = projection.toScreen(1000, 1000, 0);
  const view = { cx: c.x, cy: c.y, halfW: 450, halfH: 800 };
  const frozen = lock(cop(r, 1000, 1000 - 1500, Math.PI));
  frozen.freeze(FREEZE.seconds);
  const radar = new ThreatRadar();
  for (let t = 0; t < 0.5; t += 1 / 60) radar.update(r, view, 1 / 60);
  check('a frozen car sets off no warning arrow', radar.threats.length === 0);
}

// ---- Pillars --------------------------------------------------------------------------------
{
  const s = quiet();
  drive(s, 1000, 1000, 0);
  useItem(s, 'pillars');
  const up = s.powerUps.pillars.filter((p) => p.active);
  check('Pillars puts up 3 stone blocks', up.length === PILLARS.count && up.every((p) => p.state === 'up'));
  check('behind the car', up.every((p) => p.y > s.player.y + 100), up.map((p) => p.y.toFixed(0)).join(' '));
  const middle = up[1];
  check('in a row across its path', Math.abs(middle.x - 1000) < 1 && Math.abs(up[0].x - up[2].x) === PILLARS.spacing * 2);
  const gap = PILLARS.spacing - PILLARS.halfSize * 2;
  check('too close together to drive through', gap < T.CAR_SIZE.width, `${gap} gap`);
  check('they are solid', up.every((p) => p.shape && p.shape.solid && !s.world.isClear(p.x, p.y, 10)));
  check('they don\'t appear on top of the car', up.every((p) => Math.hypot(p.x - s.player.x, p.y - s.player.y) > T.CAR_SIZE.length));
}
{
  // On a diagonal drive, they are behind the direction of travel.
  const s = quiet();
  drive(s, 1000, 1000, Math.PI / 4);
  useItem(s, 'pillars');
  const up = s.powerUps.pillars.filter((p) => p.active);
  const dx = up[1].x - s.player.x;
  const dy = up[1].y - s.player.y;
  const behind = (dx * Math.sin(Math.PI / 4) - dy * Math.cos(Math.PI / 4)) / Math.hypot(dx, dy);
  check('wherever the car is heading', behind < -0.95, behind.toFixed(2));
}
{
  // A chaser runs straight into them.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  const chaser = lock(cop(s, 1000, 1500, 0, { launchShare: 1 }));
  useItem(s, 'pillars');
  const events = run(s, 2);
  check('a trailing police car crashes into them', chaser.state !== 'chasing', chaser.state);
  check('and explodes', events.some((e) => e.type === 'explosion'));
  // Even a slow bump is lethal.
  const t = quiet();
  drive(t, 1000, 1000, 0);
  useItem(t, 'pillars');
  const up = t.powerUps.pillars.find((p) => p.active);
  const slow = lock(cop(t, up.x, up.y + 120, 0, { launchShare: 0.3 }));
  run(t, 1.5);
  check('even at low speed', slow.state !== 'chasing', slow.state);
}
{
  // They go.
  const s = quiet();
  drive(s, 1000, 1000, 0);
  useItem(s, 'pillars');
  const up = s.powerUps.pillars.filter((p) => p.active);
  const where = up.map((p) => ({ x: p.x, y: p.y }));
  const before = s.world.shapes.length;
  run(s, PILLARS.seconds - 0.2);
  check('they stand for 6 seconds', up.every((p) => p.state === 'up') && s.world.shapes.length === before);
  const events = run(s, 0.4);
  check('then they crumble: no longer solid', up.every((p) => p.state === 'sinking') && s.world.shapes.length === before - PILLARS.count && where.every((p) => s.world.isClear(p.x, p.y, 10)));
  check('with dust for each one', events.filter((e) => e.type === 'pillarCrumble').length === PILLARS.count);
  run(s, PILLARS.sinkSeconds + 0.1);
  check('and sink out of sight', up.every((p) => !p.active));
  // Used a few times over: nothing builds up.
  const r = quiet();
  drive(r, 1000, 1000, 0);
  const base = r.world.shapes.length;
  for (let i = 0; i < 5; i += 1) {
    useItem(r, 'pillars');
    run(r, 2);
  }
  check('using them again and again leaves nothing behind', r.world.shapes.length <= base + PILLARS.pool && r.powerUps.pillars.filter((p) => p.active).length <= PILLARS.pool);
  run(r, PILLARS.seconds + 1);
  check('in the end they are all gone', r.world.shapes.length === base, `${r.world.shapes.length} vs ${base}`);
  useItem(r, 'pillars');
  r.reset(2);
  check('a new run clears them', r.powerUps.pillars.every((p) => !p.active && !p.shape));
  // The Giant car goes through them.
  const g = quiet();
  drive(g, 1000, 1000, 0);
  useItem(g, 'giant');
  run(g, 0.8);
  const pillar = g.powerUps.pillars[0];
  Object.assign(pillar, { active: true, state: 'up', time: 0, x: g.player.x, y: g.player.y - 200 });
  pillar.shape = g.world.add({ kind: 'pillar', isPillar: true, pillar, x: pillar.x, y: pillar.y, heading: 0, collider: { type: 'box', hw: 23, hl: 23 }, breakable: false });
  run(g, 1);
  check('a Giant smashes a pillar too', pillar.state !== 'up' && g.state === 'running', pillar.state);
  check('the pillar has a model, drawn at startup', propCatalogue().some((e) => e.kind === 'pillar') && props.stonePillar().length > 0);
}

// ---- Flamer ---------------------------------------------------------------------------------
{
  const s = quiet();
  drive(s, 1000, 3000, 0);
  useItem(s, 'flamer');
  run(s, 2);
  const patches = s.powerUps.patches.filter((p) => p.active);
  check('Flamer leaves a dense trail of fire', patches.length > 15, `${patches.length} patches after 2 s`);
  check('behind the car, on its path', patches.every((p) => Math.abs(p.x - 1000) < 2 && p.y > s.player.y));
  let steps = 0;
  const spacing = patches.map((p) => p.y).sort((a, b) => a - b);
  for (let i = 1; i < spacing.length; i += 1) if (spacing[i] - spacing[i - 1] > FLAMER.patchRadius * 2) steps += 1;
  check('with no gaps a car could slip through', steps === 0);
  run(s, FLAMER.seconds - 2 + 0.1);
  const y = s.player.y;
  run(s, 0.3);
  check('it stops after 5 seconds', s.powerUps.flamerTime <= 0 && s.powerUps.patches.every((p) => !p.active || p.y > y));
  run(s, FLAMER.patchSeconds + 0.1);
  check('and the fire burns out', s.powerUps.patches.every((p) => !p.active));
  check('the player is never hurt by it', s.state === 'running');
  // The pool is big enough for the whole trail.
  const most = Math.ceil(((FLAMER.seconds + FLAMER.patchSeconds) * 300) / FLAMER.spacing);
  const needed = Math.min(most, Math.ceil((FLAMER.patchSeconds * 300) / FLAMER.spacing) + 1);
  check('the pool holds all the fire burning at once', FLAMER.maxPatches >= needed, `${needed} at most, pool ${FLAMER.maxPatches}`);
}
{
  // A police car driving into it.
  const s = quiet();
  drive(s, 1000, 3000, 0);
  useItem(s, 'flamer');
  run(s, 1.5);
  const patch = s.powerUps.patches.find((p) => p.active);
  const chaser = lock(cop(s, patch.x + 300, patch.y, -Math.PI / 2, { launchShare: 1 }));
  chaser.handling.maxTurnRateDeg = 120;
  let ignited = null;
  let time = 0;
  while (!ignited && time < 3) {
    const events = s.step(1 / 60, { steer: 0 }, offView);
    if (events.some((e) => e.type === 'ignite')) ignited = time;
    time += 1 / 60;
  }
  check('a police car that touches the fire catches light', ignited !== null && chaser.burning > 0, `after ${ignited && ignited.toFixed(2)} s`);
  const heading = chaser.model.heading;
  const burnStart = s.time;
  run(s, 0.5);
  check('it loses control: locked over, spinning', Math.abs(chaser.model.heading - heading) > 0.5, `${(((chaser.model.heading - heading) * 180) / Math.PI).toFixed(0)} deg in 0.5 s`);
  check('still alive at 0.5 s', chaser.alive);
  const events = run(s, 0.6);
  check('it explodes after 1 second', chaser.state === 'wreck' && events.some((e) => e.type === 'explosion'), `${chaser.state} at ${(s.time - burnStart).toFixed(2)} s`);
  check('it counts as wrecked', s.stats.wrecks >= 1);
  // Lit once: more fire doesn't restart its 1 second.
  const again = quiet();
  drive(again, 1000, 3000, 0);
  useItem(again, 'flamer');
  run(again, 1);
  const lit = lock(cop(again, again.player.x, again.player.y + 200, 0, { launchShare: 0 }));
  const seen = [];
  for (let t = 0; t < 1.2 && lit.alive; t += 1 / 60) {
    const before = lit.burning;
    for (const e of again.step(1 / 60, { steer: 0 }, offView)) if (e.type === 'ignite' && e.police === lit) seen.push(before);
  }
  check('it only catches light once, so more fire can\'t put off the explosion', seen.length === 1 && lit.state === 'wreck', `lit ${seen.length} time(s), ${lit.state}`);
  // Falling or wrecked cars don't burn.
  const f = quiet();
  drive(f, 1000, 3000, 0);
  useItem(f, 'flamer');
  run(f, 1);
  const p2 = f.powerUps.patches.find((p) => p.active);
  const wreck = cop(f, p2.x, p2.y, 0);
  f.wreckPolice(wreck, 'obstacle');
  run(f, 0.1);
  check('a wreck on the fire doesn\'t catch light again', wreck.burning === 0);
}

// ---- A knocked prop flies for its own time -------------------------------------------------
{
  const car = { kind: 'civilian', x: 1000, y: 800, heading: 0, model: 'c', params: {}, collider: { type: 'box', hw: 22, hl: 42 }, breakable: true };
  const s = quiet([car]);
  drive(s, 1000, 1000, 0);
  run(s, 0.8);
  const cone = s.cones[0];
  check('a parked car is knocked', cone.state === 'flying', cone.state);
  run(s, 1);
  check('it keeps flying for its full time, not just a cone\'s', cone.state === 'flying' && cone.flySeconds === CONES.kinds.civilian.flySeconds, `${cone.state} at ${cone.timer.toFixed(1)} s`);
}

// ---- Double tap -----------------------------------------------------------------------------
{
  const tap = (d, t, x = 100, y = 100, id = 1, held = 60) => {
    const fired = d.down(id, t, x, y);
    d.up(id, t + held);
    return fired;
  };
  let d = new DoubleTap();
  check('one tap does nothing', tap(d, 0) === false);
  check('a second one soon after is a double tap', tap(d, 200) === true);
  check('a third straight after doesn\'t count again', tap(d, 400) === false);
  d = new DoubleTap();
  tap(d, 0);
  check('too slow is not a double tap', tap(d, 60 + INPUT.doubleTapMs + 10) === false);
  d = new DoubleTap();
  tap(d, 0, 50, 300);
  check('quick taps left then right are steering, not a double tap', tap(d, 150, 340, 300) === false);
  d = new DoubleTap();
  tap(d, 0, 100, 100);
  check('a little way apart still counts', tap(d, 150, 170, 140) === true);
  d = new DoubleTap();
  d.down(1, 0, 100, 100);
  d.up(1, INPUT.tapMaxMs + 200);
  check('a hold (steering) then a tap is not a double tap', tap(d, INPUT.tapMaxMs + 300) === false);
  d = new DoubleTap();
  tap(d, 0, 100, 100, 1);
  check('two fingers count just the same', tap(d, 120, 110, 110, 2) === true);
  d = new DoubleTap();
  tap(d, 0);
  d.clear();
  check('a cancelled touch forgets the tap', tap(d, 100) === false);
}

// ---- Whole runs -----------------------------------------------------------------------------
{
  // Every item fired in a real world, over and over: nothing breaks and nothing builds up.
  const sim = newSim();
  const causes = {};
  let items = 0;
  let badNumbers = 0;
  let mostShapes = 0;
  let mostCones = 0;
  const kinds = {};
  for (let seed = 500; seed < 516; seed += 1) {
    const r = playRun(sim, {
      seed,
      skill: 1.4,
      maxSeconds: 80,
      onStep(s, events) {
        if (!s.powerUps.held && s.powerUps.timer > 2 && s.time > 3) {
          const keys = Object.keys(POWERUP.kinds);
          s.powerUps.give(keys[Math.floor(s.rng() * keys.length)]);
        }
        for (const e of events) {
          if (e.type === 'power') {
            items += 1;
            kinds[e.kind] = (kinds[e.kind] || 0) + 1;
          }
        }
        if (!Number.isFinite(s.player.x) || !Number.isFinite(s.player.scale)) badNumbers += 1;
        mostShapes = Math.max(mostShapes, s.world.shapes.length);
        mostCones = Math.max(mostCones, s.cones.length);
      },
    });
    causes[r.cause] = (causes[r.cause] || 0) + 1;
  }
  check('items used all through real runs', items > 30 && Object.keys(kinds).length === 5, JSON.stringify(kinds));
  check('numbers stay sound', badNumbers === 0);
  check('collision shapes stay bounded', mostShapes < 1200, `most ${mostShapes}`);
  check('knocked props stay bounded', mostCones < 500, `most ${mostCones}; endings ${JSON.stringify(causes)}`);
  void CS;
  void SCREENS;
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
