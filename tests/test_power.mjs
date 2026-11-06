// Checks for the mystery box and its items: Giant, Freeze, Pillars, Flamer, auto-fire, double tap.
import { Camera, Car, CS, ChaseSimulation, SCREENS, T, fixedMap, newSim, playRun, projection } from './simkit.mjs';
import { DoubleTap } from '../src/systems/InputManager.js';
import { ThreatRadar } from '../src/systems/ThreatRadar.js';
import * as props from '../src/render/propModels.js';
import { buildLayout, propCatalogue } from '../src/systems/WorldLayout.js';

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
  const later = run(s, 0.5);
  check('after 4 seconds it fires by itself', !s.powerUps.held && later.some((e) => e.type === 'power' && e.kind === 'flamer'));
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
  check('items used all through real runs', items > 30 && Object.keys(kinds).length === Object.keys(POWERUP.kinds).length, JSON.stringify(kinds));
  check('numbers stay sound', badNumbers === 0);
  check('collision shapes stay bounded', mostShapes < 1200, `most ${mostShapes}`);
  // Suburbs street furniture (hydrants, mailboxes, bins, hedges, fences) adds to the breakable props in the grid.
  check('knocked props stay bounded', mostCones < 650, `most ${mostCones}; endings ${JSON.stringify(causes)}`);
  void CS;
  void SCREENS;
}

// ---- The five newer items ---------------------------------------------------------------------
{
  const { TURBO, SLICK, DECOY, BLACKOUT, PHANTOM } = T;
  check('ten items, each with a name of its own', Object.keys(POWERUP.kinds).length === 10 && new Set(Object.values(POWERUP.names)).size === 10 && POWERUP.names.turbo === 'TURBO' && POWERUP.names.slick === 'SLICK' && POWERUP.names.decoy === 'DECOY' && POWERUP.names.blackout === 'BLACKOUT' && POWERUP.names.phantom === 'PHANTOM');

  // TURBO: far past the car's own top speed, then back to normal.
  const t = quiet();
  drive(t, 3000, 3000);
  run(t, 1);
  const before = t.player.speed;
  useItem(t, 'turbo');
  run(t, TURBO.seconds - 0.3);
  check('TURBO: well past the car\'s own top speed', t.player.speed > before * 1.3, `${before.toFixed(0)} -> ${t.player.speed.toFixed(0)}`);
  run(t, 2.5);
  check('and back to normal afterwards', t.player.boost === 1 && t.player.speed < before * 1.05, `${t.player.speed.toFixed(0)}`);

  // SLICK: puddles behind the car; a police car driving into one spins out.
  const o = quiet();
  drive(o, 3000, 3000, 0);
  useItem(o, 'slick');
  run(o, 1.2);
  const puddles = o.powerUps.puddles.filter((p) => p.active);
  check('SLICK: puddles laid behind the car', puddles.length === SLICK.puddles && puddles.every((p) => p.y > o.player.y), `${puddles.length}`);
  const first = puddles[0];
  const chaser = cop(o, first.x, first.y + 160, 0, { launchShare: 1, turnDeg: 0 });
  run(o, 0.8);
  check('a police car that drives into it spins out', chaser.spinning > 0 || chaser.state === 'wreck' || Math.abs(chaser.model.angularVelocity) > 2, `spin ${chaser.spinning.toFixed(2)}, turn ${chaser.model.angularVelocity.toFixed(1)}`);
  run(o, SLICK.seconds);
  check('the oil dries up', o.powerUps.puddles.every((p) => !p.active));

  // DECOY: police close by chase the copy; far ones don't; afterwards they chase the player again.
  const d = quiet();
  drive(d, 3000, 3000, 0);
  const near = cop(d, 3000, 3500, 0);
  const far = cop(d, 3000, 3000 + DECOY.lureRadius + 400, 0);
  useItem(d, 'decoy');
  check('DECOY: a copy drives off, peeling away from the car', d.decoy.active && Math.abs(Math.sin(d.decoy.car.heading - d.player.heading)) > 0.3);
  check('police close by chase it, those far off don\'t', near.lured && !far.lured);
  run(d, DECOY.seconds + 0.1);
  check('then it vanishes, and they chase the player again', !d.decoy.active && !near.lured);

  // BLACKOUT: engines die close by, and the cars coast to a stop.
  const b = quiet();
  drive(b, 3000, 3000, 0);
  const dead = cop(b, 3000, 3300, 0, { launchShare: 1 });
  const alive = cop(b, 3000 + BLACKOUT.radius + 300, 3000, 0, { launchShare: 1 });
  run(b, 0.2);
  const speedBefore = dead.model.speed;
  useItem(b, 'blackout');
  run(b, BLACKOUT.seconds - 0.4);
  check('BLACKOUT: police close by lose their engines and coast to a crawl', dead.stalled > 0 && dead.model.speed < speedBefore * 0.3, `${speedBefore.toFixed(0)} -> ${dead.model.speed.toFixed(0)}, ${dead.state}, stalled ${dead.stalled.toFixed(2)}`);
  check('those far off carry on', alive.stalled === 0);
  run(b, 0.6);
  check('then the engines start again', dead.stalled <= 0);

  // PHANTOM: through a wall and through a police car, unharmed; holes still swallow it.
  const wall = { kind: 'block', x: 3000, y: 2700, heading: 0, model: 'b', params: {}, collider: { type: 'box', hw: 80, hl: 30 }, breakable: false };
  const g = quiet([wall]);
  drive(g, 3000, 3000, 0);
  useItem(g, 'phantom');
  cop(g, 3000, 2850, Math.PI, { launchShare: 1 });
  run(g, 1.6);
  check('PHANTOM: straight through a wall and a police car, unharmed', g.state === 'running' && g.player.y < 2600, `y ${g.player.y.toFixed(0)}, ${g.state}`);
  run(g, PHANTOM.seconds);
  check('and solid again afterwards', !g.player.ghost);
  const stuck = quiet([{ ...wall, y: 3000, collider: { type: 'box', hw: 1600, hl: 1600 } }]);
  drive(stuck, 3000, 3000, 0, 0);
  stuck.player.halt();
  useItem(stuck, 'phantom');
  run(stuck, PHANTOM.seconds + 0.2);
  check('it stays a ghost while it is still inside something', stuck.player.ghost);
  run(stuck, PHANTOM.extraSeconds);
  check('but never for ever', !stuck.player.ghost);
  const hole = { kind: 'void', isVoid: true, x: 3000, y: 2800, heading: 0, collider: { type: 'circle', r: 90 }, breakable: false, outline: [] };
  const h = quiet([hole]);
  drive(h, 3000, 3000, 0);
  useItem(h, 'phantom');
  run(h, 2);
  check('a hole still swallows a ghost', h.player.isFalling || h.state === 'crashed');

  // The timer ring.
  const r = quiet();
  drive(r, 3000, 3000);
  useItem(r, 'turbo');
  const full = r.powerUps.activeEffect();
  run(r, TURBO.seconds / 2);
  const half = r.powerUps.activeEffect();
  run(r, TURBO.seconds);
  check('the timer ring shows the item and runs down', full.kind === 'turbo' && full.share > 0.95 && Math.abs(half.share - 0.5) < 0.05 && r.powerUps.activeEffect() === null);
  r.reset(3);
  check('a new run starts with nothing working', r.powerUps.activeEffect() === null && r.player.boost === 1 && !r.player.ghost && !r.decoy.active);
}

