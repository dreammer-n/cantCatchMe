// Checks for the coin economy, the garage and the cars.
import { Car, ChaseSimulation, T, fixedMap, projection } from './simkit.mjs';
import { atlasLayout, directionsFor, measureCar } from '../src/render/carAtlas.js';
import { carMesh, carShadowPoints } from '../src/render/carModels.js';
import { PLAYER_CAR_IDS } from '../src/render/playerCars.js';
import { projectMesh } from '../src/render/lowpoly.js';
import { Projection } from '../src/render/projection.js';
import { PlatformManager } from '../src/platform/PlatformManager.js';
import { propMesh } from '../src/render/propModels.js';
import { canDisplay } from '../src/ui/displayFont.js';
import { Garage, Maps, RunStats, coinsForRun, formatClock, formatDistance, starsFor } from '../src/systems/ScoreSystem.js';
import { buildChunk, buildLayout, propCatalogue } from '../src/systems/WorldLayout.js';
import { groundMarksFor } from '../src/render/softShapes.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}
const { CARS, CRASH, COLLISION, GIANT, HANDLING_PRESETS, MAPS, RENDER, carById, carSpecs, handlingFor } = T;
const offView = { cx: -1e6, cy: -1e6, halfW: 1, halfH: 1 };
const mapColorOf = T.mapColor;

// ---- What a run earns ----
{
  const c = coinsForRun({ time: 41.7, wrecks: 12, combo: 3 });
  check('time pays 2 a second, rounded down', c.time === 83, `${c.time}`);
  check('each police car wrecked pays 5', c.wrecks === 60);
  check('the best combo pays 10 a step', c.combo === 30);
  check('and they add up', c.total === 173, `${c.total}`);
  check('a run with nothing earns nothing', coinsForRun({ time: 0, wrecks: 0, combo: 0 }).total === 0);
  const stats = new RunStats();
  stats.time = 10;
  stats.addWreck();
  stats.addWreck();
  check('real run stats work', coinsForRun(stats.summary()).total === 20 + 10 + 20, `${coinsForRun(stats.summary()).total}`);
}

// ---- Buying and choosing ----
{
  Garage.restore(0, [], null);
  check('everyone starts with the coupe, selected', Garage.selected === 'coupe' && Garage.owns('coupe') && Garage.car().price === 0);
  check('no money, no car', !Garage.canBuy('hatchback') && !Garage.buy('hatchback') && !Garage.owns('hatchback'));
  check('a locked car can\'t be selected', !Garage.select('hatchback') && Garage.selected === 'coupe');
  Garage.award(499);
  check('one coin short still isn\'t enough', !Garage.buy('hatchback') && Garage.coins === 499);
  Garage.award(1.9);
  check('coins are whole numbers', Garage.coins === 500, `${Garage.coins}`);
  check('awards can\'t take coins away', (Garage.award(-100), Garage.coins === 500));
  check('exactly enough buys it', Garage.buy('hatchback') && Garage.owns('hatchback') && Garage.coins === 0);
  Garage.award(1000);
  check('a car can\'t be bought twice', !Garage.buy('hatchback') && Garage.coins === 1000);
  check('buying alone doesn\'t change the selection', Garage.selected === 'coupe');
  check('an owned car can be selected', Garage.select('hatchback') && Garage.car().id === 'hatchback');
  check('a car that doesn\'t exist can\'t be bought', !Garage.buy('spaceship') && Garage.coins === 1000);
  let told = 0;
  const stop = Garage.onChange(() => { told += 1; });
  Garage.award(1);
  stop();
  Garage.award(1);
  check('screens hear about changes, until they stop listening', told === 1);

  // Saved, and read back through the platform layer.
  Garage.restore(2500, ['coupe', 'van'], 'van');
  Garage.save();
  const saved = {
    coins: await PlatformManager.getStoredValue(T.STORAGE_KEYS.totalCoins),
    cars: await PlatformManager.getStoredValue(T.STORAGE_KEYS.unlockedCars),
    car: await PlatformManager.getStoredValue(T.STORAGE_KEYS.selectedCar),
  };
  check('it saves through the platform', saved.coins === 2500 && saved.cars.includes('van') && saved.car === 'van', JSON.stringify(saved));
  Garage.restore(0, [], null);
  await Garage.load();
  check('and comes back', Garage.coins === 2500 && Garage.owns('van') && Garage.selected === 'van');

  // Damaged saves.
  for (const [what, coins, cars, selected] of [
    ['negative coins', -50, ['coupe'], 'coupe'],
    ['nonsense coins', NaN, 'cars', 'tank'],
    ['Infinity', Infinity, null, 7],
    ['a locked car selected', 10, ['coupe'], 'tank'],
    ['an unknown car', 10, ['coupe', 'batmobile'], 'batmobile'],
    ['no coupe in the list', 10, ['van'], 'coupe'],
  ]) {
    Garage.restore(coins, cars, selected);
    check(`a damaged save (${what}) is made safe`, Number.isInteger(Garage.coins) && Garage.coins >= 0 && Garage.owns('coupe') && Garage.owns(Garage.selected) && Garage.unlocked.every((id) => CARS.some((c) => c.id === id)), `${Garage.coins}, ${Garage.selected}`);
  }
  Garage.restore(0, [], null);
}

