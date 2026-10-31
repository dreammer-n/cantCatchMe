// Checks for the set dressing and big crashes: word statues, road arrows, gardens, the gift box,
// tumbling wrecks, flying wreckage and siren beams.
import { ChaseSimulation, CS, T, fixedMap, projection } from './simkit.mjs';
import { glyphBars, glyphWidth } from '../src/render/blockFont.js';
import { carMesh } from '../src/render/carModels.js';
import { boundsOf, box, projectMesh, projectShadow } from '../src/render/lowpoly.js';
import * as props from '../src/render/propModels.js';
import { Tumble, stepChunk, stepHop } from '../src/render/Tumble.js';
import { beamGeometry } from '../src/systems/ThreatRadar.js';
import { buildChunk, propCatalogue } from '../src/systems/WorldLayout.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}
const { WORLD, TUMBLE, EFFECTS, WARNING, PALETTE, CHUNKS } = T;
const handling = T.HANDLING_PRESETS.balanced;
const chunks = [];
for (let cy = -14; cy < 14; cy += 1) for (let cx = -14; cx < 14; cx += 1) chunks.push(buildChunk(cx, cy));
const quietView = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };

// ---- Word statues ---------------------------------------------------------------------------
{
  const words = Object.keys(WORLD.landmarkColors);
  check('every statue word can be spelled', words.every((w) => [...w].every((l) => glyphBars(l))));
  check('every word a chunk can pick has a colour', Object.values(CHUNKS.presets).every((p) => p.landmarks.every((w) => WORLD.landmarkColors[w])));
  check('the requested words are there', ['MALL', 'STOP', 'GAMES', 'GAS'].every((w) => words.includes(w)));
  // Bars must not overlap: painted one over another, they would show through.
  let overlaps = 0;
  for (const letter of new Set(words.join(''))) {
    const bars = glyphBars(letter);
    for (let i = 0; i < bars.length; i += 1) {
      for (let j = i + 1; j < bars.length; j += 1) {
        const [a, b] = [bars[i], bars[j]];
        if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) overlaps += 1;
      }
    }
  }
  check('no two bars of a letter overlap', overlaps === 0, `${overlaps}`);

  const withStatue = chunks.filter((c) => c.items.some((i) => i.kind === 'letter'));
  check('most chunks have a landmark', withStatue.length > chunks.length * 0.5, `${withStatue.length} of ${chunks.length}`);
  check('every kind of chunk gets them', Object.keys(CHUNKS.presets).every((p) => withStatue.some((c) => c.preset === p)));
  const letters = chunks.flatMap((c) => c.items.filter((i) => i.kind === 'letter'));
  check('letters are solid: real obstacles', letters.every((l) => l.collider && !l.breakable && !l.curb));
  check('each letter is compact, so draw order stays right', letters.every((l) => l.collider.hw * 2 < 150), `widest ${Math.max(...letters.map((l) => l.collider.hw * 2))}`);
  const onPlinth = withStatue.every((c) => {
    const ls = c.items.filter((i) => i.kind === 'letter');
    const plinth = c.items.find((i) => i.kind === 'island' && i.x === ls[0].x && Math.abs(i.y - ls[0].y) < 300);
    return plinth && ls.every((l) => l.x === plinth.x && Math.abs(l.y - plinth.y) + l.collider.hw <= plinth.params.length / 2);
  });
  check('a word always fits on its plinth', onPlinth);
  const worldwide = new Set(propCatalogue().map((e) => e.model));
  check('all letters are drawn at startup', letters.every((l) => worldwide.has(l.model)));
  check('a word reads along a single line, in order, running north', withStatue.every((c) => {
    const ls = c.items.filter((i) => i.kind === 'letter');
    return ls.every((l, i) => i === 0 || l.y < ls[i - 1].y);
  }));

  // Reads left to right on screen, and rises: first letter lower left of the last.
  const c = withStatue.find((k) => k.items.filter((i) => i.kind === 'letter').length >= 4);
  const ls = c.items.filter((i) => i.kind === 'letter');
  const first = projection.toScreen(ls[0].x, ls[0].y);
  const last = projection.toScreen(ls[ls.length - 1].x, ls[ls.length - 1].y);
  check('on screen a word reads left to right, rising', last.x > first.x && last.y < first.y);
  // The side with the letter faces the camera, and the sun.
  const mesh = props.blockLetter('T', 0xd7142f);
  const named = projectMesh(mesh, ls[0].heading, projection).flatMap((p) => p.faces.map((f) => f.name));
  check('the face of each letter is toward the camera', named.includes('back') && named.includes('top'));
  check('letters are low-poly', propCatalogue().filter((e) => e.kind === 'letter').every((e) => props.blockLetter(e.params.letter, 0).length <= 6));
  check('letters stand far taller than a car', glyphWidth('M') * WORLD.letterUnit > 80 && 5 * WORLD.letterUnit > 30 * 2.5);

  // Physical: a letter is lethal head-on, can be scraped along.
  const hit = (angleDeg) => {
    const letter = { kind: 'letter', x: 1000, y: 1000, heading: (270 * Math.PI) / 180, collider: { type: 'box', hw: 170, hl: 13 }, breakable: false };
    const s = new ChaseSimulation({ layout: fixedMap([letter]), handling });
    s.spawner.cooldown = 1e6;
    s.spawner.nextRoadblock = 1e6;
    s.powerUps.timer = 1e6;
    const a = (angleDeg * Math.PI) / 180;
    s.player.reset(1000 + 13 + 42 + 60 * Math.cos(a), 1000 - 60 * Math.sin(a), -Math.PI / 2 + a);
    s.player.launch(300);
    for (let t = 0; t < 1.2 && s.state === 'running'; t += 1 / 60) s.step(1 / 60, { steer: 0 }, quietView);
    return s;
  };
  check('driving straight into a word at speed is a crash', hit(0).state === 'crashed' && hit(0).crash.cause === 'obstacle', hit(0).state);
  const glance = hit(-75);
  check('a shallow scrape along one is survivable', glance.state === 'running' && glance.player.speed > 200, `${glance.state}, speed ${glance.player.speed.toFixed(0)}`);
}

