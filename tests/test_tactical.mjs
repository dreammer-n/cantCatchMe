// Checks for the tactical units: SWAT Bearcats, roadblocks with spike strips, the helicopter.
import { Camera, Car, ChaseSimulation, SCREENS, T, difficultyAt, fixedMap, isOnScreen, newSim, playRun, projection } from './simkit.mjs';
import { atlasLayout, measureCar } from '../src/render/carAtlas.js';
import { carMesh, BEARCAT_LIGHTS } from '../src/render/carModels.js';
import { projectMesh } from '../src/render/lowpoly.js';
import { Projection } from '../src/render/projection.js';
import * as props from '../src/render/propModels.js';
import { ThreatRadar } from '../src/systems/ThreatRadar.js';
import { nearestRoadPoint, propCatalogue } from '../src/systems/WorldLayout.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}
const { BEARCAT, FLAT_TIRE, HELICOPTER, ROADBLOCK, PALETTE, RENDER, GIANT } = T;
const handling = T.HANDLING_PRESETS.balanced;
const offView = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
const DEG = Math.PI / 180;

function quiet(items = []) {
  const s = new ChaseSimulation({ layout: fixedMap(items), handling });
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.spawner.nextSpikes = 1e6;
  s.powerUps.timer = 1e6;
  return s;
}
function run(s, seconds, input = {}) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) for (const e of s.step(1 / 60, { steer: 0, ...input }, offView)) events.push({ ...e });
  return events;
}
const drive = (s, x, y, heading = 0, speed = 300) => {
  s.player.reset(x, y, heading);
  s.player.launch(speed);
};
const truck = (s, x, y, heading = 0, launchShare = 0) => s.spawnPolice(x, y, heading, { role: 'bearcat', speedFactor: 1.05, turnDeg: BEARCAT.turnDeg, aimSide: 0, launchShare });
const cruiser = (s, x, y, heading = 0, launchShare = 0, turnDeg = 0) => s.spawnPolice(x, y, heading, { role: 'chaser', speedFactor: 1.1, turnDeg, aimSide: 0, launchShare });

// ---- The difficulty curve --------------------------------------------------------------------
{
  const at = difficultyAt;
  // The gentle start (owner, 2026-11-06).
  check('the first minute: patrol cruisers only', at(59.9).interceptorShare === 0 && at(59.9).bearcatShare === 0);
  check('1-2 minutes: interceptors, no Bearcats', at(60).interceptorShare > 0 && at(119.9).bearcatShare === 0);
  check('from 2 minutes: Bearcats', at(120).bearcatShare >= 0.1);
  check('roadblocks from 75 s', ROADBLOCK.firstAt === 75);
  check('from 2 minutes: the helicopter', HELICOPTER.firstAt === 120);
  check('and more Bearcats later on', at(240).bearcatShare > at(120).bearcatShare);
}

// ---- Drawing sheets -------------------------------------------------------------------------
{
  let widest = 0;
  for (const view of RENDER.views) {
    const pr = new Projection(view);
    for (const name of ['bearcat', 'helicopter', 'bearcatWreck']) {
      const layout = atlasLayout(measureCar(name.replace(/^player/, 'coupe'), pr));
      widest = Math.max(widest, layout.width, layout.height);
    }
  }
  check('the new drawing sheets fit older phones, in every camera view', widest <= 2048, `largest side ${widest} px`);
  const pr = new Projection(RENDER.views.find((v) => v.id === RENDER.defaultViewId));
  const mb = Object.keys(RENDER.carDirections).reduce((sum, name) => {
    const layout = atlasLayout(measureCar(name.replace(/^player/, 'coupe'), pr));
    return sum + (layout.width * layout.height * 4) / 1e6;
  }, 0);
  check('all the vehicle sheets stay within budget', mb < 27, `${mb.toFixed(1)} MB graphics memory`);
}