// ---- The advert ----
{
  check('with no platform, the ad is simulated', PlatformManager.rewardedAdMode() === 'simulated');
  check('asking for a real one without a platform gives no reward', (await PlatformManager.showRewardedAd()) === false);
}

// ---- The list of cars ----
{
  const named = { coupe: 0, hatchback: 500, van: 1500, highway: 3000, ram: 5000 };
  check('the five named cars cost what was asked', Object.entries(named).every(([id, price]) => carById(id).price === price));
  check('the coupe is free and first', CARS[0].id === 'coupe' && CARS[0].price === 0);
  check('prices only go up', CARS.every((c, i) => i === 0 || c.price > CARS[i - 1].price));
  check('the top price is 100,000', CARS[CARS.length - 1].price === 100000);
  check('every car has its model, and every model its car', CARS.every((c) => PLAYER_CAR_IDS.includes(c.id)) && PLAYER_CAR_IDS.length === CARS.length, `${CARS.length} cars`);
  check('names and ids are all different', new Set(CARS.map((c) => c.name)).size === CARS.length && new Set(CARS.map((c) => c.id)).size === CARS.length);
  const spec = (id, top, steer, grip) => {
    const h = handlingFor(carById(id));
    return h.topSpeed === top && h.maxTurnRateDeg === steer && h.gripTurning === grip;
  };
  check('Classic Coupe has the asked-for numbers', spec('coupe', 320, 195, 4.2));
  check('Pocket Hatchback too, and it is light', spec('hatchback', 310, 230, 5.5) && carById('hatchback').mass < 1);
  check('Drift Van too', spec('van', 330, 180, 3.2));
  check('Highway Interceptor too: made faster on the owner\'s word (2026-11-05), and harder to steer', spec('highway', 375, 180, 3.8));
  const ram = carById('ram');
  check('Battering Ram too, at 2.2 x the mass, and it plows', handlingFor(ram).topSpeed === 295 && handlingFor(ram).maxTurnRateDeg === 160 && ram.mass === 2.2 && ram.plows);
  check('no car has a survival unlock any more: coins buy them', CARS.every((c) => c.surviveSeconds === undefined));
  const handling = handlingFor(CARS[1]);
  check('a car doesn\'t change the shared presets', handling !== HANDLING_PRESETS.balanced && HANDLING_PRESETS.balanced.topSpeed === 300);
}

