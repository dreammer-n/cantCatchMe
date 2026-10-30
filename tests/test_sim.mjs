// Unit + scenario tests for the survival loop (pure game logic, no browser).
import { CS, Car, ChaseSimulation, SCREENS, T, buildLayout, newSim, playRun, projection, isOnScreen, Camera } from './simkit.mjs';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

// ---- Layout -------------------------------------------------------------------------------
const layout = buildLayout();
const again = buildLayout();
const kinds = {};
for (const item of layout.items) kinds[item.kind] = (kinds[item.kind] || 0) + 1;
check('layout is the same every time (fixed seed)', JSON.stringify(layout.items.map((i) => [i.kind, Math.round(i.x), Math.round(i.y)])) === JSON.stringify(again.items.map((i) => [i.kind, Math.round(i.x), Math.round(i.y)])));
check('layout has every kind of prop', ['island', 'tree', 'lamp', 'block', 'barrier', 'cone', 'wall'].every((k) => kinds[k] > 0), JSON.stringify(kinds));
const nearStart = layout.items.filter((i) => i.kind !== 'wall' && Math.hypot(i.x - T.START.x, i.y - T.START.y) < T.START.clearRadius);
check('start area is clear', nearStart.length === 0, `${nearStart.length} items inside`);
const onRoads = layout.items.filter((i) => {
  if (i.kind === 'wall') return false;
  const fx = (i.x % T.WORLD.cell) / T.WORLD.cell;
  const fy = (i.y % T.WORLD.cell) / T.WORLD.cell;
  const m = (T.WORLD.margin - 25) / T.WORLD.cell;
  return fx < m || fx > 1 - m || fy < m || fy > 1 - m;
});
check('roads between blocks stay open', onRoads.length === 0, `${onRoads.length} props on roads`);
const models = new Set(layout.items.map((i) => `${i.model}:${Math.round((i.heading * 180) / Math.PI)}`));
check('few distinct prop drawings needed', models.size < 80, `${models.size} drawings`);
check('prop count is reasonable for phones', layout.items.length < 700, `${layout.items.length} props, ${layout.paint.length} floor marks`);

// ---- Collision geometry ---------------------------------------------------------------------
const world = new CS.StaticWorld([
  { kind: 'block', x: 100, y: 0, heading: 0, collider: { type: 'box', hw: 30, hl: 30 }, breakable: false },
  { kind: 'tree', x: -100, y: 0, heading: 0, collider: { type: 'circle', r: 13 }, breakable: false },
  { kind: 'block', x: 0, y: 200, heading: Math.PI / 4, collider: { type: 'box', hw: 30, hl: 30 }, breakable: false },
]);
const out = { nx: 0, ny: 0, depth: 0 };
check('circle touching a box from the left is pushed left', CS.circleVsShape(55, 0, 21, world.shapes[0], out) && out.nx < -0.99 && Math.abs(out.depth - 6) < 1e-6, JSON.stringify(out));
check('circle clear of a box: no contact', !CS.circleVsShape(40, 0, 21, world.shapes[0], out));
check('circle touching a tree is pushed away from it', CS.circleVsShape(-70, 0, 21, world.shapes[1], out) && out.nx > 0.99 && Math.abs(out.depth - 4) < 1e-6);
// Rotated box (45 degrees): a corner points straight left at x = -42.4.
check('rotated box corner reaches the right distance', CS.circleVsShape(-60, 200, 21, world.shapes[2], out) && out.nx < -0.99, `depth ${out.depth.toFixed(2)}`);
check('grid query finds only nearby props', (() => {
  let n = 0;
  world.forEachNear(100, 0, 30, () => (n += 1));
  return n === 1;
})());

const handling = T.HANDLING_PRESETS.balanced;
function carAt(x, y, headingDeg, speed) {
  const car = new Car(handling);
  car.reset(x, y, (headingDeg * Math.PI) / 180);
  car.launch(speed);
  return car;
}

