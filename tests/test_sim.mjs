// Unit + scenario tests for the survival loop (pure game logic, no browser).
import { CS, Car, CameraRig, ChaseSimulation, SCREENS, T, buildLayout, fixedMap, newSim, playRun, projection, isOnScreen, Camera } from './simkit.mjs';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

// ---- Layout -------------------------------------------------------------------------------
// (Chunks and their layouts are checked in test_world.mjs.)
const layout = buildLayout();
const startChunk = layout.chunkAt(Math.floor(T.START.x / T.CHUNKS.size), Math.floor(T.START.y / T.CHUNKS.size));
const nearStart = [...startChunk.items, ...startChunk.voids].filter((i) => Math.hypot(i.x - T.START.x, i.y - T.START.y) < T.START.clearRadius);
check('start area is clear', nearStart.length === 0, `${nearStart.length} items inside`);

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
// A long block whose east face runs along x = 0: an obstacle too big to miss.
const wallWorld = new CS.StaticWorld([{ kind: 'block', x: -300, y: 3000, heading: 0, collider: { type: 'box', hw: 300, hl: 2000 }, breakable: false }]);
const headOn = impactInto(wallWorld, carAt(200, 3000, 270, 300));
check('head-on into a big solid obstacle at full speed is a crash', headOn > T.CRASH.playerImpact, `impact ${headOn.toFixed(0)}`);
const glance = impactInto(wallWorld, carAt(60, 3000, 345, 300), 1.2);
check('a 15 degree glance off it is survivable', glance > 0 && glance < T.CRASH.playerImpact, `impact ${glance.toFixed(0)}`);
const glancer = carAt(60, 3000, 345, 300);
impactInto(wallWorld, glancer, 1.2);
check('after glancing off, the car keeps driving along it', glancer.speed > 220 && glancer.x > 20, `speed ${glancer.speed.toFixed(0)}`);

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
  cam.snap(sim.player);
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
const cone = sim.cones.find((c) => c.item.kind === 'cone');
sim.player.reset(cone.x, cone.y + 120, 0);
sim.player.launch(300);
stepSim(0.6);
check('driving into a cone knocks it flying, no crash', cone.state !== 'standing' && sim.state === 'running', cone.state);

// Collision tiers, each on a small map with just the one prop.
const tierSim = (items) => new ChaseSimulation({ layout: fixedMap(items), handling });
const quietView = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
function stepTier(s, seconds) {
  const all = [];
  let slowest = Infinity;
  for (let t = 0; t < seconds && s.state === 'running'; t += 1 / 60) {
    for (const e of s.step(1 / 60, { steer: 0 }, quietView)) all.push({ ...e });
    slowest = Math.min(slowest, s.player.speed);
  }
  return { events: all, slowest };
}
const noSpawns = (s) => {
  s.spawner.cooldown = 1e6;
  s.powerUps.timer = 1e6;
};

// Curb: straight across a parking island at full speed.
{
  const s = tierSim([{ kind: 'island', x: 1000, y: 1000, heading: Math.PI / 2, collider: { type: 'box', hw: 35, hl: 200 }, breakable: false, curb: true }]);
  noSpawns(s);
  s.player.reset(1000, 1200, 0);
  s.player.launch(300);
  const { events, slowest } = stepTier(s, 1.4);
  const climbs = events.filter((e) => e.type === 'curb').length;
  check('driving over a curb is not a crash, the car gets across', s.state === 'running' && s.player.y < 900, `y ${s.player.y.toFixed(0)}`);
  check('a curb crossing bumps exactly once', climbs === 1, `${climbs} bumps`);
  check('a curb costs 15-25% of top speed', slowest > 225 && slowest < 256, `slowest ${slowest.toFixed(0)}`);
  check('the car is back to top speed soon after a curb', s.player.speed > 295, `speed ${s.player.speed.toFixed(0)}`);
}

// Curb: at an angle, the bump turns the car toward running along the edge.
{
  const s = tierSim([{ kind: 'island', x: 1000, y: 1000, heading: Math.PI / 2, collider: { type: 'box', hw: 35, hl: 300 }, breakable: false, curb: true }]);
  noSpawns(s);
  s.player.reset(800, 1200, Math.PI / 4);
  s.player.launch(300);
  stepTier(s, 0.8);
  check('climbing a curb at an angle deflects the nose along it', s.player.heading > Math.PI / 4 + 0.03, `${((s.player.heading * 180) / Math.PI).toFixed(1)} deg, started at 45`);
}