// ---- The models ----
{
  let bad = '';
  const worst = { width: 0, sheets: 0, id: '' };
  for (const car of CARS) {
    const mesh = carMesh(car.id);
    const verts = mesh.flatMap((p) => p.verts);
    const xs = verts.map((v) => Math.abs(v[0]));
    const ys = verts.map((v) => Math.abs(v[1]));
    if (Math.max(...xs) > 27.5) bad += ` ${car.id} too wide (${Math.max(...xs)})`;
    if (Math.max(...ys) > 47.5) bad += ` ${car.id} too long (${Math.max(...ys)})`;
    if (Math.min(...verts.map((v) => v[2])) !== 0) bad += ` ${car.id} not on the road`;
    if (mesh.filter((p) => p.tag === 'wheel').length < 2) bad += ` ${car.id} no wheels`;
    if (!mesh.filter((p) => p.tag === 'wheel').every((w) => Math.min(...w.verts.map((v) => v[2])) === 0)) bad += ` ${car.id} wheels in the air`;
    for (let i = 0; i < 16; i += 1) {
      if (!projectMesh(mesh, (i * Math.PI) / 8, projection).some((p) => p.faces.length > 0)) bad += ` ${car.id} invisible`;
    }
    if (carMesh(`${car.id}Body`).length + carMesh(`${car.id}Wheels`).length !== mesh.length) bad += ` ${car.id} pieces`;
    if (carShadowPoints(car.id).length < 8) bad += ` ${car.id} shadow`;
    for (const view of RENDER.views) {
      const proj = new Projection(view);
      let bytes = 0;
      for (const name of [`${car.id}Body`, `${car.id}Wheels`]) {
        const layout = atlasLayout(measureCar(name, proj));
        worst.width = Math.max(worst.width, layout.width, layout.height);
        bytes += layout.width * layout.height * 4;
      }
      if (bytes > worst.sheets) {
        worst.sheets = bytes;
        worst.id = car.id;
      }
    }
  }
  check('every model is the right size, on the road, and seen from all sides', bad === '', bad);
  check('every drawing sheet fits older phones, in every camera view', worst.width <= 2048, `largest side ${worst.width} px`);
  check('the largest car\'s drawings fit in memory', worst.sheets < 16e6, `${(worst.sheets / 1e6).toFixed(1)} MB for the ${worst.id}`);
  check('body sheets have 64 directions, wheels 32', directionsFor('tankBody') === 64 && directionsFor('tankWheels') === 32);
  check('the tank and monster truck cast a shadow from their big wheels or tracks', carShadowPoints('tank').length > carMesh('tankBody').flatMap((p) => p.verts).length / 2 && carMesh('monsterWheels').every((w) => w.castsShadow));
  const faces = (id) => carMesh(id).reduce((n, p) => n + p.faces.length, 0);
  check('they stay low-poly', Math.max(...CARS.map((c) => faces(c.id))) < 420, `most ${Math.max(...CARS.map((c) => faces(c.id)))} faces`);

  // The cars with pressed bodies.
  const pressed = ['coupe', 'pickup', 'ram', 'rally', 'hypercar'];
  const wheelsOf = (id) => carMesh(id).filter((p) => p.tag === 'wheel' && p.faces.some((f) => f.name === 'outer'));
  check('each has a body built from slices, and four wheels', pressed.every((id) => carMesh(id).some((p) => p.stations) && wheelsOf(id).length === 4));
  check('their wheels and floor are drawn first, here and in the garage', pressed.every((id) => {
    const lowest = Math.max(...carMesh(id).filter((p) => p.tag === 'wheel').map((p) => p.layer));
    return lowest < Math.min(...carMesh(id).filter((p) => p.tag !== 'wheel').map((p) => p.layer));
  }));
  // In play the body is painted over the wheels, so nothing of it may stand in front of a wheel's outer face.
  const hidden = [];
  for (const id of pressed) {
    const body = carMesh(id).find((p) => p.stations);
    for (const wheel of wheelsOf(id)) {
      const ys = wheel.verts.map((v) => v[1]);
      const top = Math.max(...wheel.verts.map((v) => v[2]));
      const middle = (Math.min(...ys) + Math.max(...ys)) / 2;
      const over = body.stations.find((s) => Math.abs(s.y - middle) < 0.01);
      if (!over || over.half[0][1] < top) hidden.push(`${id} ${middle}`);
    }
  }
  check('an arch clears the top of its wheel', hidden.length === 0, hidden.join());
  // Over a wheel the top of a low hood sits below its own fenders, and must still count as facing up.
  const bodyOf = (id) => carMesh(id).filter((p) => p.stations);
  const facesSeen = (id, heading) => projectMesh(bodyOf(id), heading, projection)[0].faces.map((f) => f.name);
  check('the top of a body is seen from every direction, even over the wheels', ['coupe', 'ram', 'rally', 'hypercar'].every((id) => {
    const tops = bodyOf(id)[0].faces.filter((f) => f.name.startsWith('top:')).length;
    return Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8).every((h) => facesSeen(id, h).filter((f) => f.startsWith('top:')).length === tops);
  }));
  check('the back of the car faces the camera in the garage, as asked', facesSeen('coupe', 0).includes('back') && !facesSeen('coupe', 0).includes('front'));
  check('their shadows cost no more than the older models\' (worked out every frame)', pressed.every((id) => carShadowPoints(id).length <= 192), pressed.map((id) => carShadowPoints(id).length).join());
  check('the pickup\'s bed is open: its floor is well below its walls', (() => {
    const mesh = carMesh('pickup');
    const body = mesh.find((p) => p.stations);
    const floor = body.stations.find((s) => s.y === -14).half[4][1];
    return Math.max(...mesh.filter((p) => !p.stations && p.tag !== 'wheel' && p.verts.every((v) => v[1] < -12)).flatMap((p) => p.verts.map((v) => v[2]))) > floor + 6;
  })());
}