// ---- The Bearcat ------------------------------------------------------------------------------
{
  const mesh = carMesh('bearcat');
  const zs = mesh.flatMap((p) => p.verts.map((v) => v[2]));
  const carZ = carMesh('police').flatMap((p) => p.verts.map((v) => v[2]));
  check('the Bearcat is taller than a cruiser', Math.max(...zs) > Math.max(...carZ) * 1.3, `${Math.max(...zs)} vs ${Math.max(...carZ)}`);
  check('it has red and blue roof lights', mesh.some((p) => p.faces.some((f) => f.decals.some((d) => d.color === PALETTE.lightRed))) && mesh.some((p) => p.faces.some((f) => f.decals.some((d) => d.color === PALETTE.lightBlue))));
  check('its lights sit on its roof', BEARCAT_LIGHTS.topZ >= Math.max(...zs) - 3);
  check('it can be seen from every side', Array.from({ length: 16 }, (_, i) => projectMesh(mesh, (i * Math.PI) / 8, projection).some((p) => p.faces.length > 0)).every(Boolean));
  const lum = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
  check('dark grey, but it stands out from the road', lum(PALETTE.swatBody) > lum(PALETTE.asphalt) * 1.5 && Math.abs(((PALETTE.swatBody >> 16) & 255) - (PALETTE.swatBody & 255)) < 30);
  check('it is drawn with fewer directions than a car, to save memory', RENDER.carDirections.bearcat <= 32);

  const s = quiet();
  drive(s, 3000, 3000);
  const b = truck(s, 2000, 3000);
  check('it is heavy and big', b.model.mass === BEARCAT.mass && b.model.scale === BEARCAT.scale && b.armored);
  check('its turn rate is slower than any cruiser\'s', BEARCAT.turnDeg < T.HEAT.turnDeg[0][1]);
  s.removePolice(b, 'despawn');
  const c = cruiser(s, 2000, 3000);
  check('a cruiser spawned after it is back to normal', c.model.mass === 1 && c.model.scale === 1 && !c.model.plowing && c.handling.acceleration === T.POLICE_HANDLING.acceleration);
}
{
  // Contact is fatal.
  const hit = (place) => {
    const s = quiet();
    drive(s, 3000, 3000);
    const b = place(s);
    b.handling.maxTurnRateDeg = 0;
    run(s, 1.5);
    return s;
  };
  const head = hit((s) => truck(s, 3000, 2600, Math.PI, 1));
  check('head-on with a Bearcat is fatal', head.state === 'crashed' && head.crash.cause === 'bearcat', head.crash && head.crash.cause);
  const side = hit((s) => truck(s, 2750, 2850, 90 * DEG, 1));
  check('so is being hit from the side', side.state === 'crashed' && side.crash.cause === 'bearcat', side.crash && side.crash.cause);
  // Far gentler than a cruiser needs to be.
  const gentle = quiet();
  drive(gentle, 3000, 3000);
  gentle.player.launch(80);
  const parked = truck(gentle, 3000, 2870);
  parked.handling.maxTurnRateDeg = 0;
  parked.handling.acceleration = 0;
  run(gentle, 0.8);
  const soft = quiet();
  drive(soft, 3000, 3000, 0, 80);
  const softCar = cruiser(soft, 3000, 2870);
  softCar.handling.maxTurnRateDeg = 0;
  softCar.handling.acceleration = 0;
  run(soft, 0.8);
  check('even a knock a cruiser would shrug off is fatal', gentle.state === 'crashed' && gentle.crash.cause === 'bearcat' && soft.state === 'running', `${gentle.state}, against ${soft.state}`);
  // A light brush at nearly matching speed isn't.
  const brush = quiet();
  drive(brush, 3000, 3000);
  const along = truck(brush, 3056, 3000, 0, 1);
  along.handling.maxTurnRateDeg = 0;
  along.model.vx = -10;
  along.model.vy = brush.player.vy;
  run(brush, 2 / 60);
  check('a light brush side by side is survivable', brush.state === 'running', brush.state);
}
{
  // Can't be pushed about.
  const s = quiet();
  drive(s, 3000, 3000, 0, 300);
  const b = truck(s, 3000, 2850, 0);
  b.handling.maxTurnRateDeg = 0;
  b.handling.acceleration = 0;
  run(s, 0.5);
  const shove = Math.hypot(b.model.vx, b.model.vy);
  check('the player hardly shifts it', shove < 120, `${shove.toFixed(0)} units/s from a full-speed hit`);
  const c = quiet();
  drive(c, 3000, 3000, 0, 300);
  const car = cruiser(c, 3000, 2850);
  car.handling.maxTurnRateDeg = 0;
  car.handling.acceleration = 0;
  run(c, 0.5);
  const knocked = Math.hypot(car.model.vx, car.model.vy);
  check('a cruiser, in comparison, gets knocked flying', knocked > shove * 2, `${knocked.toFixed(0)} units/s against ${shove.toFixed(0)}`);
}
{
  // Plows through light props without slowing.
  const lamp = { kind: 'lamp', x: 1000, y: 2200, heading: 0, model: 'l', params: {}, collider: { type: 'circle', r: 7 }, breakable: true };
  const cone = { kind: 'cone', x: 1000, y: 2000, heading: 0, model: 'c', params: {}, collider: { type: 'circle', r: 11 }, breakable: true };
  const parked = { kind: 'civilian', x: 1000, y: 1800, heading: 0, model: 'p', params: {}, collider: { type: 'box', hw: 22, hl: 42 }, breakable: true };
  const curb = { kind: 'island', x: 1000, y: 1600, heading: 90 * DEG, model: 'i', params: { length: 400 }, collider: { type: 'box', hw: 35, hl: 200 }, breakable: false, curb: true };
  const s = quiet([lamp, cone, parked, curb]);
  drive(s, 2600, 2600);
  const b = truck(s, 1000, 2400, 0, 1);
  b.handling.maxTurnRateDeg = 0;
  let slowest = Infinity;
  for (let t = 0; t < 3; t += 1 / 60) {
    s.player.x = 2600;
    s.player.y = 2600;
    s.step(1 / 60, { steer: 0 }, offView);
    slowest = Math.min(slowest, b.model.speed);
  }
  check('a Bearcat ploughs through lamps, cones, parked cars and curbs without slowing', slowest > b.handling.topSpeed - 5 && b.model.y < 1500, `slowest ${slowest.toFixed(0)}, top ${b.handling.topSpeed.toFixed(0)}, y ${b.model.y.toFixed(0)}`);
  check('and they go flying', s.cones.every((c) => c.state !== 'standing'));
  check('still in one piece', b.alive);
}
{
  // But solid things and other cars matter.
  const block = { kind: 'block', x: 1000, y: 1000, heading: 0, model: 'b', params: {}, collider: { type: 'box', hw: 60, hl: 60 }, breakable: false };
  const s = quiet([block]);
  drive(s, 2600, 2600);
  const b = truck(s, 1000, 1400, 0, 1);
  b.handling.maxTurnRateDeg = 0;
  const head = run(s, 1.6);
  check('a full-speed crash into something solid wrecks it', b.state === 'wreck' && head.some((e) => e.type === 'explosion'), b.state);
  const glance = quiet([block]);
  drive(glance, 2600, 2600);
  const g = truck(glance, 1000 - 60 - 60, 1200, 40 * DEG, 0.5);
  g.handling.maxTurnRateDeg = 0;
  run(glance, 1);
  check('a slower knock just bounces it off', g.alive, g.state);

  const c = quiet();
  drive(c, 3000, 3000);
  const t2 = truck(c, 1000, 1000, 0, 0);
  const small = cruiser(c, 1000, 1300, 0, 1);
  small.handling.maxTurnRateDeg = 0;
  t2.handling.maxTurnRateDeg = 0;
  t2.handling.acceleration = 0;
  run(c, 1.4);
  check('a cruiser that rams it is wrecked, and it isn\'t', small.state !== 'chasing' && t2.alive, `${small.state}, ${t2.state}`);

  const blast = quiet();
  drive(blast, 3000, 3000);
  const t3 = truck(blast, 1000, 1000);
  const near = cruiser(blast, 1000, 1200);
  blast.wreckPolice(near, 'obstacle');
  t3.model.x = near.model.x + 40;
  t3.model.y = near.model.y;
  blast.runExplosions();
  check('nearby explosions don\'t wreck it', t3.alive);
}
{
  // The power-ups still work.
  const g = quiet();
  drive(g, 3000, 3000);
  g.powerUps.give('giant');
  g.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  run(g, 0.8);
  const b = truck(g, g.player.x, g.player.y - 300, Math.PI, 1);
  b.handling.maxTurnRateDeg = 0;
  run(g, 0.8);
  check('a Giant car crushes a Bearcat, and survives', b.state === 'wreck' && g.state === 'running', `${b.state}, ${g.state}`);
  const f = quiet();
  drive(f, 3000, 3000);
  const b2 = truck(f, 3200, 3000, 0, 1);
  f.powerUps.give('freeze');
  f.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  check('Freeze stops one', b2.frozen > 0);
  // Frozen, it breaks like any other frozen car.
  const ice = quiet();
  drive(ice, 3000, 3000);
  const iced = truck(ice, 3000, 2750);
  iced.freeze(T.FREEZE.seconds);
  iced.handling.maxTurnRateDeg = 0;
  run(ice, 1);
  check('the player smashes through a frozen one too', ice.state === 'running' && !iced.active, `${ice.state}, ${iced.state}`);
  run(f, T.FREEZE.seconds + 0.2);
  check('and it thaws just as heavy as it was', b2.frozen === 0 && b2.model.mass === BEARCAT.mass, `${b2.model.mass}`);
  const w = quiet();
  drive(w, 3000, 3000);
  const b3 = truck(w, 3100, 3100);
  w.powerUps.give('shockwave');
  w.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  check('a Shockwave wrecks one', b3.state === 'wreck');
}
{
  // Arrows and the sweep.
  const s = quiet();
  drive(s, 1000, 1000);
  const c = projection.toScreen(1000, 1000, 0);
  const view = { cx: c.x, cy: c.y, halfW: 450, halfH: 800 };
  truck(s, 1000 - 1400, 1000 - 400, 90 * DEG, 1);
  const radar = new ThreatRadar();
  for (let t = 0; t < 0.5; t += 1 / 60) radar.update(s, view, 1 / 60);
  check('a Bearcat closing in gets a warning arrow', radar.threats.length === 1);
  // A Giant player reaches further: a Bearcat that near has to be found by the collision sweep.
  const g = quiet();
  drive(g, 3000, 3000);
  g.player.scale = GIANT.scale;
  g.player.crushing = true;
  const reach = 42 * GIANT.scale + 42 * BEARCAT.scale - 4;
  const b = truck(g, 3000, 3000 - reach);
  run(g, 1 / 60);
  check('the sweep finds contact at the largest sizes there are', b.state === 'wreck', b.state);
}