// ---- Impacts -------------------------------------------------------------------------------
function impactInto(world, car, seconds = 0.6) {
  const res = { impact: 0, shape: null };
  let maxImpact = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    car.stepFor(0, 1 / 60, 1 / 120);
    CS.collideWithWorld(car, world, res);
    maxImpact = Math.max(maxImpact, res.impact);
  }
  return maxImpact;
}
const wallWorld = new CS.StaticWorld([]);
const headOn = impactInto(wallWorld, carAt(200, 3000, 270, 300));
check('head-on into the arena wall at full speed is a crash', headOn > T.CRASH.playerImpact, `impact ${headOn.toFixed(0)}`);
const glance = impactInto(wallWorld, carAt(60, 3000, 345, 300), 1.2);
check('a 15 degree glance off the wall is survivable', glance > 0 && glance < T.CRASH.playerImpact, `impact ${glance.toFixed(0)}`);
const glancer = carAt(60, 3000, 345, 300);
impactInto(wallWorld, glancer, 1.2);
check('after glancing off, the car keeps driving along the wall', glancer.speed > 220 && glancer.x > 20, `speed ${glancer.speed.toFixed(0)}`);

const a = carAt(0, 0, 90, 300);
const b = carAt(80, 0, 270, 300);
const carImpact = CS.collideCars(a, b);
check('head-on car crash gives a big impact', carImpact > 500, `impact ${carImpact.toFixed(0)}`);
check('after the crash the cars move apart', a.vx < 0 && b.vx > 0);
const c = carAt(0, 0, 0, 300);
const d = carAt(42, 0, 10, 330);
const sideImpact = CS.collideCars(c, d);
check('side-by-side scrape gives a small impact', sideImpact < T.CRASH.policeCarImpact, `impact ${sideImpact.toFixed(0)}`);
const e1 = carAt(0, 0, 0, 300);
const e2 = carAt(0, 70, 0, 330);
const rear = CS.collideCars(e1, e2);
check('police bumping the player from behind is not a crash', rear < T.CRASH.playerImpact, `impact ${rear.toFixed(0)}`);

// ---- Scenarios in the full simulation ---------------------------------------------------------
const sim = newSim();
const view = new Camera(SCREENS.portrait).view;
function stepSim(seconds, steer = 0, activatePowerUp = false) {
  const cam = new Camera(SCREENS.portrait);
  cam.x = sim.player.x;
  cam.y = sim.player.y;
  const all = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const v = cam.follow(sim.player, 1 / 60);
    for (const e of sim.step(1 / 60, { steer, activatePowerUp: activatePowerUp && t === 0 }, v)) all.push(e);
  }
  return all;
}
sim.reset(3);
let ev = stepSim(1.0);
check('a run starts: the car accelerates north from the start', sim.player.speed > 250 && sim.player.y < T.START.y - 100, `speed ${sim.player.speed.toFixed(0)}`);
check('no police in the first second', sim.alivePolice === 0);
ev = stepSim(2.5);
check('police arrive after a moment', sim.alivePolice >= 1, `${sim.alivePolice} police`);
const firstSpawns = ev.filter((e) => e.type === 'spawn');
check('police spawn off screen and not too close', firstSpawns.every((e) => Math.hypot(e.x - sim.player.x, e.y - sim.player.y) > 500), firstSpawns.map((e) => Math.round(Math.hypot(e.x - sim.player.x, e.y - sim.player.y))).join(','));

// Two police head-on: both wrecked, explosion, combo.
sim.reset(4);
stepSim(0.2);
const hx = sim.player.x + 400;
const hy = sim.player.y - 300;
const p1 = sim.spawnPolice(hx - 100, hy, Math.PI / 2, { role: 'chaser', speedFactor: 1.1, turnDeg: 0.01, aimSide: 0 });
const p2 = sim.spawnPolice(hx + 100, hy, -Math.PI / 2, { role: 'chaser', speedFactor: 1.1, turnDeg: 0.01, aimSide: 0 });
p1.handling.maxTurnRateDeg = 0;
p2.handling.maxTurnRateDeg = 0;
ev = stepSim(0.5);
check('two police meeting head-on are both wrecked', p1.state === 'wreck' && p2.state === 'wreck');
check('the pile-up counts for the player, with a combo', sim.stats.wrecks === 2 && ev.some((e) => e.type === 'combo' && e.count === 2), `wrecks ${sim.stats.wrecks}`);
check('wreck explosions are reported', ev.filter((e) => e.type === 'explosion').length >= 2);
for (let t = 0; t < T.WRECK.lifetime + 0.5; t += 1 / 60) {
  sim.player.reset(T.START.x, T.START.y, sim.player.heading);
  sim.step(1 / 60, { steer: 0 }, view);
}
check('wrecks disappear after their lifetime', p1.state === 'idle' && p2.state === 'idle');