// ---- What the garage says about a car ----
{
  const all = CARS.map((c) => ({ car: c, spec: carSpecs(c) }));
  const best = (name) => all.reduce((a, b) => (b.spec[name] > a.spec[name] ? b : a)).car;
  const shares = all.flatMap((c) => Object.values(c.spec));
  check('every car has speed, acceleration, handling and durability, from 0 to 1', all.every((c) => ['speed', 'acceleration', 'handling', 'durability'].every((k) => c.spec[k] >= 0 && c.spec[k] <= 1)) && shares.length === CARS.length * 4);
  check('they come from how it really drives: the hypercar is fastest', best('speed').id === 'hypercar' && carSpecs(carById('hypercar')).speed === 1);
  check('and quickest off the line', best('acceleration').id === 'hypercar');
  check('the tank is toughest and slowest', best('durability').id === 'tank' && carSpecs(carById('tank')).speed === 0);
  check('the small, nimble cars handle best', ['tuktuk', 'hatchback'].includes(best('handling').id), best('handling').id);
  check('a heavier car always shows as more durable', all.every((a) => all.every((b) => a.car.mass <= b.car.mass || a.spec.durability >= b.spec.durability)));
  check('every label can be drawn in the game\'s lettering', ['SPEED', 'ACCELERATION', 'HANDLING', 'DURABILITY'].every((word) => canDisplay(word)));
}

