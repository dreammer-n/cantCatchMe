// Checks for the endless world: chunk layouts, streaming, holes and falling, police recycling.
import { Camera, Car, CS, ChaseSimulation, SCREENS, T, buildLayout, fixedMap, isOnScreen, newSim, playRun, projection } from './simkit.mjs';
import { ChunkManager } from '../src/systems/ChunkManager.js';
import { holeLipY } from '../src/render/Tumble.js';
import { buildChunk, chunkCoord, propCatalogue } from '../src/systems/WorldLayout.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

const S = T.CHUNKS.size;
const { cell, margin } = T.WORLD;
const handling = T.HANDLING_PRESETS.balanced;
const sample = [];
for (let cy = -14; cy < 14; cy += 1) for (let cx = -14; cx < 14; cx += 1) sample.push(buildChunk(cx, cy));
const portable = (c) => JSON.stringify([c.preset, c.items.map((i) => [i.kind, i.x, i.y, i.heading]), c.voids.map((v) => [v.x, v.y]), c.paint.length]);

// ---- Layouts ------------------------------------------------------------------------------
check('a chunk is a whole number of city blocks, and of floor squares', S % cell === 0 && S % T.SCENERY.floorChunk === 0);
check('the same chunk always comes back the same', sample.every((c) => portable(c) === portable(buildChunk(c.cx, c.cy))));
check('neighbouring chunks differ', new Set(sample.map(portable)).size === sample.length);

const counts = {};
for (const c of sample) counts[c.preset] = (counts[c.preset] || 0) + 1;
check('there are 4-6 chunk layouts, and all of them appear', Object.keys(T.CHUNKS.presets).length >= 4 && Object.keys(T.CHUNKS.presets).length <= 6 && Object.keys(T.CHUNKS.presets).every((p) => counts[p] > 0), JSON.stringify(counts));

const kindsIn = (preset) => new Set(sample.filter((c) => c.preset === preset).flatMap((c) => c.items.map((i) => i.kind)));
check('parking chunks have islands (curbs) and streetlights', ['island', 'lamp'].every((k) => kindsIn('parking').has(k)));
check('plaza chunks have a roundabout, a monument and trees', ['roundabout', 'monument', 'tree'].every((k) => kindsIn('plaza').has(k)));
check('industrial chunks have barriers, containers and crates', ['barrier', 'container', 'woodcrate'].every((k) => kindsIn('industrial').has(k)));
check('city chunks have concrete blocks', kindsIn('city').has('block'));
check('ruins chunks have holes', sample.filter((c) => c.preset === 'ruins').every((c) => c.voids.length > 0));

// Holes are a surprise, not the landscape.
{
  const holes = sample.map((c) => c.voids.length);
  const clear = holes.filter((n) => n === 0).length / holes.length;
  const average = holes.reduce((a, b) => a + b, 0) / holes.length;
  check('most chunks have no holes at all', clear > 0.8, `${(clear * 100).toFixed(0)}% clear`);
  check('on average there is well under one hole a chunk', average < 0.5, `${average.toFixed(2)} a chunk`);
  check('but they do turn up', average > 0.05);
  check('even a ruined chunk doesn\'t overdo it', Math.max(...holes) <= 8, `at most ${Math.max(...holes)}`);
}

// Roads: nothing that blocks or swallows a car on any road around or between chunks. The roads
// inside a plaza's paved square are the exception, on purpose: that is the roundabout.
const roadStrip = margin - 25;
const onBorderRoad = (x, y, c) => x - c.x0 < roadStrip || c.x0 + S - x < roadStrip || y - c.y0 < roadStrip || c.y0 + S - y < roadStrip;
const onAnyRoad = (x, y) => {
  const fx = ((x % cell) + cell) % cell;
  const fy = ((y % cell) + cell) % cell;
  return fx < roadStrip || fx > cell - roadStrip || fy < roadStrip || fy > cell - roadStrip;
};
const allThings = (c) => [...c.items, ...c.voids];
check('every prop and hole stays inside its own chunk', sample.every((c) => allThings(c).every((i) => chunkCoord(i.x) === c.cx && chunkCoord(i.y) === c.cy)));
check('border roads are always completely clear, so chunks always connect', sample.every((c) => allThings(c).every((i) => !onBorderRoad(i.x, i.y, c))));
const blocking = sample.flatMap((c) => (c.preset === 'plaza' ? [] : c.items.filter((i) => onAnyRoad(i.x, i.y))));
check('no props on any road outside plazas', blocking.length === 0, `${blocking.length} found`);
const holeOutlineClear = sample.every((c) => c.voids.every((v) => v.outline.every((p) => p.x - c.x0 > margin && c.x0 + S - p.x > margin && p.y - c.y0 > margin && c.y0 + S - p.y > margin)));
check('holes, including their drawn edges, never reach a border road', holeOutlineClear);