// ---- Roadblocks and spikes -------------------------------------------------------------------
function roadblockSim() {
  const s = quiet();
  drive(s, 3000, 3000);
  s.time = 40;
  const cam = new Camera(SCREENS.landscape);
  cam.snap(s.player);
  let view = cam.view;
  for (let i = 0; i < 120; i += 1) view = cam.follow(s.player, 1 / 60);
  s.chunks.update(s.player.x, s.player.y);
  const placed = s.spawner.tryRoadblock(s, view);
  return { s, placed, view };
}
{
  const { s, placed, view } = roadblockSim();
  const cars = s.police.filter((p) => p.active);
  const strip = s.spikeStrips.find((k) => k.active);
  check('a roadblock has two parked cruisers and a spike strip', placed && cars.length === 2 && cars.every((p) => p.parked) && strip);
  const midX = (cars[0].model.x + cars[1].model.x) / 2;
  const midY = (cars[0].model.y + cars[1].model.y) / 2;
  check('the strip lies in the gap between them', Math.abs(strip.x - midX) < 1 && Math.abs(strip.y - midY) < 1);
  check('out of sight when placed', !isOnScreen(strip.x, strip.y, view, 0));
  const gap = ROADBLOCK.spacing - 84 * Math.cos(ROADBLOCK.angleDeg * DEG);
  check('wide enough to drive through (and regret it)', gap > 44, `${gap.toFixed(0)} gap for a car 44 wide`);
  check('the strip reaches right across that gap', ROADBLOCK.spikeHalfLength * 2 >= gap);
  check('it has a model, drawn at startup', propCatalogue().filter((e) => e.kind === 'spikes').length === 2 && props.spikeStrip().length > 5);
}
{
  // Driving over it.
  const { s } = roadblockSim();
  const strip = s.spikeStrips.find((k) => k.active);
  for (const p of s.police) if (p.active) s.removePolice(p, 'despawn');
  drive(s, strip.x, strip.y + 150);
  const events = run(s, 0.8);
  check('driving over the spikes gives a flat tire', events.some((e) => e.type === 'flat') && s.player.flatTime > 0, `${s.player.flatTime.toFixed(2)} s left`);
  check('and is no crash', s.state === 'running');
  check('just the once per crossing', events.filter((e) => e.type === 'flat').length === 1);
}
{
  // What a flat tire does.
  const top = handling.topSpeed;
  const make = (side, speed = top) => {
    const c = new Car(handling);
    c.reset(0, 0, 0);
    c.launch(speed);
    if (side) c.puncture(FLAT_TIRE.seconds, side);
    return c;
  };
  const ease = (car, seconds, steer = 0) => {
    for (let t = 0; t < seconds; t += 1 / 60) car.stepFor(steer, 1 / 60, 1 / 120);
  };
  const turnOf = (car) => car.heading;

  // Power.
  const ok = make(0, 100);
  const bad = make(1, 100);
  ease(ok, 0.5);
  ease(bad, 0.5);
  check('acceleration collapses', bad.forwardSpeed < ok.forwardSpeed - 50, `${bad.forwardSpeed.toFixed(0)} vs ${ok.forwardSpeed.toFixed(0)}`);

  // The jolt, to the flat side.
  for (const side of [-1, 1]) {
    const c = make(side);
    ease(c, 0.15);
    check(`it jolts toward the flat corner (${side < 0 ? 'left' : 'right'})`, Math.sign(c.heading) === side, `${(c.heading / DEG).toFixed(0)} deg`);
  }
  const mirrorL = make(-1);
  const mirrorR = make(1);
  ease(mirrorL, 2);
  ease(mirrorR, 2);
  check('left and right behave the same, mirrored', Math.abs(mirrorL.heading + mirrorR.heading) < 0.02);

  // Hands off the wheel, for the whole 3 seconds.
  const a = make(1);
  let turned = 0;
  let last = a.heading;
  let peakDrift = 0;
  let awayFromFlat = 0;
  let biggestDrop = 0;
  let lastSpeed = a.speed;
  let at02 = 0;
  let slowest = Infinity;
  for (let t = 0; t < FLAT_TIRE.seconds; t += 1 / 60) {
    a.stepFor(0, 1 / 60, 1 / 120);
    const change = Math.atan2(Math.sin(a.heading - last), Math.cos(a.heading - last));
    last = a.heading;
    turned += change;
    if (change < -0.0005) awayFromFlat += 1;
    peakDrift = Math.max(peakDrift, a.driftAngleDeg);
    biggestDrop = Math.max(biggestDrop, lastSpeed - a.speed);
    lastSpeed = a.speed;
    slowest = Math.min(slowest, a.speed);
    if (t < 0.2) at02 = a.speed;
  }
  const hands = (turned * 180) / Math.PI;
  check('it pulls the same way the whole time, never swinging back', awayFromFlat === 0, `${awayFromFlat} frames the other way`);
  check('hands off, it curves steadily toward the flat corner', hands > 90 && hands < 300, `${hands.toFixed(0)} deg over 3 s`);
  check('it never spins right round', Math.abs(hands) < 360);
  check('the tail slides out, without the car going sideways', peakDrift > 10 && peakDrift < 55, `${peakDrift.toFixed(0)} deg of drift at most`);
  check('speed bleeds away gradually, with no sudden stop', at02 > top * 0.82 && biggestDrop < top * 0.04, `${at02.toFixed(0)} after 0.2 s, biggest loss in a frame ${biggestDrop.toFixed(1)}`);
  check('it slows right down, but keeps rolling', slowest < top * 0.75 && slowest > top * 0.35, `slowest ${slowest.toFixed(0)} of ${top}`);

  // Fighting it at the wheel.
  const fight = make(1);
  ease(fight, 2);
  const free = make(1);
  ease(free, 2);
  const fought = make(1);
  ease(fought, 2, -1);
  const into = make(1);
  ease(into, 1, 1);
  const freeOneSecond = make(1);
  ease(freeOneSecond, 1);
  const normal = make(0);
  ease(normal, 2, -1);
  const freeTurn = Math.abs(turnOf(free));
  check('steering against it nearly holds it straight', Math.abs(turnOf(fought)) < freeTurn * 0.45, `${(Math.abs(turnOf(fought)) / DEG).toFixed(0)} deg, against ${(freeTurn / DEG).toFixed(0)} deg hands off`);
  check('turning into it is sharper still', Math.abs(into.heading) > Math.abs(freeOneSecond.heading) * 1.3, `${(Math.abs(into.heading) / DEG).toFixed(0)} deg in a second, against ${(Math.abs(freeOneSecond.heading) / DEG).toFixed(0)}`);

  // It comes back smoothly.
  const end = make(1);
  ease(end, FLAT_TIRE.seconds - FLAT_TIRE.releaseSeconds - 0.05);
  check('still fully flat until near the end', end.flatness === 1, `${end.flatness.toFixed(2)}`);
  let jump = 0;
  let previous = end.speed;
  let previousFlat = end.flatness;
  let biggestFlatStep = 0;
  for (let t = 0; t < FLAT_TIRE.releaseSeconds + 0.3; t += 1 / 60) {
    end.stepFor(0, 1 / 60, 1 / 120);
    jump = Math.max(jump, Math.abs(end.speed - previous));
    biggestFlatStep = Math.max(biggestFlatStep, Math.abs(end.flatness - previousFlat));
    previous = end.speed;
    previousFlat = end.flatness;
  }
  check('grip and power return gradually, not all at once', biggestFlatStep < 0.05 && jump <= (handling.acceleration / 60) * 1.05, `biggest change in a frame: ${(biggestFlatStep * 100).toFixed(0)}% flatness, ${jump.toFixed(1)} speed`);
  check('after 3 seconds it is over', end.flatTime === 0 && end.flatness === 0);
  ease(end, 2.5);
  check('and the car gets back up to speed', end.speed > top * 0.93, `${end.speed.toFixed(0)} of ${top}`);

  // Frame rate.
  const slow = make(1);
  const fast = make(1);
  for (let t = 0; t < 2; t += 1 / 30) slow.stepFor(0, 1 / 30, 1 / 120);
  for (let t = 0; t < 2; t += 1 / 120) fast.stepFor(0, 1 / 120, 1 / 120);
  check('it behaves the same at any frame rate', Math.abs(slow.heading - fast.heading) < 0.08, `${(Math.abs(slow.heading - fast.heading) / DEG).toFixed(1)} deg apart`);
}
{
  // Who else it affects.
  const { s } = roadblockSim();
  const strip = s.spikeStrips.find((k) => k.active);
  for (const p of s.police) if (p.active) s.removePolice(p, 'despawn');
  drive(s, 2600, 2600);
  const c = cruiser(s, strip.x, strip.y + 150, 0, 1);
  c.handling.maxTurnRateDeg = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    s.player.x = 2600;
    s.player.y = 2600;
    s.step(1 / 60, { steer: 0 }, offView);
  }
  check('police know where their own spikes are', c.model.flatTime === 0 && c.alive);
  // Giant.
  const g = roadblockSim().s;
  const st = g.spikeStrips.find((k) => k.active);
  for (const p of g.police) if (p.active) g.removePolice(p, 'despawn');
  drive(g, st.x, st.y + 150);
  g.player.scale = 2;
  g.player.scaleTarget = 2;
  g.player.crushing = true;
  run(g, 0.6);
  check('a Giant car doesn\'t notice', g.player.flatTime === 0);
  // Using Giant mends them.
  const m = quiet();
  drive(m, 3000, 3000);
  m.player.puncture(3, 1);
  m.powerUps.give('giant');
  m.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  check('turning Giant mends a flat', m.player.flatTime === 0);
  // Tidying up.
  const t = roadblockSim();
  const shapes = t.s.world.shapes.length;
  const old = t.s.spikeStrips.find((k) => k.active);
  old.time = ROADBLOCK.spikeSeconds + 1;
  run(t.s, 2 / 60);
  check('strips are cleared away after a while', !old.active && t.s.world.shapes.length === shapes - 1);
  const r = roadblockSim().s;
  r.reset(9);
  check('a new run has none', r.spikeStrips.every((k) => !k.active && !k.shape));
  // Isn't a barrier: spawns and chunks don't care.
  check('a strip doesn\'t count as blocking the road', (() => {
    const q = roadblockSim().s;
    const k = q.spikeStrips.find((x) => x.active);
    return q.world.isClear(k.x, k.y, 5);
  })());
}