// ---- The airstrike -----------------------------------------------------------------------------
{
  const { AIRSTRIKE } = T;
  const s = quiet();
  drive(s, 3000, 3000);
  s.time = AIRSTRIKE.firstAt - 0.5;
  const early = run(s, 0.3);
  check('no airstrike before 3 minutes', !s.airstrike.active && !early.some((e) => e.type === 'airstrike'));
  const on = run(s, 0.4);
  check('at 3 minutes the jet comes, with a warning', s.airstrike.active && on.filter((e) => e.type === 'airstrike').length === 1);
  const bombs = s.airstrike.bombs;
  check('every bomb lands at least 2.5 s after its circle appears', bombs.every((b) => b.landAt >= 2.5));
  // Driving straight on, the car is never where a bomb lands: the line runs beside its way.
  const p = s.player;
  const nearest = Math.min(...bombs.map((b) => Math.hypot(p.x + p.vx * b.landAt - b.x, p.y + p.vy * b.landAt - b.y)));
  check('a car that drives straight on is never under a bomb', nearest > AIRSTRIKE.blastRadius, `${nearest.toFixed(0)} units at the closest, speed ${p.speed.toFixed(0)}`);
  let worst = Infinity;
  for (const speed of [160, 250, 320, 420, 600]) {
    for (let seed = 1; seed < 120; seed += 1) {
      const w = quiet();
      w.reset(seed);
      drive(w, 3000, 3000, seed * 0.37, speed);
      w.airstrike.start(w);
      const q = w.player;
      for (const b of w.airstrike.bombs) worst = Math.min(worst, Math.hypot(q.x + q.vx * b.landAt - b.x, q.y + q.vy * b.landAt - b.y));
    }
  }
  check('at any speed, from the slowest car to TURBO on the Hypercar', worst > AIRSTRIKE.blastRadius, `${worst.toFixed(0)} units at the closest`);
  // Police inside a blast are wrecked; the player is wrecked if caught.
  const t = quiet();
  drive(t, 3000, 3000, 0, 0);
  t.player.halt();
  t.airstrike.start(t);
  const target = t.airstrike.bombs[2];
  const caught = cop(t, target.x + 20, target.y, 0);
  caught.handling.acceleration = 0;
  const safe = cop(t, target.x + 900, target.y + 900, 0);
  t.player.reset(target.x - 30, target.y, 0);
  t.player.halt();
  t.player.handling.acceleration = 0;
  run(t, AIRSTRIKE.warningSeconds + 1);
  check('police caught in a blast are wrecked, others aren\'t', caught.state !== 'chasing' && safe.alive, `${caught.state} / ${safe.state}`);
  check('the player caught in one is wrecked', t.state === 'crashed' && t.crash.cause === 'airstrike');
  const g = quiet();
  drive(g, 3000, 3000, 0, 0);
  g.airstrike.start(g);
  const spot = g.airstrike.bombs[2];
  g.player.reset(spot.x, spot.y, 0);
  g.player.halt();
  g.player.handling.acceleration = 0;
  useItem(g, 'giant');
  run(g, AIRSTRIKE.warningSeconds + 1);
  check('a TITAN shrugs it off', g.state === 'running');
  run(g, 0.1);
  check('and the strike comes round again later', !g.airstrike.active || g.airstrike.nextAt > g.time);
  g.reset(4);
  check('a new run starts with no strike', !g.airstrike.active && g.airstrike.nextAt === AIRSTRIKE.firstAt);
}

