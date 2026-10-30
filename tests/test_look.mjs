// Checks for the comic-arcade look: light and shadows, palette, parked cars, hit-stop.
import { ChaseSimulation, CS, T, buildLayout, fixedMap, projection } from './simkit.mjs';
import { box, brightness, projectMesh } from '../src/render/lowpoly.js';
import * as props from '../src/render/propModels.js';
import { HitStop } from '../src/systems/HitStop.js';
import { buildChunk } from '../src/systems/WorldLayout.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}
const { PALETTE, RENDER, WORLD, SCENERY, CONES, HITSTOP, SKIDS } = T;
const handling = T.HANDLING_PRESETS.balanced;

// ---- Light and shadows ----------------------------------------------------------------------
{
  const height = 100;
  const shadow = projection.shadowOffset(height);
  const length = Math.hypot(shadow.x, shadow.y) / height;
  check('shadows on the ground are 1.0 to 1.3 x the height of what casts them', length >= 1 && length <= 1.3, `${length.toFixed(2)} x`);
  const a = projection.toScreen(0, 0);
  const b = projection.toScreen(shadow.x, shadow.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  check('they fall to the upper left on screen', dx < 0 && dy < 0 && Math.abs(dx) > Math.abs(dy), `screen ${dx.toFixed(0)}, ${dy.toFixed(0)}`);
  const up = brightness([0, 0, 1]);
  const lit = brightness([1, 0, 0]);
  const shade = brightness([0, 1, 0]);
  check('tops are brightest, one side clearly lit, the other in shade', up > lit && lit > shade * 1.2, `top ${up.toFixed(2)}, lit ${lit.toFixed(2)}, shaded ${shade.toFixed(2)}`);
  const faces = Object.fromEntries(projectMesh([box(-20, 20, -20, 20, 0, 40, 0xb0b0b0)], 0, projection)[0].faces.map((f) => [f.name, f.color & 255]));
  check('a box from the game camera shows that too', faces.top > faces.right && faces.right > faces.back, JSON.stringify(faces));
}

// ---- Palette --------------------------------------------------------------------------------
{
  const lum = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
  check('asphalt is the requested deep slate', PALETTE.asphalt === 0x2f3640);
  check('curbs and medians are the requested gold and yellow', PALETTE.curb === 0xf39c12 && PALETTE.median === 0xf1c40f);
  check('paint stands out clearly on the road', lum(PALETTE.paintWhite) > lum(PALETTE.asphalt) * 4);
  check('blocks are still lighter than roads, so the street plan reads', lum(PALETTE.lot) > lum(PALETTE.asphalt));
  check('holes are still far darker than the road', lum(PALETTE.void) < lum(PALETTE.asphalt) / 3);
  check('the rim of a hole stands out from the road', lum(PALETTE.voidRim) > lum(PALETTE.lot) * 1.5);
  const red = PALETTE.playerBody;
  check('the player car is saturated red', ((red >> 16) & 255) > 180 && ((red >> 8) & 255) < 50 && (red & 255) < 70);
  check('police are white with navy', lum(PALETTE.policeBody) > 230 && lum(PALETTE.policeStripe) < 60);
}

// ---- Parked cars ----------------------------------------------------------------------------
{
  const chunks = [];
  for (let cy = -14; cy < 14; cy += 1) for (let cx = -14; cx < 14; cx += 1) chunks.push(buildChunk(cx, cy));
  const parking = chunks.filter((c) => c.preset === 'parking');
  const others = chunks.filter((c) => c.preset !== 'parking');
  const inParking = parking.flatMap((c) => c.items.filter((i) => i.kind === 'civilian'));
  check('parking chunks have parked cars', inParking.length > parking.length * 3, `${inParking.length} in ${parking.length} chunks`);
  check('other chunks have parking too only where there are islands', others.every((c) => c.items.every((i) => i.kind !== 'civilian') || c.items.some((i) => i.kind === 'island')));
  check('vans, hatchbacks and sedans all appear', new Set(inParking.map((i) => i.params.shape)).size === 3);
  check('each in its own colour: teal, pink, yellow', new Set(inParking.map((i) => `${i.params.shape}:${i.params.color}`)).size === 3);
  const perChunk = parking.map((c) => c.items.filter((i) => i.kind === 'civilian').length);
  check('only some stalls are taken: occasional, not a wall of cars', Math.max(...perChunk) < 40, `at most ${Math.max(...perChunk)} per chunk`);

  // In a stall: the middle of a space between two painted lines, clear of the island.
  let badStall = 0;
  for (const c of parking) {
    const islands = c.items.filter((i) => i.kind === 'island');
    for (const car of c.items.filter((i) => i.kind === 'civilian')) {
      const island = islands.find((s) => {
        const ns = Math.abs(s.heading) < 0.01;
        const across = Math.abs(ns ? car.x - s.x : car.y - s.y);
        const along = Math.abs(ns ? car.y - s.y : car.x - s.x);
        return across > 35 && across < 35 + 6 + SCENERY.stallLength && along < s.params.length / 2;
      });
      if (!island) {
        badStall += 1;
        continue;
      }
      const ns = Math.abs(island.heading) < 0.01;
      const across = Math.abs(ns ? car.x - island.x : car.y - island.y);
      const middle = 35 + 6 + SCENERY.stallLength / 2;
      const facesAcross = ns ? Math.abs(Math.sin(car.heading)) > 0.99 : Math.abs(Math.cos(car.heading)) > 0.99;
      if (Math.abs(across - middle) > 1 || !facesAcross) badStall += 1;
    }
  }
  check('every parked car sits in a stall, in line with it', badStall === 0, `${badStall} misplaced of ${inParking.length}`);

  // Non-lethal for everyone, and worth hitting.
  const car = inParking[0];
  const smash = (item, setup) => {
    const s = new ChaseSimulation({ layout: fixedMap([item]), handling });
    s.spawner.cooldown = 1e6;
    s.spawner.nextRoadblock = 1e6;
    s.powerUps.timer = 1e6;
    const view = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
    const body = setup(s);
    const events = [];
    let slowest = Infinity;
    for (let t = 0; t < 1; t += 1 / 60) {
      for (const e of s.step(1 / 60, { steer: 0 }, view)) events.push(e);
      slowest = Math.min(slowest, body.model ? body.model.speed : body.speed);
    }
    return { s, events, slowest, body };
  };
  const parked = { ...car, x: 1000, y: 1000, heading: Math.PI / 2 };
  const head = smash(parked, (s) => {
    s.player.reset(1000, 1250, 0);
    s.player.launch(300);
    return s.player;
  });
  check('the player smashing one at full speed is not a crash', head.s.state === 'running');
  check('it is knocked away', head.s.cones[0].state !== 'standing', head.s.cones[0].state);
  check('it costs real speed, more than a cone', head.slowest < 300 * CONES.slowdown - 10 && head.slowest > 200, `slowest ${head.slowest.toFixed(0)}`);
  check('the hit is reported for effects', head.events.some((e) => e.type === 'cone' && e.player && e.cone.item.kind === 'civilian'));
  check('it gets pushed the way the car was going', head.s.cones[0].y < parked.y);
  const clip = smash(parked, (s) => {
    s.player.reset(1030, 1250, 0);
    s.player.launch(300);
    return s.player;
  });
  const mid = smash(parked, (s) => {
    s.player.reset(970, 1250, 0);
    s.player.launch(300);
    return s.player;
  });
  check('it is shoved aside, to the side it was hit on', clip.s.cones[0].x < parked.x - 30 && mid.s.cones[0].x > parked.x + 30, `${(clip.s.cones[0].x - parked.x).toFixed(0)} / ${(mid.s.cones[0].x - parked.x).toFixed(0)}`);
  const cop = smash(parked, (s) => {
    s.player.reset(1600, 1900, 0);
    const p = s.spawnPolice(1000, 1250, 0, { role: 'chaser', speedFactor: 1.1, turnDeg: 0, aimSide: 0, launchShare: 1 });
    p.handling.maxTurnRateDeg = 0;
    return p;
  });
  check('police smash them too, and survive', cop.body.alive && cop.s.cones[0].state !== 'standing' && cop.events.some((e) => e.type === 'cone' && !e.player));

  // The collider really is car-sized: the nose of a parked car counts, not only its middle.
  const world = new CS.StaticWorld([parked]);
  const shape = world.shapes[0];
  const out = { nx: 0, ny: 0, depth: 0 };
  check('the whole car can be hit, nose to tail', CS.circleVsShape(1000 + 50, 1000, 21, shape, out) && CS.circleVsShape(1000 - 50, 1000, 21, shape, out));
  check('parked cars do not stop police or spawns', world.isClear(1000, 1000, 40));
}

// ---- Hit-stop -------------------------------------------------------------------------------
{
  const frames = (ms, frame) => {
    const h = new HitStop();
    h.trigger(ms);
    let frozen = 0;
    while (h.update(frame) && frozen < 100) frozen += 1;
    return frozen;
  };
  check('at 60 fps a freeze is 2 frames', frames(HITSTOP.bumpMs, 1000 / 60) === 2, `${frames(HITSTOP.bumpMs, 1000 / 60)} frames`);
  check('every hit-stop is in the 35-45 ms range', [HITSTOP.scrapeMs, HITSTOP.bumpMs, HITSTOP.smashMs, HITSTOP.comboMs].every((ms) => ms >= 35 && ms <= 45));
  const at30 = frames(HITSTOP.bumpMs, 1000 / 30);
  check('at 30 fps it is about as long in real time', at30 === 1, `${at30} frame = ${(at30 * 1000) / 30} ms`);
  const at120 = frames(HITSTOP.bumpMs, 1000 / 120);
  check('at 120 fps too', at120 >= 3 && at120 <= 4, `${at120} frames = ${((at120 * 1000) / 120).toFixed(0)} ms`);

  const at15 = frames(HITSTOP.bumpMs, 1000 / 15);
  check('on a very slow device it still freezes one frame', at15 === 1, `${at15} frame`);

  const h = new HitStop();
  check('nothing freezes until something triggers it', !h.update(16));
  check('a hit starts a freeze', h.trigger(40));
  check('a second hit straight after does not: no stutter in a swarm', !h.trigger(40));
  let time = 0;
  while (h.cooldown > 0) {
    h.update(16);
    time += 16;
  }
  check('after the cooldown it can punch again', h.trigger(40) && time >= HITSTOP.cooldownMs, `${time} ms`);
  h.reset();
  check('a new run clears it', h.remaining === 0 && h.cooldown === 0 && !h.update(16));

  // Over a long swarm with a hit every frame, the game can't spend long frozen.
  const swarm = new HitStop();
  let frozenFrames = 0;
  const total = 60 * 20;
  for (let i = 0; i < total; i += 1) {
    swarm.trigger(HITSTOP.comboMs);
    if (swarm.update(1000 / 60)) frozenFrames += 1;
  }
  check('even with non-stop hits, at most a small share of the time is frozen', frozenFrames / total < 0.15, `${((frozenFrames / total) * 100).toFixed(0)}%`);
}

// ---- Skid marks -----------------------------------------------------------------------------
{
  check('rubber stays on the road for longer', SKIDS.lifetimeMs >= 5000, `${SKIDS.lifetimeMs / 1000} s`);
  // Spacing x speed gives marks per second per tyre. A drifting car has 2 tyres marking.
  const perCar = (300 / SKIDS.minSegmentLength) * 2;
  const seconds = SKIDS.maxMarks / (perCar * 2);
  check('the pool can hold two cars drifting flat out for the whole time before reusing marks', seconds * 1000 >= SKIDS.lifetimeMs, `${seconds.toFixed(1)} s of marks`);
}

// ---- Layout is still sound ------------------------------------------------------------------
{
  const layout = buildLayout();
  const a = layout.chunkAt(4, -7);
  const b = layout.chunkAt(4, -7);
  check('chunks still come back the same with parked cars in them', JSON.stringify(a.items.map((i) => [i.model, i.x, i.y])) === JSON.stringify(b.items.map((i) => [i.model, i.x, i.y])));
  check('there is no grass left on islands in the palette', PALETTE.grass === undefined && WORLD.parkedCarChance > 0 && RENDER.shadowLength === 1);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