// ---- The helicopter ---------------------------------------------------------------------------
{
  const mesh = carMesh('helicopter');
  check('the helicopter has a model, with a tail', Math.min(...mesh.flatMap((p) => p.verts.map((v) => v[1]))) < -50);
  const s = quiet();
  drive(s, 3000, 3000);
  s.time = HELICOPTER.firstAt - 0.5;
  const before = run(s, 0.3);
  check('no helicopter before 2 minutes', !s.helicopter.active && !before.some((e) => e.type === 'helicopter'));
  const on = run(s, 0.4);
  check('it arrives at 2 minutes', s.helicopter.active && on.filter((e) => e.type === 'helicopter').length === 1);
  check('from out of sight', Math.hypot(s.helicopter.x - s.player.x, s.helicopter.y - s.player.y) > 1000);
  const start = Math.hypot(s.helicopter.x - s.player.x, s.helicopter.y - s.player.y);
  s.helicopter.nextDrop = 1e6;
  let closest = Infinity;
  for (let t = 0; t < 10; t += 1 / 60) {
    s.step(1 / 60, { steer: 0 }, offView);
    closest = Math.min(closest, Math.hypot(s.helicopter.x - s.player.x, s.helicopter.y - s.player.y));
  }
  check('it catches up and stays overhead', closest < start / 3 && Math.hypot(s.helicopter.x - s.player.x, s.helicopter.y - s.player.y) < 700, `${start.toFixed(0)} -> ${Math.hypot(s.helicopter.x - s.player.x, s.helicopter.y - s.player.y).toFixed(0)} units`);
  check('flying at height', s.helicopter.z > HELICOPTER.height - 30, `${s.helicopter.z.toFixed(0)}`);
  check('the searchlight stays close to the car', Math.hypot(s.helicopter.spotX - s.player.x, s.helicopter.spotY - s.player.y) < 100, `${Math.hypot(s.helicopter.spotX - s.player.x, s.helicopter.spotY - s.player.y).toFixed(0)} units`);
  const moved = { x: s.helicopter.x, y: s.helicopter.y };
  const h0 = s.helicopter.heading;
  drive(s, s.player.x, s.player.y, 90 * DEG);
  run(s, 3);
  check('it follows when the car turns', Math.hypot(s.helicopter.x - moved.x, s.helicopter.y - moved.y) > 300 && s.helicopter.heading !== h0);
  check('nothing can touch it', s.helicopter.active && s.state === 'running');
}
{
  // Drops: a flare first, somewhere in or beside the car's path, never the same twice.
  const s = quiet();
  drive(s, 3000, 3000);
  s.time = HELICOPTER.firstAt;
  s.helicopter.arrive(s);
  s.helicopter.nextDrop = 0;
  const p0 = { x: s.player.x, y: s.player.y };
  const shapes = s.world.shapes.length;
  const first = run(s, 1 / 60);
  s.helicopter.nextDrop = 1e6;
  const drop = s.helicopter.drops.find((d) => d.active);
  check('it marks a spot with a flare', drop && drop.state === 'warning' && first.some((e) => e.type === 'flare'));
  const ahead = p0.y - drop.y;
  const aside = Math.abs(drop.x - p0.x);
  check('ahead of the car, in or beside its path', ahead > 300 * HELICOPTER.aheadSeconds[0] - 30 && ahead < 300 * HELICOPTER.aheadSeconds[1] + 30 && aside <= HELICOPTER.sideOffset[1] + 5, `${ahead.toFixed(0)} ahead, ${aside.toFixed(0)} aside`);
  check('there is nothing solid there yet', s.world.shapes.length === shapes);
  check('the warning leaves time to steer round it', ahead / 300 > drop.warning, `${(ahead / 300).toFixed(1)} s to get there, ${drop.warning.toFixed(2)} s of warning`);
  const before = s.helicopter.z;
  run(s, 0.6);
  check('it swoops down to drop it', s.helicopter.z < before - 40, `${before.toFixed(0)} -> ${s.helicopter.z.toFixed(0)}`);

  // Unpredictable: spot, side, angle, warning and what falls all vary.
  const u = quiet();
  drive(u, 3000, 3000);
  u.time = HELICOPTER.firstAt;
  u.helicopter.arrive(u);
  const sides = [];
  const turns = [];
  const warnings = [];
  const kinds = new Set();
  for (let i = 0; i < 60; i += 1) {
    if (!u.helicopter.tryDrop(u)) continue;
    const d = u.helicopter.drops.find((x) => x.active);
    sides.push(d.x - u.player.x);
    turns.push(d.heading - u.player.heading);
    warnings.push(d.warning);
    kinds.add(d.kind);
    u.helicopter.clearDrop(u, d);
  }
  check('some drops land right in the path, some to either side', sides.some((x) => Math.abs(x) < 1) && sides.some((x) => x < -30) && sides.some((x) => x > 30), `${sides.length} drops`);
  check('at different angles', Math.max(...turns) - Math.min(...turns) > 0.3 && turns.every((t) => Math.abs(t) <= (HELICOPTER.angleJitterDeg * Math.PI) / 180 + 1e-9));
  check('with different warnings, never under the shortest', Math.max(...warnings) - Math.min(...warnings) > 0.2 && warnings.every((w) => w >= HELICOPTER.warningSeconds[0] && w <= HELICOPTER.warningSeconds[1]));
  check('spike strips and traffic barrels both fall', kinds.has('spikes') && kinds.has('barrels'), [...kinds].join(' '));
}
{
  // A spike strip: lands as a real strip, at the angle it was dropped at.
  const s = quiet();
  drive(s, 3000, 3000);
  s.time = HELICOPTER.firstAt;
  s.helicopter.arrive(s);
  s.helicopter.nextDrop = 0;
  run(s, 1 / 60);
  s.helicopter.nextDrop = 1e6;
  const drop = s.helicopter.drops.find((d) => d.active);
  drop.kind = 'spikes';
  drop.x = s.player.x;
  const heading = drop.heading;
  const landing = run(s, drop.warning + 0.5);
  const strip = s.spikeStrips.find((x) => x.active);
  check('spikes land as a spike strip', landing.some((e) => e.type === 'dropLand' && e.kind === 'spikes') && strip && !drop.active);
  check('at the angle it fell', strip && Math.abs(strip.heading - heading) < 1e-9);
  const flat = [...landing, ...run(s, 2)];
  check('drive straight on and you get a flat tire', flat.some((e) => e.type === 'flat') && s.state === 'running', s.state);

  // Traffic barrels: a row across the road, knocked flying, and they cost speed.
  const b = quiet();
  drive(b, 3000, 3000);
  b.time = HELICOPTER.firstAt;
  b.helicopter.arrive(b);
  b.helicopter.nextDrop = 0;
  run(b, 1 / 60);
  b.helicopter.nextDrop = 1e6;
  const bd = b.helicopter.drops.find((d) => d.active);
  bd.kind = 'barrels';
  bd.x = b.player.x;
  bd.heading = 0.2; // across a road running north
  const shapes = b.world.shapes.length;
  drive(b, bd.x + 900, bd.y, 0);
  b.player.handling = { ...b.player.handling, maxTurnRateDeg: 0 };
  run(b, bd.warning - bd.time + 0.05);
  check('barrels land as a row', bd.state === 'down' && b.world.shapes.length === shapes + HELICOPTER.barrels);
  check('they block the road', bd.barrels.every((x) => x.shape && b.world.shapes.includes(x.shape)));
  const spread = Math.hypot(bd.barrels[0].x - bd.barrels[2].x, bd.barrels[0].y - bd.barrels[2].y);
  check('across a lane, side by side', spread > HELICOPTER.barrelSpacing * 1.5, `${spread.toFixed(0)} units`);
  const middle = bd.barrels[1];
  drive(b, middle.x, middle.y + 250, 0, 300);
  const speedBefore = b.player.speed;
  const startY = b.player.y;
  const hit = run(b, 1.2);
  check('driving into one knocks it flying', hit.some((e) => e.type === 'barrelHit' && e.player) && middle.hit && !middle.shape);
  check('and costs some speed, but no crash', b.state === 'running', `${speedBefore.toFixed(0)}, ${b.state}`);
  const slowed = quiet();
  drive(slowed, 3000, 3000, 0, 300);
  run(slowed, 1.2);
  check('slower than without the barrel', startY - b.player.y < 3000 - slowed.player.y - 10, `${(startY - b.player.y).toFixed(0)} against ${(3000 - slowed.player.y).toFixed(0)} units`);
  run(b, HELICOPTER.barrelSeconds);
  check('and after a while they are gone', !bd.active && b.world.shapes.length === shapes);

  // Police knock them aside too.
  const q = quiet();
  drive(q, 3000, 3000);
  q.time = HELICOPTER.firstAt;
  q.helicopter.arrive(q);
  q.helicopter.nextDrop = 0;
  run(q, 1 / 60);
  q.helicopter.nextDrop = 1e6;
  const qd = q.helicopter.drops.find((d) => d.active);
  qd.kind = 'barrels';
  qd.heading = 0;
  drive(q, qd.x + 900, qd.y, 0);
  run(q, qd.warning - qd.time + 0.05);
  drive(q, qd.x + 900, qd.y - 1500, 0);
  const cop = cruiser(q, qd.barrels[1].x, qd.barrels[1].y + 250, 0, 1);
  cop.model.handling = { ...cop.model.handling, maxTurnRateDeg: 0 };
  const copHit = run(q, 1.2);
  check('police knock them aside too, and drive on', copHit.some((e) => e.type === 'barrelHit' && !e.player) && cop.alive, cop.state);
}
{
  // Fair: nothing lands on you.
  const s = quiet();
  drive(s, 3000, 3000);
  s.time = HELICOPTER.firstAt;
  s.helicopter.arrive(s);
  s.helicopter.nextDrop = 0;
  s.step(1 / 60, { steer: 0 }, offView);
  s.helicopter.nextDrop = 1e6;
  const drop = s.helicopter.drops.find((d) => d.active);
  const shapes = s.world.shapes.length;
  drive(s, drop.x + 200, drop.y, -90 * DEG, 300);
  for (let t = 0; t < HELICOPTER.warningSeconds[1] + 0.1; t += 1 / 60) {
    s.player.x = drop.x + 5;
    s.player.y = drop.y;
    s.player.vx = 0;
    s.player.vy = 0;
    s.pinnedTime = 0; // standing still here is the test, not being boxed in
    s.step(1 / 60, { steer: 0 }, offView);
  }
  check('a drop never lands on the car', s.state === 'running' && s.world.shapes.length === shapes && !drop.active && !s.spikeStrips.some((x) => x.active), s.state);

  // Nothing is left over.
  const n = quiet();
  drive(n, 3000, 3000);
  n.time = HELICOPTER.firstAt;
  n.helicopter.arrive(n);
  n.helicopter.nextDrop = 0;
  run(n, 1 / 60);
  n.helicopter.drops.find((x) => x.active).kind = 'barrels';
  n.helicopter.nextDrop = 1e6;
  run(n, HELICOPTER.warningSeconds[1] + 0.2);
  n.reset(4);
  check('a new run has no helicopter and nothing it dropped', !n.helicopter.active && n.helicopter.drops.every((x) => !x.active && x.barrels.every((k) => !k.shape)));
  n.time = HELICOPTER.firstAt - 1;
  run(n, 0.1);
  check('and it comes back only at 2 minutes', !n.helicopter.active);
  // Nothing aimed at a hole.
  const hole = { kind: 'void', isVoid: true, x: 3000, y: 3000 - 525, heading: 0, collider: { type: 'circle', r: 400 }, breakable: false, outline: [] };
  const v = quiet([hole]);
  drive(v, 3000, 3000);
  v.time = HELICOPTER.firstAt;
  v.helicopter.arrive(v);
  v.helicopter.nextDrop = 0;
  run(v, 1 / 60);
  check('it won\'t aim at a hole', v.helicopter.drops.every((x) => !x.active));
}
{
  // Getting rid of it: it runs out of fuel...
  const f = quiet();
  drive(f, 3000, 3000);
  f.time = HELICOPTER.firstAt;
  f.helicopter.arrive(f);
  check('it stays 35 to 50 s', f.helicopter.stay >= HELICOPTER.stayMin && f.helicopter.stay <= HELICOPTER.stayMax, `${f.helicopter.stay.toFixed(1)} s`);
  f.helicopter.nextDrop = 1e6;
  f.helicopter.stay = 0.1;
  const fuel = run(f, 0.2);
  check('then runs out of fuel and leaves', f.helicopter.state === 'leaving' && fuel.some((e) => e.type === 'helicopterLeaves' && e.reason === 'fuel'));
  const climb = f.helicopter.z;
  run(f, 1);
  check('climbing away', f.helicopter.z > climb + 100);
  run(f, HELICOPTER.leaveSeconds);
  check('and is gone', !f.helicopter.active);
  const back = f.helicopter.nextArrival - f.time;
  check('another comes 30 to 50 s later', back >= HELICOPTER.returnMin - 4 && back <= HELICOPTER.returnMax, `${back.toFixed(1)} s`);
  f.time = f.helicopter.nextArrival - 0.05;
  const again = run(f, 0.1);
  check('and it does', f.helicopter.active && again.some((e) => e.type === 'helicopter'));

  // ... it loses you under cover ...
  const c = quiet();
  drive(c, 3000, 3000);
  c.time = HELICOPTER.firstAt;
  c.helicopter.arrive(c);
  c.helicopter.nextDrop = 1e6;
  c.playerUnderCover = () => true;
  run(c, HELICOPTER.loseSeconds - 0.4);
  check('a moment under cover is not enough', c.helicopter.state === 'chasing');
  const lost = run(c, 0.8);
  check('2 s under cover and it loses you', c.helicopter.state === 'leaving' && lost.some((e) => e.type === 'helicopterLeaves' && e.reason === 'lost'));
  const trees = [[3400, 3000], [3440, 3030], [3360, 3040]].map(([x, y]) => ({ kind: 'tree', x, y, heading: 0, model: 'tree', params: {}, collider: { type: 'circle', r: 12 }, breakable: false }));
  const canopy = { kind: 'canopy', x: 3000, y: 3500, heading: 0, model: 'canopy', params: {}, band: 'overhead' };
  const w = quiet([...trees, canopy]);
  drive(w, 3000, 3000);
  run(w, 1 / 60);
  const at = (x, y) => {
    w.player.x = x;
    w.player.y = y;
    return w.playerUnderCover();
  };
  check('cover: thick trees, a gas station roof; not open road', at(3400, 3030) && at(3010, 3500) && !at(3000, 3000) && !at(3200, 3000));

  // ... PHANTOM or DECOY makes it lose you ...
  for (const kind of ['phantom', 'decoy']) {
    const g = quiet();
    drive(g, 3000, 3000);
    g.time = HELICOPTER.firstAt;
    g.helicopter.arrive(g);
    g.helicopter.nextDrop = 1e6;
    run(g, 1);
    g.powerUps.give(kind);
    const used = [...g.step(1 / 60, { steer: 0, activatePowerUp: true }, offView), ...run(g, 0.2)];
    check(`${kind.toUpperCase()}: it loses you`, used.some((e) => e.type === 'helicopterLeaves' && e.reason === 'lost'));
  }

  // ... and BLACKOUT close by brings it down.
  const k = quiet();
  drive(k, 3000, 3000);
  k.time = HELICOPTER.firstAt;
  k.helicopter.arrive(k);
  k.helicopter.nextDrop = 1e6;
  run(k, 8);
  check('it is close overhead', Math.hypot(k.helicopter.x - k.player.x, k.helicopter.y - k.player.y) < T.BLACKOUT.radius * HELICOPTER.blackoutReach);
  k.powerUps.give('blackout');
  const hit = [...k.step(1 / 60, { steer: 0, activatePowerUp: true }, offView)];
  check('BLACKOUT knocks it out of the sky', k.helicopter.state === 'falling' && hit.some((e) => e.type === 'helicopterHit'));
  const z0 = k.helicopter.z;
  const h0 = k.helicopter.heading;
  run(k, HELICOPTER.fallSeconds * 0.5);
  check('it spins down', k.helicopter.z < z0 && k.helicopter.heading !== h0);
  run(k, HELICOPTER.fallSeconds * 0.5 - 0.05);
  const cop = cruiser(k, k.helicopter.x + 30, k.helicopter.y, 0, 0);
  const far = cruiser(k, k.helicopter.x + 900, k.helicopter.y, 0, 0);
  const wrecksBefore = k.stats.wrecks;
  const crash = run(k, 0.2);
  check('and crashes in a blast', crash.some((e) => e.type === 'helicopterDown') && !k.helicopter.active);
  check('wrecking police close by, not far off', !cop.alive && far.alive, `${cop.state} / ${far.state}`);
  check('it counts as a wreck, besides the police it took with it', k.stats.wrecks >= wrecksBefore + 2, `${wrecksBefore} -> ${k.stats.wrecks}`);
  check('the player is unharmed', k.state === 'running');
  const away = quiet();
  drive(away, 3000, 3000);
  away.time = HELICOPTER.firstAt;
  away.helicopter.arrive(away);
  away.helicopter.nextDrop = 1e6;
  away.powerUps.give('blackout');
  away.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  check('out of BLACKOUT\'s reach it flies on', away.helicopter.state === 'chasing');
}
{
  // Loose spike strips: on a road ahead, out of sight, at odd spots and angles.
  const sim = newSim();
  sim.reset(11);
  check('loose spikes from 60 s', sim.spawner.nextSpikes === T.LOOSE_SPIKES.firstAt);
  sim.setPace({ hard: true });
  sim.reset(11);
  check('or 30 s with HARD START', sim.spawner.nextSpikes === T.LOOSE_SPIKES.hardFirstAt);
  sim.setPace({ hard: false });
  sim.reset(11);
  const view = { cx: sim.player.x, cy: sim.player.y, halfW: 400, halfH: 700 };
  let placed = 0;
  let onRoad = 0;
  let inSight = 0;
  const angles = [];
  for (let i = 0; i < 40; i += 1) {
    for (const strip of sim.spikeStrips) if (strip.active) sim.removeSpikeStrip(strip);
    sim.player.reset(sim.player.x, sim.player.y, (i % 4) * (Math.PI / 2));
    sim.player.launch(300);
    if (!sim.spawner.tryLooseSpikes(sim, view)) continue;
    placed += 1;
    const strip = sim.spikeStrips.find((x) => x.active);
    const road = nearestRoadPoint(strip.x, strip.y, { x: 0, y: 0, northSouth: true });
    if (Math.hypot(road.x - strip.x, road.y - strip.y) <= T.LOOSE_SPIKES.across + 1) onRoad += 1;
    if (isOnScreen(strip.x, strip.y, view, T.ROADBLOCK.screenMargin)) inSight += 1;
    angles.push(strip.heading % (Math.PI / 2));
  }
  check('they get placed', placed > 10, `${placed} of 40`);
  check('always on a road', onRoad === placed);
  check('never where you can see them appear', inSight === 0);
  check('at odd angles, not all square', new Set(angles.map((a) => a.toFixed(2))).size > 5);
}