// ---- In the simulation ----
function simWith(id, items = []) {
  const s = new ChaseSimulation({ layout: fixedMap(items), handling: HANDLING_PRESETS.balanced });
  s.setCar(carById(id));
  s.reset(1);
  s.spawner.cooldown = 1e6;
  s.spawner.nextRoadblock = 1e6;
  s.powerUps.timer = 1e6;
  return s;
}
const run = (s, seconds, steer = 0) => {
  for (let t = 0; t < seconds; t += 1 / 60) s.step(1 / 60, { steer }, offView);
};
{
  for (const car of CARS) {
    const s = simWith(car.id);
    s.player.reset(3000, 3000, 0);
    s.player.launch(100);
    run(s, 2.5);
    const top = handlingFor(car).topSpeed;
    if (Math.abs(s.player.speed - top) > 3) check(`${car.name} reaches its top speed`, false, `${s.player.speed.toFixed(0)} of ${top}`);
  }
  check('every car reaches its own top speed', true);
  const tank = simWith('tank');
  check('size, mass and handling come with the car', tank.player.scale === 1.2 && tank.player.baseScale === 1.2 && tank.player.mass === COLLISION.playerMass * 4.5 && tank.player.handling.topSpeed === 265);
  tank.reset(9);
  check('and survive a new run', tank.player.scale === 1.2 && tank.player.mass === COLLISION.playerMass * 4.5 && tank.player.plowing);
  tank.setCar(carById('coupe'));
  tank.reset(9);
  check('changing car changes it all back', tank.player.scale === 1 && tank.player.mass === COLLISION.playerMass && !tank.player.plowing && tank.player.handling.topSpeed === 320);

  // Handling really differs.
  const circle = (id) => {
    const c = new Car(handlingFor(carById(id)));
    c.launch(handlingFor(carById(id)).topSpeed);
    let drift = 0;
    for (let i = 0; i < 40; i += 1) {
      c.stepFor(1, 1 / 60, 1 / 120);
      drift = Math.max(drift, c.driftAngleDeg);
    }
    return { turned: c.heading, drift };
  };
  check('the hatchback turns tighter than the ram', circle('hatchback').turned > circle('ram').turned * 1.2, `${circle('hatchback').turned.toFixed(2)} vs ${circle('ram').turned.toFixed(2)} rad`);
  const slideLasts = (id) => {
    const c = new Car(handlingFor(carById(id)));
    c.launch(handlingFor(carById(id)).topSpeed);
    for (let i = 0; i < 40; i += 1) c.stepFor(1, 1 / 60, 1 / 120);
    let frames = 0;
    while (c.driftAngleDeg > 5 && frames < 300) {
      c.stepFor(0, 1 / 60, 1 / 120);
      frames += 1;
    }
    return frames / 60;
  };
  check('the drift van holds its slide far longer than the hatchback', slideLasts('van') > slideLasts('hatchback') * 1.3, `${slideLasts('van').toFixed(2)} s vs ${slideLasts('hatchback').toFixed(2)} s`);

  // Plowing.
  const props = [
    { kind: 'cone', x: 3000, y: 2700, heading: 0, model: 'c', params: {}, collider: { type: 'circle', r: 11 }, breakable: true },
    { kind: 'civilian', x: 3000, y: 2500, heading: 0, model: 'p', params: {}, collider: { type: 'box', hw: 22, hl: 42 }, breakable: true },
  ];
  const through = (id) => {
    const s = simWith(id, props.map((p) => ({ ...p })));
    s.player.reset(3000, 2900, 0);
    s.player.launch(handlingFor(carById(id)).topSpeed);
    let slowest = Infinity;
    for (let t = 0; t < 1.4; t += 1 / 60) {
      s.step(1 / 60, { steer: 0 }, offView);
      slowest = Math.min(slowest, s.player.speed);
    }
    return { slowest, top: handlingFor(carById(id)).topSpeed, state: s.state };
  };
  const ramRun = through('ram');
  const coupeRun = through('coupe');
  check('the ram goes through cones and parked cars without slowing', ramRun.slowest > ramRun.top - 4 && ramRun.state === 'running', `slowest ${ramRun.slowest.toFixed(0)} of ${ramRun.top}`);
  check('the coupe does slow', coupeRun.slowest < coupeRun.top - 40, `slowest ${coupeRun.slowest.toFixed(0)} of ${coupeRun.top}`);

  // Durability.
  const wall = [{ kind: 'block', x: 3000, y: 2800, heading: 0, model: 'b', params: {}, collider: { type: 'box', hw: 60, hl: 20 }, breakable: false }];
  const smack = (id) => {
    const s = simWith(id, wall.map((p) => ({ ...p })));
    s.player.reset(3000, 2950, 0);
    s.player.launch(250);
    run(s, 1);
    return s.state;
  };
  check('a hit that wrecks the coupe', smack('coupe') === 'crashed');
  check('doesn\'t wreck the tank', smack('tank') === 'running');
  const limit = (id) => simWith(id).playerCrashImpact;
  check('durability sets the limit', limit('coupe') === CRASH.playerImpact && Math.abs(limit('tank') - CRASH.playerImpact * Math.sqrt(4.5)) < 1e-9);
  const sorted = [...CARS].sort((a, b) => a.scale - b.scale);
  let shrinking = '';
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].scale > sorted[i].scale && sorted[j].durability < sorted[i].durability) shrinking += ` ${sorted[j].name} < ${sorted[i].name}`;
    }
  }
  check('a bigger car is never less durable than a smaller one', shrinking === '', shrinking);
  check('the lightest car breaks most easily and the Tank is toughest', Math.min(...CARS.map((c) => c.durability)) === carById('tuktuk').durability && Math.max(...CARS.map((c) => c.durability)) === carById('tank').durability, `${carById('tuktuk').durability.toFixed(2)} to ${carById('tank').durability.toFixed(2)}`);

  // Giant goes back to the car's own size.
  const g = simWith('tank');
  g.player.reset(3000, 3000, 0);
  g.player.launch(200);
  g.powerUps.give('giant');
  g.step(1 / 60, { steer: 0, activatePowerUp: true }, offView);
  run(g, 1);
  check('TITAN makes even a tank bigger', g.player.scale > 2.5, `${g.player.scale.toFixed(2)}`);
  run(g, GIANT.seconds + 3);
  check('and it comes back to its own size and weight', Math.abs(g.player.scale - 1.2) < 0.01 && !g.player.crushing && g.player.mass === COLLISION.playerMass * 4.5, `${g.player.scale.toFixed(2)}, ${g.player.mass}`);
  check('still plowing', g.player.plowing);
}