// A car stopped on a curb can still drive off (no stalling into a "pinned" bust).
{
  const s = tierSim([{ kind: 'island', x: 1000, y: 1000, heading: Math.PI / 2, collider: { type: 'box', hw: 35, hl: 200 }, breakable: false, curb: true }]);
  noSpawns(s);
  s.player.reset(1000, 1000, 0);
  stepTier(s, 3);
  check('a car starting on a curb can drive off it', s.state === 'running' && s.player.y < 900, `y ${s.player.y.toFixed(0)}, ${s.state}`);
}

// Lamp post: knocked away with a small speed penalty, and back later when out of sight.
{
  const lamp = { kind: 'lamp', x: 1000, y: 1000, heading: 0, collider: { type: 'circle', r: T.COLLISION.lampRadius }, breakable: true };
  const s = tierSim([lamp]);
  noSpawns(s);
  s.player.reset(1000, 1200, 0);
  s.player.launch(300);
  const { events, slowest } = stepTier(s, 1);
  check('hitting a lamp post head-on knocks it away, no crash', s.state === 'running' && s.cones[0].state !== 'standing' && events.some((e) => e.type === 'cone' && e.player));
  check('a lamp post costs a small amount of speed', slowest > 250 && slowest < 285, `slowest ${slowest.toFixed(0)}`);
  for (let t = 0; t < T.CONES.respawnSeconds + T.CONES.flySeconds + 1; t += 1 / 60) s.updateCones(1 / 60, quietView);
  check('a knocked lamp post returns while off screen', s.cones[0].state === 'standing', s.cones[0].state);
}

// Trees are still solid, and a hard hit still ends the run.
{
  const s = tierSim([{ kind: 'tree', x: 1000, y: 1000, heading: 0, collider: { type: 'circle', r: 16 }, breakable: false }]);
  noSpawns(s);
  s.player.reset(1000, 1200, 0);
  s.player.launch(300);
  stepTier(s, 1);
  check('hitting a tree head-on at full speed is still a crash', s.state === 'crashed' && s.crash.cause === 'obstacle', s.state);
}

// Solid block, angle by angle: glancing hits scrape along it, steep ones are fatal.
function hitBlockAt(angleDeg) {
  const s = tierSim([{ kind: 'block', x: 1000, y: 800, heading: 0, collider: { type: 'box', hw: 400, hl: 100 }, breakable: false }]);
  noSpawns(s);
  const a = (angleDeg * Math.PI) / 180; // 90 = straight at the block's long south face
  s.player.reset(1000 - Math.cos(a) * 170, 900 + 60 + Math.sin(a) * 170, Math.PI / 2 - a);
  s.player.launch(300);
  return { s, ...stepTier(s, 0.9) };
}
{
  const shallow = hitBlockAt(20);
  check('a 20 degree scrape along a block: no crash, keeps most of its speed', shallow.s.state === 'running' && shallow.s.player.speed > 240, `speed ${shallow.s.player.speed.toFixed(0)}, ${shallow.s.state}`);
  const reported = shallow.events.filter((e) => e.type === 'scrape' || e.type === 'bump').length;
  check('a scrape is reported, and only a few times', reported >= 1 && reported <= 6, `${reported} events`);
  check('a 35 degree hit on a block is survivable', hitBlockAt(35).s.state === 'running');
  check('a 75 degree hit on a block is a crash', hitBlockAt(75).s.state === 'crashed');
}

// Police ride over curbs too, and are not wrecked by them.
{
  const s = tierSim([{ kind: 'island', x: 1000, y: 1000, heading: Math.PI / 2, collider: { type: 'box', hw: 35, hl: 200 }, breakable: false, curb: true }]);
  noSpawns(s);
  s.player.reset(1800, 2000, 0);
  const p = s.spawnPolice(1000, 1200, 0, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0 });
  p.handling.maxTurnRateDeg = 0;
  stepTier(s, 1);
  check('police cross curbs without being wrecked', p.alive && p.model.y < 900, `${p.state}, y ${p.model.y.toFixed(0)}`);
}

// Police spawned at the far edge of the new, longer view must not be recycled at once.
{
  const s = newSim();
  s.reset(12);
  const cam = new Camera(SCREENS.portrait);
  cam.snap(s.player);
  let early = 0;
  const born = new Map();
  for (let t = 0; t < 30 && s.state === 'running'; t += 1 / 60) {
    s.player.vx = 0;
    s.player.vy = -300;
    s.player.x = 3000;
    s.player.y = 3000;
    const v = cam.follow(s.player, 1 / 60);
    for (const e of s.step(1 / 60, { steer: 0 }, v)) {
      if (e.type === 'spawn') born.set(e.police, s.time);
      if (e.type === 'despawn' && s.time - (born.get(e.police) ?? -99) < 1) early += 1;
    }
  }
  check('no police car is removed within a second of spawning', early === 0 && born.size > 0, `${early} of ${born.size} spawns`);
}