check('longer power-ups: TURBO 5 s, PHANTOM 6 s, TITAN 10 s', T.TURBO.seconds === 5 && T.PHANTOM.seconds === 6 && GIANT.seconds === 10);

// ---- Whole runs ------------------------------------------------------------------------------
{
  const sim = newSim();
  let bearcats = 0;
  let early = 0;
  let mostBearcats = 0;
  let flats = 0;
  let parked = 0;
  let parkedEarly = 0;
  let drops = 0;
  let copters = 0;
  let copterEarly = 0;
  let bad = 0;
  let mostShapes = 0;
  const causes = {};
  for (let seed = 700; seed < 725; seed += 1) {
    const r = playRun(sim, {
      seed,
      skill: 1.7,
      maxSeconds: 200,
      onStep(s, events) {
        for (const e of events) {
          if (e.type === 'spawn') {
            if (e.police.armored) {
              bearcats += 1;
              if (s.time < 120) early += 1;
            }
            if (e.police.parked) {
              parked += 1;
              if (s.time < ROADBLOCK.firstAt) parkedEarly += 1;
            }
          }
          if (e.type === 'flat') flats += 1;
          if (e.type === 'dropLand') drops += 1;
          if (e.type === 'helicopter') {
            copters += 1;
            if (s.time < HELICOPTER.firstAt) copterEarly += 1;
          }
        }
        mostBearcats = Math.max(mostBearcats, s.bearcats);
        mostShapes = Math.max(mostShapes, s.world.shapes.length);
        if (!Number.isFinite(s.player.x) || !Number.isFinite(s.helicopter.z)) bad += 1;
      },
    });
    causes[r.cause] = (causes[r.cause] || 0) + 1;
  }
  check('Bearcats turn up in real runs', bearcats > 0, `${bearcats} spawned`);
  check('never before 2 minutes', early === 0);
  check('never more than the limit at once', mostBearcats <= BEARCAT.maxActive, `most ${mostBearcats}`);
  check('roadblocks turn up, never before 75 s', parked > 0 && parkedEarly === 0, `${parked / 2} roadblocks`);
  check('the helicopter never turns up before 2 minutes', copterEarly === 0, `it came in ${copters} of 25 runs`);
  check('numbers stay sound', bad === 0);
  check('collision shapes stay bounded', mostShapes < 1300, `most ${mostShapes}; endings ${JSON.stringify(causes)}; ${flats} flats`);
}