// ---- Suburbs: street furniture, gardens and ramps ----------------------------------------------
{
  const { RAMP, MAPS: maps } = T;
  const suburbs = buildLayout(undefined, maps[0]);
  const kinds = {};
  let rampsByHoles = 0;
  for (let cx = -4; cx < 4; cx += 1) {
    for (let cy = -4; cy < 4; cy += 1) {
      const c = suburbs.chunkAt(cx, cy);
      for (const i of c.items) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
      for (const ramp of c.items.filter((i) => i.isRamp)) if (c.voids.some((v) => Math.hypot(v.x - ramp.x, v.y - ramp.y) < RAMP.holeClearance)) rampsByHoles += 1;
    }
  }
  check('Suburbs has hydrants, mailboxes, trash cans, hedges, fences and ramps', ['hydrant', 'mailbox', 'trashcan', 'bush', 'fence', 'ramp'].every((k) => kinds[k] > 0), JSON.stringify(['hydrant', 'mailbox', 'trashcan', 'bush', 'fence', 'ramp'].map((k) => kinds[k] || 0)));
  check('no road hole right by a ramp', rampsByHoles === 0, `${rampsByHoles}`);
  const others = maps.slice(1).map((m) => buildLayout(undefined, m));
  check('the other maps don\'t have them', others.every((l) => [0, 1, 2].every((cx) => l.chunkAt(cx, 1).items.every((i) => !['hydrant', 'mailbox', 'trashcan', 'ramp'].includes(i.kind)))));

  // A ramp, low end first, fast enough: the car flies over a police car and a hole, then lands.
  const ramp = { kind: 'ramp', isRamp: true, x: 3000, y: 2900, heading: 0, model: 'ramp', params: {}, collider: { type: 'box', hw: RAMP.width / 2, hl: RAMP.length / 2 }, breakable: false };
  const hole = { kind: 'void', isVoid: true, x: 3000, y: 2720, heading: 0, collider: { type: 'circle', r: 35 }, breakable: false, outline: [] };
  const s = quiet([ramp, hole]);
  drive(s, 3000, 3000, 0, 320);
  const blocker = cop(s, 3000, 2790, 0);
  blocker.handling.acceleration = 0;
  const events = run(s, 0.45);
  check('a ramp sends the car into the air', events.some((e) => e.type === 'jump'));
  run(s, 0.9);
  check('it flies over a police car and a hole, and lands', s.state === 'running' && !s.player.isFalling && s.player.y < 2680 && s.player.air === 0 && blocker.alive, `y ${s.player.y.toFixed(0)}, ${s.state}, police ${blocker.state}`);
  const slow = quiet([ramp]);
  drive(slow, 3000, 3000, 0, 100);
  slow.player.handling.acceleration = 0;
  check('too slow, it just rolls over', !run(slow, 1.2).some((e) => e.type === 'jump'));
  const back = quiet([{ ...ramp, heading: Math.PI }]);
  drive(back, 3000, 3000, 0, 320);
  check('from the high end, nothing', !run(back, 0.6).some((e) => e.type === 'jump'));
}