// Seams: lane dashes on a shared border sit in the same places on both sides.
function borderDashes(c, side) {
  const out = [];
  for (const m of c.paint) {
    if (m.ring || m.color) continue;
    if (side === 'east' && Math.abs(m.x + m.w / 2 - (c.x0 + S)) < 1 && m.h > m.w) out.push(Math.round(m.y));
    if (side === 'west' && Math.abs(m.x + m.w / 2 - c.x0) < 1 && m.h > m.w) out.push(Math.round(m.y));
    if (side === 'south' && Math.abs(m.y + m.h / 2 - (c.y0 + S)) < 1 && m.w > m.h) out.push(Math.round(m.x));
    if (side === 'north' && Math.abs(m.y + m.h / 2 - c.y0) < 1 && m.w > m.h) out.push(Math.round(m.x));
  }
  return JSON.stringify(out.sort((a, b) => a - b));
}
let seams = 0;
let badSeams = 0;
for (const c of sample) {
  if (c.cx >= 13 || c.cy >= 13) continue;
  seams += 2;
  if (borderDashes(c, 'east') !== borderDashes(buildChunk(c.cx + 1, c.cy), 'west')) badSeams += 1;
  if (borderDashes(c, 'south') !== borderDashes(buildChunk(c.cx, c.cy + 1), 'north')) badSeams += 1;
}
check('road lines match across every chunk border', badSeams === 0 && seams > 0, `${seams} borders, ${badSeams} mismatched`);

// Drawing and memory.
const catalogue = new Set(propCatalogue().map((e) => `${e.model}:${Math.round((e.heading * 180) / Math.PI)}`));
const unknown = new Set(sample.flatMap((c) => c.items.map((i) => `${i.model}:${Math.round((i.heading * 180) / Math.PI)}`)).filter((k) => !catalogue.has(k)));
check('every prop in the world is drawn at startup, none during play', unknown.size === 0, [...unknown].slice(0, 4).join(' '));
check('few distinct prop drawings', catalogue.size < 110, `${catalogue.size} drawings`);
const fullest = Math.max(...sample.map((c) => c.items.length));
const worstGrid = fullest * (T.CHUNKS.activeRadius * 2 + 1) ** 2;
check('the prop pool covers even a grid of the fullest chunk', worstGrid <= T.CHUNKS.propPool, `fullest chunk ${fullest} props, 9 of them ${worstGrid}, pool ${T.CHUNKS.propPool}`);

// The camera must never see past the loaded chunks. Worst cases: taller and wider than real phones.
for (const [name, screen] of Object.entries({ ...SCREENS, 'very tall phone': { w: 1080, h: 2520 }, 'very wide monitor': { w: 2520, h: 1080 } })) {
  let reach = 0;
  let spawnReach = 0;
  for (const headingDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const cam = new Camera(screen);
    const car = new Car(handling);
    car.reset(0, 0, (headingDeg * Math.PI) / 180);
    car.launch(300);
    cam.snap(car);
    for (let t = 0; t < 5; t += 1 / 60) {
      car.step(0, 1 / 60);
      cam.follow(car, 1 / 60);
    }
    const v = cam.view;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const g = projection.groundFromScreen(v.cx + sx * v.halfW, v.cy + sy * v.halfH);
      reach = Math.max(reach, Math.abs(g.x - car.x), Math.abs(g.y - car.y));
      const m = T.SPAWN.screenMargin;
      const s = projection.groundFromScreen(v.cx + sx * (v.halfW + m), v.cy + sy * (v.halfH + m));
      spawnReach = Math.max(spawnReach, Math.abs(s.x - car.x), Math.abs(s.y - car.y));
    }
  }
  check(`${name}: the 3 x 3 grid reaches past everything the camera shows`, reach < S, `sees ${reach.toFixed(0)} units along a map axis, grid guarantees ${S}`);
  if (name in SCREENS) check(`${name}: and past where police spawn`, spawnReach < S, `${spawnReach.toFixed(0)}`);
}

