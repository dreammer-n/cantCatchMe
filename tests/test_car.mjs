// Unit checks for the shared driving model (runs in Node, no browser).
import { Car } from '../src/entities/Car.js';
import { ARENA, CRASH, HANDLING_PRESETS, HANDLING_PRESET_ORDER, PHYSICS } from '../src/config/tuning.js';
import { StaticWorld, collideWithWorld } from '../src/systems/CollisionSystem.js';
const emptyWorld = new StaticWorld([]);
const hit = { impact: 0, shape: null };

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };
const fmt = (n) => n.toFixed(1);

// Script: 1 s straight, 1.5 s right, 1 s straight, 1 s left.
const script = (t) => (t < 1 ? 0 : t < 2.5 ? 1 : t < 3.5 ? 0 : -1);

function run(preset, fps, seconds = 4.5) {
  const car = new Car(HANDLING_PRESETS[preset]);
  const frame = 1 / fps;
  let maxDrift = 0, minSpeedAfterStart = Infinity;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    car.stepFor(script(i / fps + 1e-9), frame, PHYSICS.maxStepSeconds);
    const t = (i + 1) / fps;
    maxDrift = Math.max(maxDrift, car.driftAngleDeg);
    if (t > 1) minSpeedAfterStart = Math.min(minSpeedAfterStart, car.speed);
  }
  return { car, maxDrift, minSpeedAfterStart };
}

for (const preset of HANDLING_PRESET_ORDER) {
  const a = run(preset, 30), b = run(preset, 60), c = run(preset, 144), d = run(preset, 240);
  const spread = Math.max(...[b, c, d].map((r) => Math.hypot(r.car.x - a.car.x, r.car.y - a.car.y)));
  check(`${preset}: same path at 30/60/144/240 fps`, spread < 6, `max gap ${fmt(spread)} units`);
  check(`${preset}: reaches top speed`, Math.abs(run(preset, 60, 1).car.speed - 300) < 5, `speed ${fmt(run(preset, 60, 1).car.speed)}`);
  check(`${preset}: drift angle sensible (5-50 deg)`, b.maxDrift > 5 && b.maxDrift < 50, `max drift ${fmt(b.maxDrift)} deg`);
  check(`${preset}: keeps over 55% speed in a 1.5 s turn`, b.minSpeedAfterStart > 165, `min speed ${fmt(b.minSpeedAfterStart)}`);
}

// Ordering: grippy < balanced < drifty in drift amount.
const drifts = HANDLING_PRESET_ORDER.map((p) => run(p, 60).maxDrift);
check('presets ordered grippy < balanced < drifty', drifts[0] < drifts[1] && drifts[1] < drifts[2], drifts.map(fmt).join(' < '));

// Straight with no steering: heading never changes.
{
  const car = new Car(HANDLING_PRESETS.balanced);
  for (let i = 0; i < 300; i++) car.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
  check('no steering = drives straight up', Math.abs(car.heading) < 1e-9 && Math.abs(car.x) < 1e-6 && car.y < -1000, `y ${fmt(car.y)}`);
}

// No spinning on the spot: from a standstill, a short steer barely turns.
{
  const car = new Car(HANDLING_PRESETS.balanced);
  car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
  check('little turn at near-zero speed', Math.abs(car.heading) < 0.01, `heading ${car.heading.toFixed(4)} rad`);
}

// Left and right are mirror images.
{
  const l = new Car(HANDLING_PRESETS.balanced), r = new Car(HANDLING_PRESETS.balanced);
  for (let i = 0; i < 200; i++) { const s = i > 40 ? 1 : 0; l.stepFor(-s, 1 / 60, PHYSICS.maxStepSeconds); r.stepFor(s, 1 / 60, PHYSICS.maxStepSeconds); }
  check('left/right symmetric', Math.abs(l.x + r.x) < 1e-6 && Math.abs(l.y - r.y) < 1e-6);
}

// Grip recovers after releasing steering.
{
  const car = new Car(HANDLING_PRESETS.balanced);
  for (let i = 0; i < 60; i++) car.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
  for (let i = 0; i < 60; i++) car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
  const sliding = car.driftAngleDeg;
  for (let i = 0; i < 90; i++) car.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
  check('drift fades after release (1.5 s)', car.driftAngleDeg < sliding * 0.15, `${fmt(sliding)} -> ${fmt(car.driftAngleDeg)} deg`);
}

// Wall: head-on into the top wall at full speed is a crash-strength impact; the car stays inside.
{
  const car = new Car(HANDLING_PRESETS.balanced);
  car.reset(500, 200, 0);
  car.launch(300);
  let maxImpact = 0;
  for (let i = 0; i < 120; i++) {
    car.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
    maxImpact = Math.max(maxImpact, collideWithWorld(car, emptyWorld, hit));
  }
  check('head-on wall: crash-strength impact, car stays inside', maxImpact > CRASH.playerImpact && car.y > 0 && car.y < ARENA.height, `impact ${fmt(maxImpact)}, y ${fmt(car.y)}`);
}

// Wall: long random drive never escapes the arena.
{
  const car = new Car(HANDLING_PRESETS.drifty);
  car.reset(2000, 2000, 0.3);
  let escaped = false, seed = 7, steer = 0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 20 === 0) steer = Math.floor(rnd() * 3) - 1;
    car.stepFor(steer, 1 / 60, PHYSICS.maxStepSeconds);
    collideWithWorld(car, emptyWorld, hit);
    if (car.x < 0 || car.x > ARENA.width || car.y < 0 || car.y > ARENA.height || !Number.isFinite(car.x)) escaped = true;
  }
  check('2-minute random drive stays inside the arena', !escaped);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