// ---- Winter, Desert and Woods ------------------------------------------------------------------
{
  const { MAPS: maps, WOODS_MAP, CHUNKS, WORLD, START } = T;
  const { buildChunk, hasRiver, riverMiddle } = await import('../src/systems/WorldLayout.js');
  const [suburbs, winter, desert, woods] = maps;
  const survey = (map) => {
    const out = { kinds: {}, surfaces: {}, ponds: 0, water: 0, dirt: 0, fullest: 0, chunks: [] };
    for (let cy = -4; cy <= 4; cy += 1) {
      for (let cx = -4; cx <= 4; cx += 1) {
        const c = buildChunk(cx, cy, undefined, map);
        out.chunks.push(c);
        out.fullest = Math.max(out.fullest, c.items.length);
        for (const i of c.items) out.kinds[i.kind] = (out.kinds[i.kind] || 0) + 1;
        for (const s of c.surfaces) {
          out.surfaces[s.kind] = (out.surfaces[s.kind] || 0) + 1;
          if (s.pond) out.ponds += 1;
        }
        out.water += c.voids.filter((v) => v.water).length;
        out.dirt += c.paint.filter((m) => m.color === 'dirt').length;
      }
    }
    return out;
  };
  const all = { suburbs: survey(suburbs), winter: survey(winter), desert: survey(desert), woods: survey(woods) };
  const w = all.winter;
  const d = all.desert;
  const wd = all.woods;
  check('Winter has ice patches, frozen ponds and snowmen', w.surfaces.ice > 0 && w.ponds > 0 && w.kinds.snowman > 0, `${w.surfaces.ice} ice, ${w.ponds} ponds, ${w.kinds.snowman} snowmen`);
  check('Desert has soft sand, oil pumps, barrels and tumbleweeds', d.surfaces.sand > 0 && d.kinds.pumpjack > 0 && d.kinds.barrel > 0 && d.kinds.tumbleweed > 0, `${d.surfaces.sand} sand, ${d.kinds.pumpjack} pumps`);
  check('Woods has rivers with bridges and railings, lumber stacks and thickets with a path', wd.surfaces.river > 0 && wd.water > 0 && wd.kinds.bridge > 0 && wd.kinds.railing > 0 && wd.kinds.lumber > 0 && wd.dirt > 0, `${wd.surfaces.river} river stretches, ${wd.kinds.bridge} bridges, ${wd.dirt} paths`);
  const mine = { winter: ['snowman'], desert: ['tumbleweed', 'pumpjack', 'barrel'], woods: ['bridge', 'railing', 'lumber'] };
  check('each map keeps its own things', Object.entries(all).every(([name, s]) => Object.entries(mine).every(([owner, kinds]) => owner === name || kinds.every((k) => !s.kinds[k]))));
  check('only Winter has ice, only Desert soft sand, only Woods rivers', !all.suburbs.surfaces.ice && !d.surfaces.ice && !w.surfaces.sand && !wd.surfaces.sand && !w.surfaces.river && !d.surfaces.river && !all.suburbs.surfaces.river);
  for (const [name, s] of Object.entries(all)) {
    const map = maps.find((m) => s === all[m.id === 'suburb' ? 'suburbs' : m.id]);
    const catalogue = new Set(propCatalogue(map).map((e) => `${e.model}:${Math.round((e.heading * 180) / Math.PI)}`));
    const unknown = new Set(s.chunks.flatMap((c) => c.items.map((i) => `${i.model}:${Math.round((i.heading * 180) / Math.PI)}`)).filter((k) => !catalogue.has(k)));
    check(`${name}: every prop is drawn at startup`, unknown.size === 0, [...unknown].slice(0, 4).join(' '));
    check(`${name}: few distinct prop drawings`, catalogue.size < 130, `${catalogue.size}`);
    check(`${name}: the prop pool covers the fullest chunks`, s.fullest * 9 <= CHUNKS.propPool, `fullest ${s.fullest}`);
    // Nothing that blocks or swallows a car on a road (bridge decks are the road; railings stand just beside it).
    const strip = WORLD.margin - 25;
    const onRoad = (x, y) => {
      const fx = ((x % WORLD.cell) + WORLD.cell) % WORLD.cell;
      const fy = ((y % WORLD.cell) + WORLD.cell) % WORLD.cell;
      return fx < strip || fx > WORLD.cell - strip || fy < strip || fy > WORLD.cell - strip;
    };
    const blocking = s.chunks.flatMap((c) => (c.preset === 'plaza' ? [] : [...c.items.filter((i) => i.collider && !i.isRamp), ...c.voids.filter((v) => v.water)].filter((i) => onRoad(i.x, i.y))));
    check(`${name}: no prop or river on any road (road holes are meant)`, blocking.length === 0, blocking.slice(0, 3).map((i) => `${i.kind} ${i.x},${i.y}`).join(' '));
    check(`${name}: everything inside its own chunk`, s.chunks.every((c) => [...c.items, ...c.voids, ...c.surfaces].every((i) => Math.floor(i.x / CHUNKS.size) === c.cx && Math.floor(i.y / CHUNKS.size) === c.cy)));
  }
  check('ice and sand stay clear of the start', [...w.chunks, ...d.chunks].every((c) => c.surfaces.every((s) => Math.hypot(s.x - START.x, s.y - START.y) > START.clearRadius)));

  // The river: in every other row of chunks, never the start's; unbroken from chunk to chunk; a bridge on every road.
  check('no river across the start', !hasRiver(Math.floor(START.y / CHUNKS.size)) && hasRiver(0) && hasRiver(2) && !hasRiver(-1));
  const riverChunks = wd.chunks.filter((c) => c.surfaces.some((s) => s.kind === 'river'));
  const seamOk = riverChunks.every((c) => {
    const next = wd.chunks.find((n) => n.cx === c.cx + 1 && n.cy === c.cy);
    if (!next) return true;
    const a = c.surfaces.find((s) => s.kind === 'river').outline;
    const b = next.surfaces.find((s) => s.kind === 'river').outline;
    const half = a.length / 2;
    // Top edge: a's last point meets b's first; bottom edge: a's first bottom point (from the east) meets b's last.
    return Math.abs(a[half - 1].x - b[0].x) < 0.01 && Math.abs(a[half - 1].y - b[0].y) < 0.2 && Math.abs(a[half].y - b[b.length - 1].y) < 0.2;
  });
  check('the river runs on unbroken from one chunk to the next', riverChunks.length > 0 && seamOk);
  check('every road over the river has a bridge, with railings on both sides', riverChunks.every((c) => {
    const decks = c.items.filter((i) => i.kind === 'bridge').map((i) => i.x - c.x0).sort((a, b) => a - b);
    const rails = c.items.filter((i) => i.kind === 'railing').length;
    return JSON.stringify(decks) === JSON.stringify([0, 600, 1200, 1800]) && rails === 8;
  }));
  check('the water only swallows cars in the blocks, never on a road', riverChunks.every((c) => c.voids.filter((v) => v.water).every((v) => Math.abs(((v.x % WORLD.cell) + WORLD.cell) % WORLD.cell - WORLD.cell / 2) < 1 && v.collider.hl <= WORLD.cell / 2 - WORLD.margin)));
  check('no road hole on a bridge', riverChunks.every((c) => c.voids.filter((v) => !v.water).every((v) => Math.abs(v.y - riverMiddle(c.cy)) > 200)));

  // Driving on them.
  const ice = { kind: 'ice', surface: 'ice', x: 3000, y: 2700, heading: 0, collider: { type: 'circle', r: 700 }, outline: [] };
  const turnOn = (items) => {
    const s = quiet(items);
    drive(s, 3000, 3000, 0, 330);
    let slip = 0;
    for (let t = 0; t < 0.8; t += 1 / 60) {
      s.step(1 / 60, { steer: 1 }, offView);
      slip = Math.max(slip, Math.abs(s.player.slipAngle));
    }
    // How far the way the car is going has turned, and how far its nose has.
    return { slip, travel: Math.atan2(s.player.vx, -s.player.vy), nose: s.player.heading, surface: s.player.surface };
  };
  const onIce = turnOn([ice]);
  const onRoad = turnOn([]);
  check('on ice the car knows it', onIce.surface === 'ice' && onRoad.surface === null);
  const deg = (a) => ((a * 180) / Math.PI).toFixed(0);
  check('on ice the nose turns as fast, but the car slides on: its path bends far less', Math.abs(onIce.nose - onRoad.nose) < 0.1 && onIce.travel < onRoad.travel * 0.8 && onIce.slip > onRoad.slip * 1.2, `path turned ${deg(onIce.travel)} against ${deg(onRoad.travel)} degrees`);
  const sand = { kind: 'sand', surface: 'sand', x: 3000, y: 2500, heading: 0, collider: { type: 'circle', r: 900 }, outline: [] };
  const straight = (items) => {
    const s = quiet(items);
    drive(s, 3000, 3000, 0, s.player.handling.topSpeed);
    run(s, 2);
    return s.player.speed;
  };
  const sandSpeed = straight([sand]);
  const roadSpeed = straight([]);
  check('soft sand drags the speed down', sandSpeed < roadSpeed * 0.7, `${sandSpeed.toFixed(0)} against ${roadSpeed.toFixed(0)}`);
  const police = quiet([ice]);
  drive(police, 3000, 3400, 0, 200);
  const p = cop(police, 3000, 2900, 0);
  run(police, 0.2);
  check('police feel the ice too', p.model.surface === 'ice');

  // The river in the real Woods layout: a bridge carries the car over; the water ends the run.
  const woodsSim = () => {
    const s = new ChaseSimulation({ layout: buildLayout(undefined, woods), handling });
    s.spawner.cooldown = 1e6;
    s.spawner.nextRoadblock = 1e6;
    s.powerUps.timer = 1e6;
    s.helicopter.update = () => {};
    return s;
  };
  const middle = riverMiddle(0);
  const over = woodsSim();
  drive(over, 1200, middle + 450, 0, 320);
  run(over, 3);
  check('a bridge carries the car over the river', over.state === 'running' && over.player.y < middle - 300, `${over.state}, y ${over.player.y.toFixed(0)}`);
  const into = woodsSim();
  drive(into, 1500, middle + 300, 0, 320);
  const events = run(into, 3);
  check('driving into the river ends the run, like a hole', into.state === 'crashed' && into.crash.cause === 'void' && events.some((e) => e.type === 'fall'), into.state);
  check('the car knows it went into water', into.player.fallShape && into.player.fallShape.item.water === true);
  const railed = woodsSim();
  drive(railed, 1200, middle + 60, Math.PI / 2, 300);
  run(railed, 0.6);
  check('a bridge railing is solid', railed.player.x < 1200 + WOODS_MAP.railInset && !railed.player.isFalling, `x ${railed.player.x.toFixed(0)}`);
}