// ---- Graphics memory -----------------------------------------------------------------------
{
  // What the world's drawings take once they reach the graphics card, worked out from their sizes.
  let bytes = 0;
  const biggest = [];
  for (const entry of propCatalogue()) {
    const mesh = props.propMesh(entry);
    const body = boundsOf(projectMesh(mesh, entry.heading, projection));
    const shadow = boundsOf([], projectShadow(mesh, entry.heading, projection));
    const size = (b, scale) => (b.maxX - b.minX + 4) * (b.maxY - b.minY + 4) * scale * scale * 4;
    const total = size(body, props.propBakeScale(entry)) + size(shadow, T.RENDER.shadowBakeScale);
    bytes += total;
    biggest.push([entry.model, total]);
  }
  biggest.sort((a, b) => b[1] - a[1]);
  check('all the prop drawings stay within a phone-friendly budget', bytes < 16e6, `${(bytes / 1e6).toFixed(1)} MB; biggest: ${biggest[0][0]} ${(biggest[0][1] / 1e6).toFixed(2)} MB`);
}

// ---- Gardens, arrows ------------------------------------------------------------------------
{
  const trees = (c) => c.items.filter((i) => i.kind === 'tree').length;
  const islands = (c) => c.items.filter((i) => i.kind === 'island').length;
  const average = (list, f) => list.reduce((n, c) => n + f(c), 0) / list.length;
  const parking = chunks.filter((c) => c.preset === 'parking');
  check('parking chunks are planted, not bare', average(parking, trees) > 12 && average(parking, islands) > 10, `${average(parking, trees).toFixed(1)} trees, ${average(parking, islands).toFixed(1)} medians a chunk`);
  const allProps = average(chunks, (c) => c.items.length);
  check('the world is busier than before (about 48 props a chunk)', allProps > 55, `${allProps.toFixed(0)} props a chunk`);

  const inCell = chunks.every((c) => c.items.filter((i) => i.kind === 'island').every((i) => {
    const hx = Math.abs(i.heading) < 0.01 ? 35 : i.params.length / 2;
    const hy = Math.abs(i.heading) < 0.01 ? i.params.length / 2 : 35;
    const fx = ((i.x - c.x0) % WORLD.cell) + 0;
    const fy = ((i.y - c.y0) % WORLD.cell) + 0;
    return fx - hx > 60 && fx + hx < WORLD.cell - 60 && fy - hy > 60 && fy + hy < WORLD.cell - 60;
  }));
  check('medians stay within their blocks, clear of the road', inCell);

  const arrows = chunks.flatMap((c) => c.paint.filter((m) => m.arrow).map((m) => ({ m, c })));
  check('roads have painted arrows', arrows.length > chunks.length * 3, `${(arrows.length / chunks.length).toFixed(1)} a chunk`);
  let offRoad = 0;
  let wrongLane = 0;
  let outside = 0;
  let crossing = 0;
  for (const { m, c } of arrows) {
    const fx = ((m.x % WORLD.cell) + WORLD.cell) % WORLD.cell;
    const fy = ((m.y % WORLD.cell) + WORLD.cell) % WORLD.cell;
    const dx = Math.min(fx, WORLD.cell - fx);
    const dy = Math.min(fy, WORLD.cell - fy);
    if (Math.min(dx, dy) > WORLD.margin) offRoad += 1;
    // Traffic keeps right: the lane is on the right of the road's centre line, seen along the arrow.
    const rx = Math.cos(m.heading);
    const ry = Math.sin(m.heading);
    const nx = Math.round(m.x / WORLD.cell) * WORLD.cell;
    const ny = Math.round(m.y / WORLD.cell) * WORLD.cell;
    const off = dx < dy ? (m.x - nx) * rx : (m.y - ny) * ry;
    if (off <= 0) wrongLane += 1;
    if (m.x < c.x0 || m.x >= c.x0 + CHUNKS.size || m.y < c.y0 || m.y >= c.y0 + CHUNKS.size) outside += 1;
    const edge = T.SCENERY.floorChunk;
    const near = (v) => {
      const f = ((v % edge) + edge) % edge;
      return Math.min(f, edge - f) < WORLD.arrowLength / 2;
    };
    if (near(m.x) || near(m.y)) crossing += 1;
  }
  check('arrows are on the road', offRoad === 0, `${offRoad} off`);
  check('arrows point the way traffic drives in that lane', wrongLane === 0, `${wrongLane} wrong`);
  check('arrows stay on their own chunk', outside === 0);
  check('arrows never cross a floor-square border, so never get cut', crossing === 0);
}