// Police driving into a block at speed: wrecked.
sim.reset(5);
const block = sim.world.shapes.find((s) => s.item.kind === 'block' && s.item.heading === 0);
const p3 = sim.spawnPolice(block.x - block.hw - 150, block.y, Math.PI / 2, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0 });
p3.handling.maxTurnRateDeg = 0;
stepSim(1.2);
check('police hitting a concrete block at speed are wrecked', p3.state === 'wreck' || p3.state === 'idle', p3.state);

// Player rammed hard from the side by a police car: busted.
sim.reset(6);
sim.player.reset(3000, 3000, 0);
sim.player.launch(300);
const p4 = sim.spawnPolice(2850, 2950, Math.PI / 2, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0 });
p4.handling.maxTurnRateDeg = 0;
p4.model.launch(330);
ev = stepSim(0.8);
check('a T-bone by police busts the player', sim.state === 'crashed' && sim.crash.cause === 'police', sim.crash ? sim.crash.cause : 'no crash');

// Boxed in: speed held under the limit = busted ("pinned").
sim.reset(7);
stepSim(2.5);
for (const p of sim.police) if (p.active) sim.removePolice(p, 'despawn');
sim.spawner.cooldown = 99;
for (let t = 0; t < 2; t += 1 / 60) {
  sim.player.vx = 0;
  sim.player.vy = 0;
  sim.step(1 / 60, { steer: 0 }, view);
  if (sim.state !== 'running') break;
}
check('held at a standstill for 1.4 s = busted', sim.state === 'crashed' && sim.crash.cause === 'pinned', sim.crash ? sim.crash.cause : sim.state);

// Shockwave power-up.
sim.reset(8);
stepSim(0.5);
const px = sim.player.x;
const py = sim.player.y;
const ring = [0, 1, 2, 3].map((k) => sim.spawnPolice(px + Math.cos(k * 1.57) * 250, py + Math.sin(k * 1.57) * 250, 0, { role: 'chaser', speedFactor: 1, turnDeg: 120, aimSide: 0 }));
const outside = sim.spawnPolice(px + 700, py, 0, { role: 'chaser', speedFactor: 1, turnDeg: 120, aimSide: 0 });
sim.powerUps.held = true;
ev = stepSim(1 / 60, 0, true);
check('shockwave wrecks every police car within range', ring.every((p) => p.state === 'wreck'), ring.map((p) => p.state).join(','));
check('shockwave leaves police further away alone', outside.alive);
check('shockwave is used up', !sim.powerUps.held && ev.some((e) => e.type === 'pulse'));

// Crate appears and can be collected.
sim.reset(9);
sim.time = 15;
sim.powerUps.timer = 0.05;
let crateSeen = false;
let picked = false;
for (let t = 0; t < 30 && !picked && sim.state === 'running'; t += 1 / 60) {
  // Steer straight at the crate when there is one.
  let steer = 0;
  const crate = sim.powerUps.crate;
  if (crate.active) {
    crateSeen = true;
    const want = Math.atan2(crate.x - sim.player.x, -(crate.y - sim.player.y));
    const diff = Math.atan2(Math.sin(want - sim.player.heading), Math.cos(want - sim.player.heading));
    steer = diff > 0.05 ? 1 : diff < -0.05 ? -1 : 0;
  }
  // Keep police away for this test.
  for (const p of sim.police) if (p.active) sim.removePolice(p, 'despawn');
  const events = sim.step(1 / 60, { steer }, view);
  if (events.some((e) => e.type === 'pickup')) picked = true;
}
check('a Shockwave crate appears during the run', crateSeen);
check('driving through the crate picks it up', picked && sim.powerUps.held);

// Close call.
sim.reset(10);
sim.player.reset(3000, 3000, 0);
sim.player.launch(300);
stepSim(0.05);
const p5 = sim.spawnPolice(3000 + 66, 2700, Math.PI, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0 });
p5.handling.maxTurnRateDeg = 0;
ev = stepSim(1.0);
check('police passing very close at speed counts as a close call', sim.stats.nearMisses === 1 && sim.state === 'running', `near misses ${sim.stats.nearMisses}, ${sim.state}`);

// Cone.
sim.reset(11);
const cone = sim.cones[0];
sim.player.reset(cone.x, cone.y + 120, 0);
sim.player.launch(300);
stepSim(0.6);
check('driving into a cone knocks it flying, no crash', cone.state !== 'standing' && sim.state === 'running', cone.state);

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