// ---- Stars, clocks and distance ----
{
  check('stars come at 10, 20, 35, 50 and 75 s', [9.9, 10, 20, 34.9, 35, 50, 74.9, 75, 200].map(starsFor).join('') === '012234455'.replace('012234455', '012234455') && starsFor(9.9) === 0 && starsFor(10) === 1 && starsFor(35) === 3 && starsFor(74.9) === 4 && starsFor(75) === 5);
  check('the clock reads minutes, seconds and hundredths', formatClock(0) === '00:00.00' && formatClock(83.456) === '01:23.45' && formatClock(9.5) === '00:09.50' && formatClock(600) === '10:00.00', formatClock(83.456));
  check('it never shows 60 seconds', !formatClock(59.999).includes('60.00'), formatClock(59.999));
  check('distance reads in metres', formatDistance(0) === '0.00 M' && formatDistance(T.UNITS_PER_METER * 48.82) === '48.82 M' && formatDistance(T.UNITS_PER_METER * 1234.5) === '1,234.50 M', formatDistance(T.UNITS_PER_METER * 1234.5));
}

// ---- HARD START pays more ----
{
  const run = { time: 60, wrecks: 4, combo: 2 };
  const normal = coinsForRun(run);
  const hard = coinsForRun(run, true);
  check('HARD START pays half as much again', hard.total === Math.round(normal.total * T.COINS.hardShare) && hard.hard > 0 && normal.hard === 0, `${normal.total} -> ${hard.total}`);
}

// ---- Maps, and the stars that open them ----
{
  Maps.restore(null, null);
  // The challenge map (bare) is open from the start; the others open one after another with stars.
  const progression = MAPS.filter((m) => !m.bare);
  check('the first map is open from the start, the others locked', Maps.current().id === 'suburb' && progression.slice(1).every((m) => !Maps.isUnlocked(m)) && Maps.isUnlocked(MAPS[0]));
  check('there are at least 4 maps, each needing more stars', progression.length >= 4 && progression.every((m, i) => i === 0 || m.stars > progression[i - 1].stars));
  check('the challenge map is open from the start', MAPS.filter((m) => m.bare).every((m) => Maps.isUnlocked(m)));
  check('a locked map can\'t be selected', !Maps.select('winter') && Maps.selected === 'suburb');
  check('nor can one that doesn\'t exist', !Maps.select('moon') && Maps.selected === 'suburb');
  check('the next locked map is named, with the stars it needs', Maps.nextLocked().map.id === 'winter' && Maps.nextLocked().needed === 3);
  check('a short run unlocks nothing', Maps.submit(15).length === 0 && Maps.totalStars() === 1);
  check('and needs fewer now', Maps.nextLocked().needed === 2);
  const open = Maps.submit(36);
  check('three stars unlock Winter', open.length === 1 && open[0].id === 'winter' && Maps.isUnlocked(open[0]), open.map((m) => m.id).join());
  check('only the best run on a map counts', (Maps.submit(11), Maps.totalStars() === 3));
  check('now it can be chosen', Maps.select('winter') && Maps.current().id === 'winter');
  check('runs count on the map they were driven on', (Maps.submit(36), Maps.bestTime('winter') === 36 && Maps.totalStars() === 6));
  check('stars add up across maps, unlocking Desert', Maps.isUnlocked(MAPS.find((m) => m.id === 'desert')));
  for (const [what, best, selected] of [['nonsense', 'x', 7], ['negative times', { suburb: -5 }, 'suburb'], ['a locked map selected', { suburb: 1 }, 'woods'], ['an unknown map', { mars: 99 }, 'mars']]) {
    Maps.restore(best, selected);
    check(`a damaged save (${what}) is made safe`, Maps.selected === 'suburb' && Object.values(Maps.best).every((t) => t > 0) && !('mars' in Maps.best));
  }
  Maps.restore(null, null);
}

