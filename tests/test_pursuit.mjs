// Checks for pursuit: spawning in motion, chasers vs interceptors, warning arrows, the heat curve,
// roadblocks.
import { Camera, ChaseSimulation, SCREENS, T, difficultyAt, fixedMap, isOnScreen, newSim, playRun, projection } from './simkit.mjs';
import { PoliceCar } from '../src/entities/PoliceCar.js';
import { Car } from '../src/entities/Car.js';
import { chooseTarget, steerPolice } from '../src/systems/PoliceAI.js';
import { ThreatRadar } from '../src/systems/ThreatRadar.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

const { cell, margin } = T.WORLD;
const handling = T.HANDLING_PRESETS.balanced;
const DEG = Math.PI / 180;

function movingPlayer(x, y, headingDeg, speed = 300) {
  const car = new Car(handling);
  car.reset(x, y, headingDeg * DEG);
  car.launch(speed);
  return car;
}
function policeAt(x, y, headingDeg, role, options = {}) {
  const p = new PoliceCar(0);
  p.spawn(x, y, headingDeg * DEG, { role, speedFactor: 1.1, turnDeg: 125, aimSide: 0, launchShare: 1, ...options });
  return p;
}

// ---- Heat curve -----------------------------------------------------------------------------
{
  const at = difficultyAt;
  check('0-15 s: 2 to 4 police', at(0).targetPolice === 2 && at(14.9).targetPolice <= 4 && at(14.9).targetPolice >= 3, `${at(0).targetPolice} rising to ${at(14.9).targetPolice}`);
  check('0-15 s: chasers only', at(0).interceptorShare === 0 && at(14.9).interceptorShare === 0);
  check('from 15 s: interceptors appear', at(15).interceptorShare > 0.2, `${at(15).interceptorShare}`);
  check('30-45 s: top speed climbs', at(45).speedFactor > at(30).speedFactor + 0.03 && at(30).speedFactor - at(0).speedFactor < 0.02, `${at(0).speedFactor} / ${at(30).speedFactor} / ${at(45).speedFactor}`);
  check('45 s on: a swarm, with more interceptors reacting faster', at(90).targetPolice > at(45).targetPolice && at(90).interceptorShare > at(30).interceptorShare && at(90).reaction < at(45).reaction, `${at(45).targetPolice} -> ${at(90).targetPolice} police`);
  let rising = true;
  for (let t = 1; t < 200; t += 1) if (at(t).targetPolice < at(t - 1).targetPolice) rising = false;
  check('pressure never drops as the run goes on', rising);
  check('police never exceed the performance cap', at(9999).targetPolice <= T.POLICE.maxActive);
}