// ---- The lucky die --------------------------------------------------------------------------
{
  const die = props.luckyDie(0);
  check('the die is violet, with cream spots', (PALETTE.crate & 255) > 200 && ((PALETTE.crate >> 8) & 255) < 110 && ((PALETTE.cratePip >> 8) & 255) > 200);
  const spotsShown = (mesh) => projectMesh(mesh, 0, projection).flatMap((p) => p.faces).reduce((n, f) => n + f.decals.length, 0);
  check('its spots show on all three faces in view', projectMesh(die, 0, projection).flatMap((p) => p.faces).filter((f) => f.decals.length > 0).length === 3, `${spotsShown(die)} spots`);
  props.DIE_ROLLS.forEach((roll, i) => {
    const expected = roll[0] + roll[1] + roll[2];
    check(`roll ${i + 1} shows the numbers it should`, spotsShown(props.luckyDie(i)) === expected, `${roll.join(' ')}: ${spotsShown(props.luckyDie(i))} spots`);
  });
  check('each roll looks different, so it seems to tumble', new Set(props.DIE_ROLLS.map((r) => r.join())).size === props.DIE_ROLLS.length);
  const lum = (c) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
  check('it stands out on the road', lum(PALETTE.crate) > lum(PALETTE.asphalt) * 2);
  const hue = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const [r, , b] = hue(PALETTE.crateArrow);
  check('the arrow to it stays teal, so it is never mistaken for a red warning', b > r, PALETTE.crateArrow.toString(16));
  const wood = props.woodCrate();
  check('wooden crates are still brown, and different', wood[0].faces[0].color !== die[0].faces[0].color);
}