// ---- Open ground, and soft marks ----
{
  const open = MAPS.filter((m) => m.open);
  check('Winter and Desert are open ground; Suburbs and Woods have roads', open.map((m) => m.id).join() === 'winter,desert');
  for (const map of open) {
    const chunks = [];
    for (let cy = -2; cy <= 2; cy += 1) for (let cx = -2; cx <= 2; cx += 1) chunks.push(buildChunk(cx, cy, undefined, map));
    const paint = chunks.flatMap((c) => c.paint);
    check(`${map.name}: no road paint at all`, paint.every((m) => m.track || m.color === 'plaza'));
    check(`${map.name}: tire tracks to follow`, paint.filter((m) => m.track).length > chunks.length * 100, `${paint.filter((m) => m.track).length} pieces`);
    // Holes are rare on open maps: look over a wider area for them.
    const wide = [];
    for (let cy = -4; cy <= 4; cy += 1) for (let cx = -4; cx <= 4; cx += 1) wide.push(buildChunk(cx, cy, undefined, map));
    check(`${map.name}: the holes, props and colliders are all still there`, chunks.every((c) => c.items.length > 0) && wide.some((c) => c.voids.length > 0));
    check(`${map.name}: the ground and the garage have different colours: bright ground, dark enough behind lettering`, mapColorOf(map, 'asphalt') !== mapColorOf(map, 'uiGround'));
    check(`${map.name}: still the same on every visit`, JSON.stringify(buildChunk(1, 1, undefined, map).paint) === JSON.stringify(buildChunk(1, 1, undefined, map).paint));
  }
  check('maps with roads keep them', buildChunk(1, 1).paint.some((m) => !m.track && !m.color) && !buildChunk(1, 1).paint.some((m) => m.track));
  check('the circle painted round the start has gone', !buildChunk(1, 1).paint.some((m) => m.ring && m.x === T.START.x && m.y === T.START.y));
  const size = T.CHUNKS.size;
  for (const map of MAPS) {
    const chunk = buildChunk(2, 3, undefined, map);
    const marks = groundMarksFor(chunk, map, size, T.WORLD.cell, T.WORLD.margin);
    check(`${map.name}: marks on the ground, the same each visit, inside their chunk`, marks.length > 0 && JSON.stringify(marks) === JSON.stringify(groundMarksFor(chunk, map, size, T.WORLD.cell, T.WORLD.margin)) && marks.every((m) => m.x >= chunk.x0 && m.x <= chunk.x0 + size && m.y >= chunk.y0 && m.y <= chunk.y0 + size), `${marks.length}`);
  }
}

// ---- The lettering ----
{
  const names = [...CARS.map((c) => c.name), ...MAPS.map((m) => m.name), ...Object.values(T.POWERUP.names)];
  const missing = names.filter((name) => !canDisplay(name));
  check('every car, map and power-up name can be drawn in the game\'s lettering', missing.length === 0, missing.join());
  check('and something it can\'t draw is noticed', !canDisplay('←'));
}