// ---- Chasers and interceptors ---------------------------------------------------------------
{
  const player = movingPlayer(1000, 1000, 0);
  const near = policeAt(1000, 1100, 0, 'chaser');
  chooseTarget(near, player);
  check('a chaser aims at where the player is now', near.targetX === player.x && near.targetY === player.y);
  const far = policeAt(1000, 1600, 0, 'chaser');
  far.aimSide = 1;
  chooseTarget(far, player);
  check('far away, chasers aim a little to their own side, so they do not all follow one line', Math.abs(far.targetX - player.x) > 30 && far.targetY === player.y, `off by ${(far.targetX - player.x).toFixed(0)}`);
}
{
  // Interceptor: predicted position, per the formula, away from any crossing.
  const player = movingPlayer(1300, 1300, 0); // mid-block, heading north
  const p = policeAt(1300 + 150, 1300 + 40, 0, 'interceptor');
  chooseTarget(p, player);
  const distance = Math.hypot(150, 40);
  const lead = Math.max(T.INTERCEPTOR.leadMin, Math.min(T.INTERCEPTOR.leadMax, distance / p.model.speed));
  check('close by, an interceptor aims at player + velocity x lead time', Math.abs(p.targetY - (player.y + player.vy * lead)) < 1e-6 && Math.abs(p.targetX - player.x) < 1e-6, `lead ${lead.toFixed(2)} s`);
  const far = policeAt(1300 + 1000, 1500, 0, 'interceptor');
  const nearer = policeAt(1300 + 300, 1400, 0, 'interceptor');
  chooseTarget(far, player);
  chooseTarget(nearer, player);
  check('the further away it is, the further ahead it aims', far.targetY <= nearer.targetY);
}
{
  // Ambush: at its longest lead time (480 units at this speed), the player will be just past a crossing.
  const player = movingPlayer(cell * 3, cell * 3 + 450, 0); // on a north-south road, a crossing 450 ahead
  const p = policeAt(cell * 3 + 800, cell * 3 - 100, -90, 'interceptor');
  chooseTarget(p, player);
  check('an interceptor heads for the crossing the player is about to reach', p.targetX === cell * 3 && p.targetY === cell * 3, `target ${p.targetX},${p.targetY}`);
  const close = policeAt(cell * 3 + 250, cell * 3 + 450, -90, 'interceptor');
  chooseTarget(close, player);
  check('up close it goes for the player, not the crossing', close.targetY !== cell * 3);
}
{
  // Flank: behind the player, it swings out to its own side instead of tailgating.
  for (const side of [-1, 1]) {
    const player = movingPlayer(1300, 1300, 0);
    const p = policeAt(1300 + side * 60, 1300 + 300, 0, 'interceptor');
    chooseTarget(p, player);
    check(`behind the player on the ${side < 0 ? 'left' : 'right'}: it flanks on that side`, Math.sign(p.targetX - player.x) === side && Math.abs(p.targetX - player.x) >= T.INTERCEPTOR.flankOffset - 1, `target ${(p.targetX - player.x).toFixed(0)} to the side`);
  }
}
{
  // Whole behaviour: a car arrives along a side street, ahead of a player driving straight north.
  // Where does it cross the player's line, compared with the player?
  const race = (role) => {
    const player = movingPlayer(0, 0, 0);
    const p = policeAt(800, -500, -90, role, { speedFactor: 1.11 });
    p.retarget = 0;
    let rng = 7;
    const random = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
    let closest = Infinity;
    let crossedAhead = null;
    for (let t = 0; t < 4; t += 1 / 60) {
      player.step(0, 1 / 60);
      steerPolice(p, player, 1 / 60, random, null);
      p.model.stepFor(p.steer, 1 / 60, 1 / 120);
      closest = Math.min(closest, Math.hypot(p.model.x - player.x, p.model.y - player.y));
      if (crossedAhead === null && p.model.x <= player.x) crossedAhead = player.y - p.model.y; // positive = in front of the player
    }
    return { closest, crossedAhead };
  };
  const chaser = race('chaser');
  const interceptor = race('interceptor');
  check('from a side street, a chaser swings round behind the player', chaser.crossedAhead === null || chaser.crossedAhead < 0, `crossed the player's line ${chaser.crossedAhead === null ? 'never' : `${chaser.crossedAhead.toFixed(0)} units ahead`}, closest ${chaser.closest.toFixed(0)}`);
  check('an interceptor reaches a player who just keeps driving straight', interceptor.crossedAhead !== null && interceptor.closest < 60, `closest ${interceptor.closest.toFixed(0)}, against ${chaser.closest.toFixed(0)} for the chaser`);
}