// ---- Streaming ----------------------------------------------------------------------------
{
  const world = new CS.StaticWorld();
  const manager = new ChunkManager(buildLayout(), world);
  manager.update(100, 100);
  check('exactly 9 chunks are loaded, centred on the player', manager.active.size === 9 && manager.contains(-S + 1, -S + 1) && !manager.contains(-S - 1, 100) && !manager.contains(2 * S + 1, 100));
  const before = manager.version;
  manager.update(S - 1, 100);
  check('moving inside a chunk loads nothing', manager.version === before);
  manager.update(S + 1, 100);
  check('crossing into a new chunk loads a new column and drops the old one', manager.version === before + 1 && manager.active.size === 9 && manager.contains(3 * S - 1, 100) && !manager.contains(-1, 100));

  // A very long drive, every direction: memory must not creep up.
  let maxShapes = 0;
  let maxCells = 0;
  let maxCones = 0;
  let x = 0;
  let y = 0;
  const legs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (const [dx, dy] of legs) {
    for (let i = 0; i < 40; i += 1) {
      x += dx * S;
      y += dy * S;
      manager.update(x, y);
      maxShapes = Math.max(maxShapes, world.shapes.length);
      maxCells = Math.max(maxCells, world.grid.size);
      maxCones = Math.max(maxCones, manager.cones.length);
    }
  }
  const stillNine = manager.active.size === 9;
  check('after 320 chunk changes in all directions, still 9 chunks', stillNine, `at ${x},${y}`);
  const expected = [...manager.active.values()].reduce((n, c) => n + c.shapes.length, 0);
  check('collision shapes left behind are all removed', world.shapes.length === expected, `${world.shapes.length} shapes, expected ${expected}; most ever ${maxShapes}`);
  check('the collision grid stays small on endless drives', maxCells < 1500, `most ever ${maxCells} squares`);

  // Coming back to a chunk rebuilds the very same layout.
  const first = new ChunkManager(buildLayout(), new CS.StaticWorld());
  first.update(5000, 5000);
  const key = `${chunkCoord(5000)},${chunkCoord(5000)}`;
  const was = portable(first.active.get(key).data);
  first.update(90000, 90000);
  first.update(5000, 5000);
  check('coming back to a chunk finds the same layout', was === portable(first.active.get(key).data));
}

// Long bot drive through the real world, far past the old 6000-unit map in negative coordinates too.
{
  const s = newSim();
  s.reset(21);
  const cam = new Camera(SCREENS.portrait);
  cam.snap(s.player);
  const start = { x: s.player.x, y: s.player.y };
  s.player.reset(-40000, -40000, Math.PI / 4);
  s.player.launch(300);
  cam.snap(s.player);
  s.spawner.cooldown = 1e6;
  s.powerUps.timer = 1e6;
  for (let t = 0; t < 2; t += 1 / 60) s.step(1 / 60, { steer: 0 }, cam.follow(s.player, 1 / 60));
  check('far outside the old map, in negative coordinates, the world is there', s.chunks.active.size === 9 && s.chunks.cx < -10 && s.world.shapes.length > 20, `chunk ${s.chunks.cx},${s.chunks.cy}: ${s.world.shapes.length} shapes`);
  check('and the old start area is unloaded', !s.chunks.contains(start.x, start.y));
}

// ---- Holes and falling --------------------------------------------------------------------
const hole = (x, y, r = 80) => ({ kind: 'void', isVoid: true, x, y, heading: 0, collider: { type: 'circle', r }, breakable: false, outline: [] });
const quietView = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
function quietSim(items) {
  const s = new ChaseSimulation({ layout: fixedMap(items), handling });
  s.spawner.cooldown = 1e6;
  s.powerUps.timer = 1e6;
  return s;
}
function run(s, seconds, steer = 0) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) for (const e of s.step(1 / 60, { steer }, quietView)) events.push({ ...e });
  return events;
}