// ---- Tumbling -------------------------------------------------------------------------------
{
  const sequence = (values) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  // Random values, in order: height, roof or not, roll direction, spin.
  const run = (values, dt) => {
    const t = new Tumble();
    t.start(sequence(values));
    let peak = 0;
    let steps = 0;
    let lowest = Infinity;
    let wasUpside = false;
    let minSquash = 1;
    while (t.active && steps < 10000) {
      t.update(dt);
      peak = Math.max(peak, t.z);
      lowest = Math.min(lowest, t.z);
      wasUpside = wasUpside || t.upsideDown;
      minSquash = Math.min(minSquash, t.squash);
      steps += 1;
    }
    return { t, peak, lowest, steps, wasUpside, minSquash };
  };
  const roof = run([0.5, 0, 0.9, 0.5], 1 / 60);
  check('a wreck leaves the ground', roof.peak >= TUMBLE.hopMin * 0.95 && roof.peak <= TUMBLE.hopMax, `height ${roof.peak.toFixed(0)}`);
  check('never below the road', roof.lowest >= 0);
  check('it lands: back on the road, finished', !roof.t.active && roof.t.z === 0);
  check('it can land on its roof', roof.t.upsideDown && Math.abs(Math.abs(roof.t.roll) - Math.PI) < 1e-9);
  const round = run([0.5, 0.99, 0.1, 0.5], 1 / 60);
  check('or roll all the way round, back on its wheels', !round.t.upsideDown && round.wasUpside && Math.abs(Math.abs(round.t.roll) - Math.PI * 2) < 1e-9);
  check('it visibly rolls, thinning side-on', roof.minSquash === TUMBLE.minSquash);
  const seconds = roof.steps / 60;
  check('the whole thing is quick', seconds > 0.6 && seconds < 1.2, `${seconds.toFixed(2)} s`);
  const slow = run([0.5, 0, 0.9, 0.5], 1 / 240);
  const fast = run([0.5, 0, 0.9, 0.5], 1 / 30);
  check('the same at any frame rate', Math.abs(slow.steps / 240 - fast.steps / 30) < 0.05 && slow.t.roll === fast.t.roll);
  const idle = new Tumble();
  idle.update(1);
  check('a car that never crashed does nothing', !idle.active && idle.z === 0 && idle.roll === 0 && idle.squash === 1);

  // The upside-down wreck is really upside down.
  const up = carMesh('wreck');
  const down = carMesh('wreckRoof');
  const wheels = (mesh) => mesh.filter((p) => p.tag === 'wheel').flatMap((p) => p.verts.map((v) => v[2]));
  const height = Math.max(...up.flatMap((p) => p.verts.map((v) => v[2])));
  check('on its roof, the wheels are at the top', Math.min(...wheels(down)) > height * 0.45);
  check('and the roof sits on the road', Math.min(...down.flatMap((p) => p.verts.map((v) => v[2]))) === 0 && Math.max(...down.flatMap((p) => p.verts.map((v) => v[2]))) === height);
  check('it is drawn with few directions, to save memory', T.RENDER.carDirections.wreckRoof <= 16);
  // From every direction there must be something solid facing up: it is not a hollow shell.
  let hollow = 0;
  for (let i = 0; i < 16; i += 1) {
    const parts = projectMesh(down, (i * Math.PI * 2) / 16, projection);
    const under = parts.filter((p) => p.faces.some((f) => f.name === 'top') && p.cam.some((c) => c.z > height - 6) && Math.abs(Math.max(...p.cam.map((c) => c.u)) - Math.min(...p.cam.map((c) => c.u))) > 40);
    if (under.length === 0) hollow += 1;
  }
  check('upside down, it has a solid underside from every direction', hollow === 0, `${hollow} hollow`);
  check('flipping one wreck leaves the upright one alone', Math.max(...wheels(up)) < height * 0.55);
}