// ---- Spawning in motion ---------------------------------------------------------------------
{
  const sim = newSim();
  const seen = [];
  const parked = [];
  let wrongHeading = 0;
  let offRoad = 0;
  let onScreen = 0;
  let unloaded = 0;
  let early = 0;
  for (let seed = 300; seed < 325; seed += 1) {
    playRun(sim, {
      seed,
      skill: 1.5,
      maxSeconds: 80,
      onStep(s, events, view) {
        for (const e of events) {
          if (e.type !== 'spawn') continue;
          const p = e.police;
          if (isOnScreen(e.x, e.y, view, 0)) onScreen += 1;
          if (!s.chunks.contains(e.x, e.y)) unloaded += 1;
          if (p.parked) {
            parked.push({ p, time: s.time, x: e.x, y: e.y });
            continue;
          }
          seen.push({ role: p.role, time: s.time, speed: p.model.speed, top: p.handling.topSpeed, heading: p.model.heading });
          const quarter = p.model.heading / (Math.PI / 2);
          if (Math.abs(quarter - Math.round(quarter)) > 1e-6) wrongHeading += 1;
          const fx = ((e.x % cell) + cell) % cell;
          const fy = ((e.y % cell) + cell) % cell;
          if (Math.min(fx, cell - fx, fy, cell - fy) > margin) offRoad += 1;
          if (p.role === 'interceptor' && s.time < 15) early += 1;
        }
      },
    });
  }
  const shares = seen.map((s) => s.speed / s.top);
  check('police spawn already moving: 80-100% of top speed', shares.length > 100 && Math.min(...shares) >= 0.8 - 1e-6 && Math.max(...shares) <= 1 + 1e-6, `${shares.length} spawns, ${Math.min(...shares).toFixed(2)}-${Math.max(...shares).toFixed(2)}`);
  check('they point along the road, not across it', wrongHeading === 0, `${wrongHeading} of ${seen.length}`);
  check('they spawn in a lane of a road', offRoad === 0, `${offRoad} off road`);
  check('nothing spawns on screen', onScreen === 0, `${onScreen}`);
  check('nothing spawns on an unloaded chunk', unloaded === 0, `${unloaded}`);
  check('no interceptors before 15 s', early === 0);
  check('interceptors do appear in normal runs', seen.some((s) => s.role === 'interceptor'), `${seen.filter((s) => s.role === 'interceptor').length} of ${seen.length}`);
  check('roadblocks appear, and only from 30 s', parked.length > 0 && parked.every((b) => b.time >= T.ROADBLOCK.firstAt), `${parked.length} parked cars`);
}
{
  // A spawn really is driving along the road toward the player.
  const s = new ChaseSimulation({ layout: fixedMap([]), handling });
  s.time = 3;
  s.spawner.cooldown = 0;
  s.player.reset(3000, 3000, 0);
  s.player.launch(300);
  const cam = new Camera(SCREENS.portrait);
  cam.snap(s.player);
  let view = cam.view;
  for (let i = 0; i < 90; i += 1) view = cam.follow(s.player, 1 / 60);
  const ok = s.spawner.trySpawn(s, view, { ...difficultyAt(3), interceptorShare: 0 });
  const p = s.police.find((c) => c.active);
  const toward = Math.sin(p.model.heading) * (s.player.x - p.model.x) - Math.cos(p.model.heading) * (s.player.y - p.model.y);
  check('a new car is pointed along its road toward the player', ok && toward > 0);
  const i = s.spawner.trySpawn(s, view, { ...difficultyAt(20), interceptorShare: 1 });
  const fast = s.police.filter((c) => c.active).find((c) => c.role === 'interceptor');
  check('interceptors come along cross streets, and are the fast ones', i && Math.abs(Math.cos(fast.model.heading)) < 1e-6 && fast.handling.topSpeed > p.handling.topSpeed, `heading ${(fast.model.heading / DEG).toFixed(0)} deg, top speed ${fast.handling.topSpeed.toFixed(0)} vs ${p.handling.topSpeed.toFixed(0)}`);
}