// ---- Every map holds together ----
{
  const { START, CHUNKS } = T;
  const before = { ...T.PALETTE };
  for (const map of MAPS) {
    T.applyMapPalette(map);
    const catalogue = new Set(propCatalogue(map).map((e) => e.model));
    const kinds = new Set();
    let missing = '';
    let voids = 0;
    for (let cy = -5; cy < 6; cy += 1) {
      for (let cx = -5; cx < 6; cx += 1) {
        const chunk = buildChunk(cx, cy, undefined, map);
        voids += chunk.voids.length;
        for (const item of chunk.items) {
          kinds.add(item.kind);
          if (!catalogue.has(item.model)) missing += ` ${item.model}`;
        }
      }
    }
    check(`${map.name}: everything on it is drawn at startup`, missing === '', missing.slice(0, 120));
    check(`${map.name}: its props have models`, propCatalogue(map).every((e) => propMesh(e).length > 0));
    const start = buildChunk(Math.floor(START.x / CHUNKS.size), Math.floor(START.y / CHUNKS.size), undefined, map);
    if (map.bare) check(`${map.name}: nothing at all stands on it, and there are no holes`, start.items.length === 0 && start.voids.length === 0 && start.surfaces.length === 0);
    else check(`${map.name}: it has a gas station at the start`, start.items.filter((i) => i.kind === 'canopy').length === 1);
    check(`${map.name}: the start is clear`, [...start.items, ...start.voids].every((i) => Math.hypot(i.x - START.x, i.y - START.y) >= START.clearRadius));
    const sim = new ChaseSimulation({ layout: buildLayout(undefined, map), handling: HANDLING_PRESETS.balanced });
    sim.reset(1);
    for (let t = 0; t < 2; t += 1 / 60) sim.step(1 / 60, { steer: 0 }, offView);
    check(`${map.name}: it can be driven on`, sim.state === 'running' && sim.player.speed > 200, `${[...kinds].join(' ')}`);
    let colour = true;
    for (const [key, value] of Object.entries(map.palette)) if (T.PALETTE[key] !== value) colour = false;
    check(`${map.name}: its colours are in place`, colour);
  }
  T.applyMapPalette(MAPS[0]);
  check('and back on the first map, the colours are back', Object.entries(before).every(([key, value]) => T.PALETTE[key] === value));
  const winter = propCatalogue(MAPS.find((m) => m.id === 'winter')).map((e) => e.model);
  const desert = propCatalogue(MAPS.find((m) => m.id === 'desert')).map((e) => e.model);
  const woods = propCatalogue(MAPS.find((m) => m.id === 'woods')).map((e) => e.model);
  check('winter has snowy pines and a cabin', winter.some((m) => m.startsWith('snowpine')) && winter.includes('cabin'));
  check('the desert has cacti, red rocks, a water tower and poles', desert.some((m) => m.startsWith('cactus')) && desert.some((m) => m.startsWith('mesa')) && desert.includes('tower') && desert.includes('pole'));
  check('the woods have pines, dead trees and logs', woods.some((m) => m.startsWith('pine')) && woods.some((m) => m.startsWith('dead')) && woods.includes('log'));
}

// ---- The gas station ----
{
  const { START, CHUNKS, WORLD } = T;
  const start = buildChunk(Math.floor(START.x / CHUNKS.size), Math.floor(START.y / CHUNKS.size));
  const roof = start.items.filter((i) => i.kind === 'canopy');
  check('the start chunk has exactly one gas station', start.preset === 'suburb' && roof.length === 1 && start.items.filter((i) => i.kind === 'pumps').length === 2);
  check('its roof has nothing to hit, and is drawn above the cars', roof[0].collider === null && roof[0].band === 'overhead');
  check('the pumps and shop are solid', start.items.filter((i) => i.kind === 'pumps' || i.kind === 'shop').every((i) => i.collider && !i.breakable));
  const pumps = start.items.filter((i) => i.kind === 'pumps').sort((a, b) => a.x - b.x);
  const gap = pumps[1].x - pumps[0].x - WORLD.station.pumpHalfWidth * 2;
  check('the biggest car can drive between them', gap > 44 * Math.max(...CARS.map((c) => c.scale)), `${gap} wide`);
  check('it is in view ahead of the start, and clear of it', Math.hypot(roof[0].x - START.x, roof[0].y - START.y) < 700 && pumps.every((p) => Math.hypot(p.x - START.x, p.y - START.y) >= START.clearRadius), `${Math.round(Math.hypot(roof[0].x - START.x, roof[0].y - START.y))} away`);
  check('it is the same on every visit', JSON.stringify(buildChunk(1, 1).items.map((i) => [i.kind, i.x, i.y])) === JSON.stringify(start.items.map((i) => [i.kind, i.x, i.y])));
  let doubles = 0;
  let stations = 0;
  const kinds = new Set();
  const colours = new Set();
  for (let cy = -14; cy < 14; cy += 1) {
    for (let cx = -14; cx < 14; cx += 1) {
      const chunk = buildChunk(cx, cy);
      const count = chunk.items.filter((i) => i.kind === 'canopy').length;
      stations += count;
      if (count > 1) doubles += 1;
      for (const item of chunk.items) {
        kinds.add(item.kind);
        if (item.kind === 'civilian') colours.add(item.params.color);
      }
    }
  }
  check('never two stations in a chunk, though others turn up', doubles === 0 && stations > 5, `${stations} in 784 chunks`);
  check('every new prop appears in the world', ['shop', 'booth', 'bench', 'boulder', 'billboard'].every((k) => kinds.has(k)), [...kinds].join(' '));
  check('parked cars are blue, yellow, white and red', ['civilianBlue', 'civilianYellow', 'civilianWhite', 'civilianRed'].every((c) => colours.has(c)));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