// ---- Wreckage -------------------------------------------------------------------------------
{
  const chunk = { x: 0, y: 0, z: 16, vx: 200, vy: 0, vz: 300, spin: 10, angle: 0 };
  let peak = 0;
  let landings = 0;
  let was = chunk.z;
  let dtLeft = 3;
  while (dtLeft > 0) {
    stepChunk(chunk, 1 / 60, EFFECTS.chunkGravity, EFFECTS.chunkBounce, EFFECTS.chunkScrape);
    peak = Math.max(peak, chunk.z);
    if (chunk.z === 0 && was > 0) landings += 1;
    was = chunk.z;
    dtLeft -= 1 / 60;
  }
  check('a chunk flies up', peak > 60, `${peak.toFixed(0)} units`);
  check('and bounces', landings >= 2, `${landings} landings`);
  check('and comes to rest on the road', chunk.z === 0 && chunk.vz === 0);
  check('having flown outward', chunk.x > 100, `${chunk.x.toFixed(0)} units`);
  check('it has stopped, more or less', Math.abs(chunk.vx) < 40, `${chunk.vx.toFixed(0)} units/s`);
  // A tire keeps bouncing where a panel thuds down, and rolls on further.
  const flight = (bounce, scrape) => {
    const c = { x: 0, y: 0, z: 16, vx: 200, vy: 0, vz: 400, spin: 5, angle: 0 };
    let hits = 0;
    let before = c.z;
    let secondPeak = 0;
    for (let t = 0; t < 2.6; t += 1 / 60) {
      stepChunk(c, 1 / 60, EFFECTS.chunkGravity, bounce, scrape);
      if (c.z === 0 && before > 0) hits += 1;
      if (hits === 1) secondPeak = Math.max(secondPeak, c.z);
      before = c.z;
    }
    return { hits, secondPeak, x: c.x };
  };
  const tire = flight(EFFECTS.tireBounce, EFFECTS.tireScrape);
  const panel = flight(EFFECTS.chunkBounce, EFFECTS.chunkScrape);
  check('a flying tire bounces again and again', tire.hits >= 4, `${tire.hits} bounces`);
  check('more than a panel, and higher', tire.hits > panel.hits && tire.secondPeak > panel.secondPeak * 1.8, `second bounce ${tire.secondPeak.toFixed(0)} against ${panel.secondPeak.toFixed(0)} high`);
  check('and rolls on further', tire.x > panel.x * 1.5, `${tire.x.toFixed(0)} against ${panel.x.toFixed(0)} units`);
  const squashed = { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: -400, spin: 0, angle: 0 };
  stepChunk(squashed, 1 / 60, EFFECTS.chunkGravity, EFFECTS.tireBounce, EFFECTS.tireScrape);
  check('it flattens as it lands', squashed.squash > 0.2, `${squashed.squash.toFixed(2)}`);
  check('it has a shadow to show its height', EFFECTS.chunkShadowRadius > 0 && EFFECTS.chunkShadowAlpha > 0.3);

  // A knock makes the car jump on its wheels and land again.
  const hop = { z: 0, v: T.BODY_LEAN.hopSpeed };
  let top = 0;
  let landings2 = 0;
  let upBefore = true;
  for (let t = 0; t < 1.2; t += 1 / 60) {
    stepHop(hop, 1 / 60, T.BODY_LEAN.hopGravity, T.BODY_LEAN.hopBounce);
    top = Math.max(top, hop.z);
    if (hop.z === 0 && upBefore) landings2 += 1;
    upBefore = hop.z > 0;
  }
  check('a hard knock bounces the car a little', top > 5 && top < 15, `${top.toFixed(1)} units high`);
  check('and it lands and stays down', landings2 >= 2 && hop.z === 0 && hop.v === 0, `${landings2} landings`);

  // Round wheels, and a car that holds together.
  const whole = carMesh('player');
  const round = whole.filter((p) => p.tag === 'wheel');
  check('wheels are round, not boxes', round.length === 4 && round.every((w) => {
    const ys = w.verts.map((v) => v[1]);
    const zs = w.verts.map((v) => v[2]);
    return w.faces.length >= 10 && Math.abs(Math.max(...ys) - Math.min(...ys) - (Math.max(...zs) - Math.min(...zs))) < 1.5;
  }));
  check('they stand on the road', round.every((w) => Math.min(...w.verts.map((v) => v[2])) === 0));
  const bodySheet = carMesh('playerBody');
  const wheelSheet = carMesh('playerWheels');
  check('the two drawings add up to the whole car', bodySheet.length + wheelSheet.length === whole.length);
  check('only the wheels are separate: the lower body and bumpers move with the body', wheelSheet.every((p) => p.tag === 'wheel') && bodySheet.some((p) => Math.min(...p.verts.map((v) => v[2])) <= T.CAR_MODEL.sillBottom));
  check('the body never moves far from its wheels', T.BODY_LEAN.rollShift * (1 - T.BODY_LEAN.wheelsFollow) <= 2.5, `${(T.BODY_LEAN.rollShift * (1 - T.BODY_LEAN.wheelsFollow)).toFixed(1)} units at most`);

  check('3 to 4 pieces per wreck', EFFECTS.chunksSmall >= 3 && EFFECTS.chunksSmall <= 4);
  check('a capped number of pieces and rings, so pile-ups stay cheap', EFFECTS.maxChunks <= 30 && EFFECTS.maxRings <= 8);
}