// ---- Warning arrows -------------------------------------------------------------------------
{
  const view = () => {
    const c = projection.toScreen(1000, 1000, 0);
    return { cx: c.x, cy: c.y, halfW: 450, halfH: 800 };
  };
  const setup = () => {
    const s = new ChaseSimulation({ layout: fixedMap([]), handling });
    s.player.reset(1000, 1000, 0);
    s.player.launch(300);
    return s;
  };
  const settle = (radar, s, v, seconds = 0.6) => {
    for (let t = 0; t < seconds; t += 1 / 60) radar.update(s, v, 1 / 60);
  };
  const v = view();
  const opts = (role) => ({ role, speedFactor: 1.1, turnDeg: 100, aimSide: 0, launchShare: 1 });

  // Head-on from out of sight, ahead.
  let s = setup();
  let radar = new ThreatRadar();
  const ahead = s.spawnPolice(1000, 1000 - 1500, Math.PI, opts('chaser'));
  settle(radar, s, v);
  check('a fast car coming head-on from out of sight gets an arrow', radar.threats.length === 1 && radar.threats[0].level > 0.9, `level ${radar.threats[0]?.level.toFixed(2)}`);
  check('the arrow knows where the car is', radar.threats[0].x === ahead.model.x && radar.threats[0].y === ahead.model.y);

  // Tailing from out of sight: speed nearly matches, so no alarm.
  s = setup();
  radar = new ThreatRadar();
  s.spawnPolice(1000, 1000 + 1500, 0, opts('chaser'));
  settle(radar, s, v);
  check('a chaser tailing from behind gets no arrow', radar.threats.length === 0);

  // Interceptor from the side: lower threshold.
  s = setup();
  radar = new ThreatRadar();
  s.spawnPolice(1000 - 1300, 1000 - 300, Math.PI / 2, opts('interceptor'));
  settle(radar, s, v);
  check('an interceptor closing from the side gets an arrow', radar.threats.length === 1);

  // Moving away.
  s = setup();
  radar = new ThreatRadar();
  s.spawnPolice(1000 - 1300, 1000 - 300, -Math.PI / 2, opts('interceptor'));
  settle(radar, s, v);
  check('one driving away gets none', radar.threats.length === 0);

  // Too far off: not yet.
  s = setup();
  radar = new ThreatRadar();
  s.spawnPolice(1000, 1000 - 7000, Math.PI, opts('chaser'));
  settle(radar, s, v);
  check('one that is many seconds away gets none yet', radar.threats.length === 0);

  // Parked.
  s = setup();
  radar = new ThreatRadar();
  s.spawnPolice(1000, 1000 - 1500, 0, { ...opts('roadblock'), launchShare: 0 });
  settle(radar, s, v);
  check('a parked roadblock gets none: you can see it coming', radar.threats.length === 0);

  // Fades with the car coming into view, gone once well inside.
  s = setup();
  radar = new ThreatRadar();
  const coming = s.spawnPolice(1000, 1000 - 1500, Math.PI, opts('chaser'));
  settle(radar, s, v);
  const full = radar.threats[0].level;
  const edgeY = (screenBack) => {
    // Puts the car `screenBack` screen units inside the top of the view.
    const worldUp = (v.halfH - screenBack) / projection.squash;
    coming.model.x = 1000 + Math.sin(projection.azimuth) * -worldUp;
    coming.model.y = 1000 + Math.cos(projection.azimuth) * -worldUp;
  };
  edgeY(T.WARNING.fadeInside * 0.5);
  settle(radar, s, v);
  const half = radar.threats[0]?.level ?? 0;
  check('the arrow fades as the car enters the view', half > 0.3 && half < full - 0.2, `${full.toFixed(2)} -> ${half.toFixed(2)}`);
  edgeY(T.WARNING.fadeInside + 40);
  settle(radar, s, v);
  check('and is gone once the car is well in view', radar.threats.length === 0);

  // Wrecked or removed: fades out, no leftovers.
  s = setup();
  radar = new ThreatRadar();
  const doomed = s.spawnPolice(1000, 1000 - 1500, Math.PI, opts('chaser'));
  settle(radar, s, v);
  s.removePolice(doomed, 'despawn');
  settle(radar, s, v);
  check('a car that leaves the map takes its arrow with it', radar.threats.length === 0);

  // Cap and order.
  s = setup();
  radar = new ThreatRadar();
  const swarm = [];
  for (let i = 0; i < 9; i += 1) swarm.push(s.spawnPolice(1000 + i * 30, 1000 - 1100 - i * 100, Math.PI, opts('chaser')));
  settle(radar, s, v, 0.3);
  check('only a few arrows at once, however many cars', radar.threats.length === T.WARNING.maxShown, `${radar.threats.length} of ${swarm.length}`);
  const etas = radar.threats.map((t) => t.eta);
  check('the soonest arrivals get them', etas.every((e, i) => i === 0 || e >= etas[i - 1]) && radar.threats[0].y === swarm[0].model.y);

  // Steady closing speed near the limit should not flicker.
  s = setup();
  radar = new ThreatRadar();
  const wobble = s.spawnPolice(1000, 1000 - 1500, Math.PI, opts('chaser'));
  settle(radar, s, v);
  let flips = 0;
  let was = radar.threats.length > 0;
  for (let i = 0; i < 40; i += 1) {
    const needed = T.WARNING.closingFast;
    wobble.model.vy = (i % 2 ? needed + 40 : needed - 40) + s.player.vy;
    radar.update(s, v, 1 / 60);
    const is = radar.threats.length > 0;
    if (is !== was) flips += 1;
    was = is;
  }
  check('an arrow does not flicker when a car hovers around the limit', flips <= 1, `${flips} changes`);
}