// ---- Camera -------------------------------------------------------------------------------
function steadyCamera(screen, headingDeg, seconds = 5) {
  const cam = new Camera(screen);
  const car = carAt(3000, 3000, headingDeg, 300);
  cam.snap(car);
  for (let t = 0; t < seconds; t += 1 / 60) {
    car.step(0, 1 / 60);
    cam.follow(car, 1 / 60);
  }
  projection.toScreen(car.x, car.y, 0, cam.p);
  const v = cam.view;
  projection.toScreen(cam.rig.x, cam.rig.y, 0, cam.p);
  const carOff = (() => {
    const s = { x: 0, y: 0 };
    projection.toScreen(car.x, car.y, 0, s);
    return { x: (s.x - cam.p.x) / (v.halfW * 2), y: (s.y - cam.p.y) / (v.halfH * 2) };
  })();
  return { cam, car, share: Math.hypot(carOff.x, carOff.y), offX: carOff.x, offY: carOff.y };
}
for (const [name, screen] of Object.entries(SCREENS)) {
  const shares = [0, 45, 90, 135, 180, 225, 270, 315].map((h) => steadyCamera(screen, h).share);
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  check(`${name}: at speed the car sits in the rear third, in every direction`, lo >= 1 / 6 && hi <= 1 / 3, `${lo.toFixed(3)}-${hi.toFixed(3)} of the view behind the centre`);
}
{
  const { cam, car } = steadyCamera(SCREENS.portrait, 0);
  const s = { x: 0, y: 0 };
  projection.toScreen(car.x, car.y, 0, s);
  check('the car is behind the camera centre, not ahead of it', s.y > cam.p.y);
  check('at top speed the view is zoomed out to 0.90', Math.abs(cam.rig.zoom - T.CAMERA.zoomOut) < 0.005, `zoom ${cam.rig.zoom.toFixed(3)}`);
  const parked = new Camera(SCREENS.portrait);
  const still = carAt(3000, 3000, 0, 0);
  parked.snap(still);
  for (let t = 0; t < 2; t += 1 / 60) parked.follow(still, 1 / 60);
  check('a parked car has no zoom-out and no look-ahead', parked.rig.zoom === 1 && parked.rig.leadX === 0 && parked.rig.leadY === 0);
}
{
  // Hard circles: how fast does the view move across the screen, relative to the car?
  const cam = new Camera(SCREENS.portrait);
  const car = carAt(3000, 3000, 0, 300);
  cam.snap(car);
  let fastest = 0;
  let last = null;
  const s = { x: 0, y: 0 };
  for (let t = 0; t < 8; t += 1 / 60) {
    car.step(t % 4 < 2 ? 1 : -1, 1 / 60);
    cam.follow(car, 1 / 60);
    projection.toScreen(car.x - cam.rig.x, car.y - cam.rig.y, 0, s);
    if (last && t > 1) fastest = Math.max(fastest, Math.hypot(s.x - last.x, s.y - last.y) * 60);
    last = { x: s.x, y: s.y };
  }
  check('the car never whips across the screen in hard turns', fastest < 900, `${fastest.toFixed(0)} screen units/s at most`);
}
{
  const rig = new CameraRig();
  const still = carAt(0, 0, 0, 0);
  rig.addTrauma(0.5);
  rig.addTrauma(0.9);
  check('trauma is capped at 1', rig.trauma === 1);
  let peak = 0;
  for (let i = 0; i < 6; i += 1) {
    rig.update(still, 1 / 60, 450, 450);
    peak = Math.max(peak, Math.hypot(rig.shakeX, rig.shakeY));
  }
  const high = peak;
  const small = new CameraRig();
  small.addTrauma(0.3);
  peak = 0;
  for (let i = 0; i < 6; i += 1) {
    small.update(still, 1 / 60, 450, 450);
    peak = Math.max(peak, Math.hypot(small.shakeX, small.shakeY));
  }
  check('shake grows with trauma squared: a small knock is far gentler than a big hit', peak < high * 0.25 && peak > 0, `${peak.toFixed(1)} vs ${high.toFixed(1)} units`);
  for (let i = 0; i < 120; i += 1) rig.update(still, 1 / 60, 450, 450);
  check('shake dies away completely', rig.trauma === 0 && rig.shakeX === 0 && rig.shakeY === 0);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
