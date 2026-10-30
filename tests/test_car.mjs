// Unit checks for the shared driving model (runs in Node, no browser).
import { Car } from '../src/entities/Car.js';
import { HANDLING_PRESETS, HANDLING_PRESET_ORDER, PHYSICS, POLICE_HANDLING } from '../src/config/tuning.js';
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

// Slide state: sign of the slip, and the nose really does point away from the velocity.
{
  const car = new Car(HANDLING_PRESETS.balanced);
  car.launch(300);
  let peakSlip = 0;
  for (let i = 0; i < 60; i++) {
    car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
    peakSlip = Math.min(peakSlip, car.slipAngle);
  }
  const moving = Math.atan2(car.vx, -car.vy);
  const gap = Math.atan2(Math.sin(moving - car.heading), Math.cos(moving - car.heading));
  check('turning right: car slides to the left of its nose (negative slip)', peakSlip < -0.2, `${fmt((peakSlip * 180) / Math.PI)} deg`);
  check('slipAngle equals the real gap between nose and travel', Math.abs(gap - car.slipAngle) < 0.001, `${fmt((gap * 180) / Math.PI)} deg`);
  check('body leans away from the turn (visual roll, within its limit)', car.chassisRoll < 0 && Math.abs(car.chassisRoll) <= (HANDLING_PRESETS.balanced.rollMaxDeg * Math.PI) / 180 + 1e-9, `${fmt((car.chassisRoll * 180) / Math.PI)} deg`);
  for (let i = 0; i < 120; i++) car.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
  check('slip and roll settle back to zero on a straight', Math.abs(car.slipAngle) < 0.01 && Math.abs(car.chassisRoll) < 0.01);
}

// Grip: drops while sliding, on top of the drop from steering.
{
  const settle = (handling) => {
    const car = new Car(handling);
    car.launch(300);
    car.peakDrift = 0;
    for (let i = 0; i < 120; i++) {
      car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
      car.peakDrift = Math.max(car.peakDrift, car.driftAngleDeg);
    }
    return car;
  };
  const withLoss = settle(HANDLING_PRESETS.balanced);
  const noLoss = settle({ ...HANDLING_PRESETS.balanced, slideGripLoss: 0 });
  check('sliding lowers grip below the steering-only value', withLoss.grip < noLoss.grip - 0.2, `${withLoss.grip.toFixed(2)} vs ${noLoss.grip.toFixed(2)}`);
  check('... so the slide is deeper', withLoss.peakDrift > noLoss.peakDrift, `${fmt(withLoss.peakDrift)} vs ${fmt(noLoss.peakDrift)} deg at its peak`);
  const straight = new Car(HANDLING_PRESETS.balanced);
  straight.launch(300);
  for (let i = 0; i < 120; i++) straight.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
  check('driving straight: grip stays at its high value', Math.abs(straight.grip - HANDLING_PRESETS.balanced.gripStraight) < 1e-6);
}

// Counter-steer: flicking from a right slide to the left turns the nose back faster with the bonus.
{
  const flick = (handling) => {
    const car = new Car(handling);
    car.launch(300);
    for (let i = 0; i < 60; i++) car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
    const before = car.heading;
    for (let i = 0; i < 15; i++) car.stepFor(-1, 1 / 60, PHYSICS.maxStepSeconds);
    return before - car.heading;
  };
  const helped = flick(HANDLING_PRESETS.balanced);
  const plain = flick({ ...HANDLING_PRESETS.balanced, counterSteerBonus: 0 });
  check('counter-steering turns the nose back faster', helped > plain * 1.1, `${fmt((helped * 180) / Math.PI)} vs ${fmt((plain * 180) / Math.PI)} deg in 0.25 s`);
  const entering = (handling) => {
    const car = new Car(handling);
    car.launch(300);
    for (let i = 0; i < 15; i++) car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
    return car.heading;
  };
  check('no bonus when turning into the corner', Math.abs(entering(HANDLING_PRESETS.balanced) - entering({ ...HANDLING_PRESETS.balanced, counterSteerBonus: 0, slideGripLoss: 0, deepSlideScrub: 0 })) < 0.02);
}

// Deep slides cost extra speed; shallow driving does not.
{
  const deep = (handling) => {
    const car = new Car(handling);
    car.launch(300);
    let slowest = Infinity;
    for (let i = 0; i < 150; i++) {
      car.stepFor(1, 1 / 60, PHYSICS.maxStepSeconds);
      slowest = Math.min(slowest, car.speed);
    }
    return slowest;
  };
  const scrubbed = deep(HANDLING_PRESETS.drifty);
  const free = deep({ ...HANDLING_PRESETS.drifty, deepSlideScrub: 0 });
  check('a deep slide scrubs a little more speed, not a lot', scrubbed <= free && free - scrubbed < 40, `${fmt(scrubbed)} vs ${fmt(free)}`);
}

// Police keep their handling: none of the player's slide extras.
check('police have no slide extras', POLICE_HANDLING.slideGripLoss === 0 && POLICE_HANDLING.counterSteerBonus === 0 && POLICE_HANDLING.deepSlideScrub === 0);

// No outer wall: the old map edges (0 and 6000) and everything beyond them are just open road.
for (const [name, x, y, heading] of [['north', 500, 200, 0], ['west', 200, 500, -Math.PI / 2], ['east', 5800, 500, Math.PI / 2], ['south', 500, 5800, Math.PI]]) {
  const car = new Car(HANDLING_PRESETS.balanced);
  car.reset(x, y, heading);
  car.launch(300);
  let maxImpact = 0;
  for (let i = 0; i < 180; i++) {
    car.stepFor(0, 1 / 60, PHYSICS.maxStepSeconds);
    maxImpact = Math.max(maxImpact, collideWithWorld(car, emptyWorld, hit));
  }
  check(`no wall: driving ${name} past the old map edge meets nothing`, maxImpact === 0 && car.speed > 295 && Math.hypot(car.x - x, car.y - y) > 800);
}

// A long random drive stays sane.
{
  const car = new Car(HANDLING_PRESETS.drifty);
  car.reset(2000, 2000, 0.3);
  let escaped = false, seed = 7, steer = 0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 20 === 0) steer = Math.floor(rnd() * 3) - 1;
    car.stepFor(steer, 1 / 60, PHYSICS.maxStepSeconds);
    collideWithWorld(car, emptyWorld, hit);
    if (!Number.isFinite(car.x) || !Number.isFinite(car.y)) escaped = true;
  }
  check('2-minute random drive keeps valid numbers', !escaped);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