// ---- Roadblocks -----------------------------------------------------------------------------
{
  const s = new ChaseSimulation({ layout: fixedMap([]), handling });
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.powerUps.timer = 1e6;
  s.time = 40;
  s.player.reset(cell * 5, cell * 5, 0);
  s.player.launch(300);
  const cam = new Camera(SCREENS.landscape);
  cam.snap(s.player);
  let view = cam.view;
  for (let i = 0; i < 120; i += 1) view = cam.follow(s.player, 1 / 60);
  s.chunks.update(s.player.x, s.player.y);
  const ok = s.spawner.tryRoadblock(s, view);
  const cars = s.police.filter((p) => p.active);
  check('a roadblock is placed: two parked cars', ok && cars.length === T.ROADBLOCK.cars && cars.every((p) => p.parked && p.alive && p.model.speed === 0));
  const midX = cars.reduce((n, c) => n + c.model.x, 0) / cars.length;
  const midY = cars.reduce((n, c) => n + c.model.y, 0) / cars.length;
  check('on a crossing, ahead of the player', midX % cell === 0 && midY % cell === 0 && midY < s.player.y, `${midX},${midY}`);
  check('out of sight when placed', cars.every((c) => !isOnScreen(c.model.x, c.model.y, view, 0)));
  check('the two cars stand across the way the player is going, angled in', Math.abs(cars[0].model.x - cars[1].model.x) === T.ROADBLOCK.spacing && Math.abs(Math.cos(cars[0].model.heading)) < 0.6 && Math.abs(Math.cos(cars[0].model.heading)) > 0.3 && Math.sign(Math.cos(cars[0].model.heading)) !== Math.sign(Math.cos(cars[1].model.heading)));
  check('roadblocks do not count as pursuers', s.pursuers === 0 && s.alivePolice === T.ROADBLOCK.cars);
  const at = { x: cars[0].model.x, y: cars[0].model.y };
  s.player.reset(cell * 5 + 900, cell * 5 + 900, 0);
  for (let t = 0; t < 4; t += 1 / 60) s.step(1 / 60, { steer: 0 }, view);
  const stay = s.police.filter((p) => p.active);
  check('parked cars stay put, and are not removed as "stuck"', stay.length === T.ROADBLOCK.cars && stay[0].model.x === at.x && stay[0].model.y === at.y && stay.every((c) => c.alive));
}
{
  // Hitting one: full speed is the end, and says why.
  const s = new ChaseSimulation({ layout: fixedMap([]), handling });
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.powerUps.timer = 1e6;
  s.player.reset(1000, 1400, 0);
  s.player.launch(300);
  const view = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
  const parked = s.spawnPolice(1000, 1000, Math.PI / 2, { role: 'roadblock', speedFactor: 1, turnDeg: 0, aimSide: 0, launchShare: 0 });
  for (let t = 0; t < 2 && s.state === 'running'; t += 1 / 60) s.step(1 / 60, { steer: 0 }, view);
  check('hitting a roadblock at speed ends the run', s.state === 'crashed' && s.crash.cause === 'roadblock', s.crash?.cause);
  check('and wrecks the parked car', parked.state === 'wreck');
}
{
  // Luring police into one.
  const s = new ChaseSimulation({ layout: fixedMap([]), handling });
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.powerUps.timer = 1e6;
  s.player.reset(1600, 1000, 0);
  const view = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
  const parked = s.spawnPolice(1000, 1000, Math.PI / 2, { role: 'roadblock', speedFactor: 1, turnDeg: 0, aimSide: 0, launchShare: 0 });
  const cop = s.spawnPolice(1000, 1400, 0, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0, launchShare: 1 });
  cop.handling.maxTurnRateDeg = 0;
  const events = [];
  for (let t = 0; t < 2; t += 1 / 60) for (const e of s.step(1 / 60, { steer: 0 }, view)) events.push(e.type);
  check('police lured into a roadblock pile up, and it counts', parked.state !== 'chasing' && cop.state !== 'chasing' && s.stats.wrecks === 2 && events.includes('explosion'), `wrecks ${s.stats.wrecks}`);
}
{
  // A bot run with fresh chunks: limit on parked cars holds.
  const sim = newSim();
  let most = 0;
  for (let seed = 400; seed < 410; seed += 1) {
    playRun(sim, {
      seed,
      skill: 1.6,
      maxSeconds: 120,
      onStep(s) {
        let parked = 0;
        for (const p of s.police) if (p.alive && p.parked) parked += 1;
        most = Math.max(most, parked);
      },
    });
  }
  check('never more parked cars than the limit', most <= T.ROADBLOCK.maxParked, `most ${most}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