{
  const s = quietSim([hole(1000, 1000)]);
  s.player.reset(1000, 1300, 0);
  s.player.launch(300);
  run(s, 0.5);
  check('clipping the near edge of a hole is safe: only the car centre counts', !s.player.isFalling);
  s.player.reset(1000 + 90, 1300, 0);
  s.player.launch(300);
  run(s, 2);
  check('passing just beside a hole: no fall', !s.player.isFalling && s.state === 'running');
}
{
  const s = quietSim([hole(1000, 1000)]);
  s.player.reset(1000, 1300, 0);
  s.player.launch(300);
  const events = run(s, 1.0);
  const falling = s.player.isFalling;
  const timeAtFall = s.time;
  check('driving into a hole sets isFalling', falling && events.some((e) => e.type === 'fall'));
  const heading = s.player.heading;
  const speedBefore = s.player.speed;
  check('it is not over yet: the fall takes time', s.state === 'running');
  const y = s.player.y;
  const more = run(s, 0.2, 1);
  check('no steering while falling', Math.abs(s.player.heading - heading) < 1e-9);
  check('no engine while falling: the car slows down', s.player.speed < speedBefore);
  check('the survival clock stops at the edge', s.time === timeAtFall);
  run(s, T.VOID.fallSeconds + 0.1);
  check('fully fallen = BUSTED, cause void', s.state === 'crashed' && s.crash.cause === 'void', s.crash ? s.crash.cause : s.state);
  check('the fall reached the bottom', s.player.fallProgress === 1);
  check('no explosion from a fall', !more.some((e) => e.type === 'explosion'));
  s.reset(2);
  check('a new run clears the fall', !s.player.isFalling && s.player.fallProgress === 0 && s.state === 'running');
}
{
  const s = quietSim([hole(1000, 1000)]);
  s.player.reset(1000, 1300, 0);
  s.player.launch(300);
  const events = run(s, 1 + T.VOID.fallSeconds + 0.2);
  check('falling fires exactly one crash', events.filter((e) => e.type === 'crash').length === 1 && !events.some((e) => e.type === 'explosion'));
}
{
  // Police: fall in, count as wrecked, no explosion, then leave the map.
  const s = quietSim([hole(1000, 1000)]);
  s.player.reset(1800, 2000, 0);
  const p = s.spawnPolice(1000, 1250, 0, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0 });
  p.handling.maxTurnRateDeg = 0;
  const events = run(s, 1);
  check('police driving into a hole fall in and count as wrecked', p.state === 'wreck' && p.model.isFalling && s.stats.wrecks === 1, `${p.state}, wrecks ${s.stats.wrecks}`);
  check('a wreck event says it was the void, and nothing explodes', events.some((e) => e.type === 'wreck' && e.cause === 'void') && !events.some((e) => e.type === 'explosion'));
  run(s, T.VOID.fallSeconds + 0.2);
  check('a fallen police car returns to the pool', p.state === 'idle' && !s.bodies.includes(p));
}
{
  // A falling car can't be hit by anything or knock anything.
  const s = quietSim([hole(1000, 1000, 150)]);
  s.player.reset(1800, 2000, 0);
  const a = s.spawnPolice(1000, 1000, 0, { role: 'chaser', speedFactor: 1, turnDeg: 0, aimSide: 0 });
  const b = s.spawnPolice(1000, 1040, 0, { role: 'chaser', speedFactor: 1, turnDeg: 0, aimSide: 0 });
  const events = run(s, 0.2);
  check('cars falling together do not collide or explode', a.model.isFalling && b.model.isFalling && !events.some((e) => e.type === 'explosion'));
}
{
  // Police know about holes (imperfectly): the probes treat them as blocked.
  const world = new CS.StaticWorld([hole(0, 0, 50)]);
  check('holes count as not clear for spawns, crates and police probes', !world.isClear(0, 0, 20) && !world.isClear(60, 0, 20) && world.isClear(100, 0, 20));
}
{
  // Curbs aren't holes.
  const world = new CS.StaticWorld([{ kind: 'island', x: 0, y: 0, heading: 0, collider: { type: 'box', hw: 35, hl: 200 }, curb: true, breakable: false }]);
  check('curbs do not count as blocked', world.isClear(0, 0, 20));
}