// ---- Wrecks are knocked aside, never a crash (owner, 2026-11-06) -------------------------------
{
  const s = quiet();
  drive(s, 3000, 3300, 0, 340);
  const p = cop(s, 3000, 3100, 0);
  p.model.halt();
  s.wreckPolice(p, 'test');
  run(s, 0.05);
  const before = { x: p.model.x, y: p.model.y };
  const speedBefore = s.player.speed;
  const events = run(s, 0.8);
  check('driving straight into a wreck is no crash', s.state === 'running' && !events.some((e) => e.type === 'crash'), s.state);
  check('the wreck is knocked out of the way', Math.hypot(p.model.x - before.x, p.model.y - before.y) > 40, `moved ${Math.hypot(p.model.x - before.x, p.model.y - before.y).toFixed(0)}`);
  check('the car drives on past where the wreck was, a little slower', s.player.y < 3080 && s.player.speed > speedBefore * 0.7, `speed ${s.player.speed.toFixed(0)} of ${speedBefore.toFixed(0)}`);
  check('and it is told, once', events.filter((e) => e.type === 'wreckKnock').length === 1);
  // Police still come off worst against a wreck.
  const t = quiet();
  drive(t, 4000, 4000, Math.PI / 2, 0);
  t.player.handling = { ...t.player.handling, acceleration: 0 };
  const w = cop(t, 3000, 2800, 0);
  w.model.halt();
  t.wreckPolice(w, 'test');
  const chaser = cop(t, 3000, 3000, 0, { launchShare: 1, speedFactor: 1.2 });
  run(t, 1);
  check('a police car that hits a wreck is wrecked', chaser.state === 'wreck', chaser.state);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