{
  // Few bots live past 70 s, so these start there, to see the helicopter at work for a whole run.
  const sim = newSim();
  let flares = 0;
  let lands = 0;
  let endedOnProp = 0;
  let mostDrops = 0;
  for (let seed = 800; seed < 815; seed += 1) {
    let started = false;
    const r = playRun(sim, {
      seed,
      skill: 1.7,
      maxSeconds: 200,
      onStep(s, events) {
        if (!started) {
          s.time = HELICOPTER.firstAt;
          started = true;
        }
        for (const e of events) {
          if (e.type === 'flare') flares += 1;
          if (e.type === 'dropLand') lands += 1;
        }
        mostDrops = Math.max(mostDrops, s.helicopter.drops.filter((d) => d.active).length);
      },
    });
    if (r.cause === 'obstacle') endedOnProp += 1;
  }
  check('in a real chase it marks spots and drops things', flares > 0 && lands > 0, `${flares} flares, ${lands} landed in 15 runs`);
  check('within its limit', mostDrops <= HELICOPTER.maxDrops, `most at once ${mostDrops}`);
  check('solid props don\'t end most runs', endedOnProp <= 7, `${endedOnProp} of 15`);
}

// ---- The second chance -------------------------------------------------------------------
{
  const { REVIVE } = T;
  const s = quiet();
  drive(s, 3000, 3200);
  run(s, 0.2);
  const near = cruiser(s, s.player.x + 200, s.player.y, 0);
  const far = cruiser(s, s.player.x + 2000, s.player.y, 0);
  s.crashPlayer('police');
  check('after a crash the run can be revived', s.revivePlayer() && s.state === 'running' && s.revived);
  check('the car is back on clear road, moving along it', s.world.isClear(s.player.x, s.player.y, 30) && s.player.speed > 100 && Math.abs(Math.sin(s.player.heading)) < 1e-9, `speed ${s.player.speed.toFixed(0)}`);
  check('police close by are blown away, those far off are not', !near.alive && far.alive);
  check('blowing them away earns nothing: no combo, no wrecks counted', s.stats.wrecks === 0);
  s.crashPlayer('police');
  check('for a moment nothing can wreck it', s.state === 'running');
  run(s, REVIVE.safeSeconds + 0.1);
  s.crashPlayer('police');
  check('after that it can crash again', s.state === 'crashed');
  check('but a run can only be revived once', !s.revivePlayer() && s.state === 'crashed');
  s.reset(5);
  check('a new run has its second chance back', !s.revived && s.safeTime === 0);
  // The first drive's practice retries leave the run's own second chance unused.
  drive(s, 3000, 3200);
  run(s, 0.2);
  s.crashPlayer('obstacle');
  check('a practice retry puts the car back on the road', s.revivePlayer({ free: true }) && s.state === 'running' && !s.revived);
  run(s, REVIVE.safeSeconds + 0.1);
  s.crashPlayer('obstacle');
  check('and the second chance is still there after it', s.revivePlayer() && s.revived);
  // Every hint and tip is in characters the game's lettering can draw.
  const { readFileSync } = await import('node:fs');
  const font = readFileSync(new URL('../src/ui/displayFont.js', import.meta.url), 'utf8');
  const drawable = (text) => [...text].every((c) => c === ' ' || /[A-Z0-9]/.test(c) || font.includes(`'${c}': [`) || font.includes(`"${c}": [`));
  const texts = [...Object.values(T.TUTORIAL.tips).flatMap((tip) => [tip.head, tip.body, tip.keysHead || '', tip.keysBody || '']), ...Object.values(T.TUTORIAL.crashTips), 'OOPS!', 'TRY AGAIN', 'HOLD LEFT OR RIGHT TO STEER', 'STEER WITH < > OR A / D'];
  check('every hint can be drawn in the game\'s lettering', texts.every(drawable), texts.filter((t) => !drawable(t)).join(' | '));
  // Fallen into a hole on the road: it comes back on the road, clear of the hole.
  const hole = { kind: 'void', isVoid: true, x: 3000, y: 3000, heading: 0, collider: { type: 'circle', r: 150 }, breakable: false, outline: [] };
  const v = quiet([hole]);
  drive(v, 3000, 3000);
  v.chunks.update(3000, 3000);
  v.player.startFall(hole);
  v.crashPlayer('void');
  check('a fall can be revived too', v.revivePlayer() && !v.player.isFalling && v.state === 'running');
  check('and the car comes back on the road, clear of the hole', v.world.isClear(v.player.x, v.player.y, 30) && Math.hypot(v.player.x - 3000, v.player.y - 3000) > 150 && (v.player.x % 600 === 0 || v.player.y % 600 === 0), `at ${v.player.x.toFixed(0)}, ${v.player.y.toFixed(0)}`);
  check('the price is within reach of a few runs\' coins', REVIVE.cost <= 300 && REVIVE.cost >= 50);
}