// The fall itself.
{
  // It carries its speed onto the hole, and stops at the far wall.
  const big = hole(1000, 1000, 400);
  const s = quietSim([big]);
  s.player.reset(1000, 1420, 0);
  s.player.launch(300);
  run(s, 0.2);
  const y = s.player.y;
  check('a falling car carries its speed over the edge', s.player.isFalling && s.player.speed > 200, `speed ${s.player.speed.toFixed(0)}`);
  run(s, 0.3);
  check('and keeps travelling across', s.player.y < y - 60, `moved ${(y - s.player.y).toFixed(0)} units`);
  const small = hole(1000, 1000, 60);
  const t = quietSim([small]);
  t.player.reset(1000, 1100, 0);
  t.player.launch(300);
  let furthest = 0;
  for (let i = 0; i < 90; i += 1) {
    t.step(1 / 60, { steer: 0 }, quietView);
    if (t.player.isFalling) furthest = Math.max(furthest, Math.hypot(t.player.x - 1000, t.player.y - 1000));
  }
  check('it cannot pass through the far wall of a small hole', t.player.isFalling && furthest <= 60 && t.player.y > 1000 - 60, `at most ${furthest.toFixed(1)} from the middle`);
  check('it stops dead against it', t.player.speed < 1, `speed ${t.player.speed.toFixed(1)}`);
  check('the car knows which hole it is in', t.player.fallShape && t.player.fallShape.item === small);

  // A missing section of road, turned either way.
  const gapItem = { kind: 'void', isVoid: true, x: 1000, y: 1000, heading: Math.PI / 2, collider: { type: 'box', hw: 92, hl: 60 }, breakable: false, outline: [] };
  const g = quietSim([gapItem]);
  g.player.reset(1250, 1000, -Math.PI / 2);
  g.player.launch(300);
  run(g, 2);
  const hw = 92;
  check('the same in a missing section of road', g.player.isFalling && Math.abs(g.player.x - 1000) <= hw && Math.abs(g.player.y - 1000) <= 60, `${(g.player.x - 1000).toFixed(0)}, ${(g.player.y - 1000).toFixed(0)}`);

  // The near lip hides the car as it drops.
  const ring = [];
  for (let i = 0; i < 16; i += 1) ring.push({ x: 1000 + Math.cos((i / 16) * Math.PI * 2) * 100, y: 1000 + Math.sin((i / 16) * Math.PI * 2) * 100 });
  const centre = projection.toScreen(1000, 1000);
  const lip = holeLipY(ring, centre.x, projection);
  check('the lip of a hole is the near side of it on screen', lip > centre.y + 60 && lip < centre.y + 100 * projection.squash + 2, `${(lip - centre.y).toFixed(0)} below the middle`);
  check('beyond the hole\'s sides there is no lip', holeLipY(ring, centre.x + 400, projection) === Infinity);
  check('no outline, no lip', holeLipY([], centre.x, projection) === Infinity);
  check('the fall is drawn long enough to drop out of sight', T.VOID.fallDrop > T.VOID.sinkholeRadius[1] * 2 * projection.squash * 0.8);
}

// Wrecks clear away quickly.
check('wrecks are gone within a few seconds', T.WRECK.lifetime <= 4, `${T.WRECK.lifetime} s`);

// ---- Police recycling and spawning --------------------------------------------------------
{
  const s = quietSim([]);
  s.player.reset(1000, 1000, 0);
  s.player.launch(300);
  run(s, 1 / 60);
  const left = s.spawnPolice(1000 - S * 2.2, 1000, 0, { role: 'chaser', speedFactor: 1, turnDeg: 100, aimSide: 0 });
  const near = s.spawnPolice(1000 - S * 0.5, 1000, 0, { role: 'chaser', speedFactor: 1, turnDeg: 100, aimSide: 0 });
  const events = run(s, 2 / 60);
  check('police outside the 3 x 3 grid are recycled', left.state === 'idle' && events.some((e) => e.type === 'despawn' && e.police === left));
  check('police inside it stay', near.alive);
}
{
  // Real runs: every spawn is on a road, off screen and on a loaded chunk, and pools stay flat.
  const s = newSim();
  let spawns = 0;
  let onRoad = 0;
  let onScreen = 0;
  let unloaded = 0;
  let maxBodies = 0;
  let maxPool = 0;
  const causes = {};
  for (let seed = 200; seed < 215; seed += 1) {
    const r = playRun(s, {
      seed,
      skill: 1.3,
      maxSeconds: 90,
      onStep(sim, events, view) {
        for (const e of events) {
          if (e.type !== 'spawn') continue;
          spawns += 1;
          const fx = ((e.x % cell) + cell) % cell;
          const fy = ((e.y % cell) + cell) % cell;
          const along = Math.min(fx, cell - fx);
          const across = Math.min(fy, cell - fy);
          if (Math.min(along, across) <= margin) onRoad += 1;
          if (isOnScreen(e.x, e.y, view, 0)) onScreen += 1;
          if (!sim.chunks.contains(e.x, e.y)) unloaded += 1;
        }
        maxBodies = Math.max(maxBodies, sim.bodies.length);
        maxPool = Math.max(maxPool, sim.police.length);
      },
    });
    causes[r.cause] = (causes[r.cause] || 0) + 1;
  }
  check('police spawn along roads', spawns > 50 && onRoad === spawns, `${onRoad} of ${spawns}`);
  check('police never spawn on screen', onScreen === 0, `${onScreen} of ${spawns}`);
  check('police never spawn on an unloaded chunk', unloaded === 0);
  check('cars and police pools stay within their limits', maxBodies <= T.POLICE.maxCars + 1 && maxPool <= T.POLICE.maxCars + 1, `most cars ${maxBodies}, pool ${maxPool}; run endings ${JSON.stringify(causes)}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