// ---- A wreck doesn't just stop ---------------------------------------------------------------
{
  const s = new ChaseSimulation({ layout: fixedMap([]), handling });
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.powerUps.timer = 1e6;
  s.player.reset(1800, 2000, 0);
  const p = s.spawnPolice(1000, 1000, 0, { role: 'chaser', speedFactor: 1, turnDeg: 100, aimSide: 0, launchShare: 0 });
  s.wreckPolice(p, 'obstacle');
  const start = { x: p.model.x, y: p.model.y, heading: p.model.heading };
  const speed = p.model.speed;
  check('a stopped car that is wrecked still gets shoved', speed > 100, `${speed.toFixed(0)} units/s`);
  for (let t = 0; t < 1; t += 1 / 60) s.step(1 / 60, { steer: 0 }, quietView);
  check('it slides', Math.hypot(p.model.x - start.x, p.model.y - start.y) > 20, `${Math.hypot(p.model.x - start.x, p.model.y - start.y).toFixed(0)} units`);
  check('and turns as it goes', p.model.heading !== start.heading);
  for (let t = 0; t < 1.5; t += 1 / 60) s.step(1 / 60, { steer: 0 }, quietView);
  check('and then it stops', p.model.speed < 5 && p.state === 'wreck', `${p.model.speed.toFixed(1)}`);
  // Falling into a hole is no such thing.
  const q = s.spawnPolice(1200, 1000, 0, { role: 'chaser', speedFactor: 1, turnDeg: 100, aimSide: 0, launchShare: 0 });
  q.model.startFall();
  s.wreckPolice(q, 'void');
  check('cars that fall in a hole are not thrown', q.model.speed === 0);
}

// ---- Siren beams ----------------------------------------------------------------------------
{
  const out = { angle: 0, length: 0, width: 0 };
  beamGeometry({ x: 1000, y: 0 }, { x: 0, y: 0 }, out);
  check('a beam points from the car to the player', Math.abs(Math.abs(out.angle) - Math.PI) < 1e-9);
  check('and stops short of the player', out.length === 1000 * WARNING.beamReach);
  beamGeometry({ x: 5000, y: 0 }, { x: 0, y: 0 }, out);
  check('and has a limit', out.length === WARNING.beamMaxLength);
  beamGeometry({ x: 0, y: -600 }, { x: 0, y: 0 }, out);
  check('coming from the north, it points south', Math.abs(out.angle - Math.PI / 2) < 1e-9);
  check('there is one beam per warning at most: a bounded cost', WARNING.maxShown <= 6);
  const blocked = new CS.StaticWorld([{ kind: 'letter', x: 0, y: 0, heading: 0, collider: { type: 'box', hw: 30, hl: 13 }, breakable: false }]);
  check('(police know to avoid letters)', !blocked.isClear(0, 0, 10));
  void box;
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