// ---- Armour ------------------------------------------------------------------------------------
{
  const { CARS } = T;
  const tankCar = CARS.find((c) => c.id === 'tank');
  const s = quiet();
  s.setCar(tankCar);
  s.reset(9);
  drive(s, 3000, 3200);
  check('the tank starts with 3 shields, the bulldozer and monster truck 2, others none', s.player.armor === 3 && CARS.find((c) => c.id === 'bulldozer').armor === 2 && CARS.find((c) => c.id === 'monster').armor === 2 && !CARS.find((c) => c.id === 'coupe').armor);
  const hits = [];
  for (let i = 0; i < 3; i += 1) {
    s.crashPlayer('bearcat');
    hits.push(s.state);
    run(s, T.ARMOR.hitSafeSeconds + 0.1);
  }
  check('two SWAT hits cost two shields, and the tank drives on', hits[0] === 'running' && hits[1] === 'running');
  check('the third leaves it with none, and still driving', hits[2] === 'running' && s.player.armor === 0);
  s.crashPlayer('bearcat');
  check('one more hit and it is wrecked', s.state === 'crashed');
  const t2 = quiet();
  t2.setCar(tankCar);
  t2.reset(9);
  drive(t2, 3000, 3200);
  t2.crashPlayer('police');
  t2.crashPlayer('police');
  check('one pile-up costs one shield, not all of them', t2.player.armor === 2 && t2.state === 'running');
  t2.crashPlayer('void');
  check('a fall into a hole ends it, shields or not', t2.state === 'crashed');
  check('a revive gives the shields back', t2.revivePlayer() && t2.player.armor === 3);
  const coupe = quiet();
  coupe.setCar(CARS[0]);
  coupe.reset(9);
  drive(coupe, 3000, 3200);
  coupe.crashPlayer('police');
  check('a car without armour is wrecked at once, as before', coupe.state === 'crashed');
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
