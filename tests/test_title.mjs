// The title screen's patrol (systems/TitlePatrol.js): police cruising round the blocks near the waiting car.
import { ChaseSimulation, T, buildLayout } from './simkit.mjs';
import { TitlePatrol, carHasRoom, makeRoute, pointAt } from '../src/systems/TitlePatrol.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

const route = makeRoute(1, 1);
const p = pointAt(route, 10);
check('clockwise, the patrol sets off east along the north side', Math.abs(p.heading - Math.PI / 2) < 1e-6 && p.y < T.START.y);
check('the two ways drive different lanes', makeRoute(1, 1).corners[0].x !== makeRoute(1, -1).corners[0].x);

for (const map of T.MAPS) {
  const sim = new ChaseSimulation({ layout: buildLayout(T.WORLD.seed, map), handling: T.HANDLING_PRESETS[T.DEFAULT_HANDLING_PRESET] });
  sim.reset(1);
  const patrol = new TitlePatrol();
  patrol.setUp(sim.world);
  let touched = 0;
  let nearest = Infinity;
  let slowest = Infinity;
  let offRoad = 0;
  for (let i = 0; i < 60 * 60; i += 1) {
    patrol.update(1 / 60);
    for (const car of patrol.cars) {
      const m = car.model;
      if (!carHasRoom(m, sim.world, T.COLLISION.carCircleRadius)) touched += 1;
      nearest = Math.min(nearest, Math.hypot(m.x - T.START.x, m.y - T.START.y));
      slowest = Math.min(slowest, m.speed);
      const toRoad = Math.min(Math.abs(m.x - Math.round(m.x / T.WORLD.cell) * T.WORLD.cell), Math.abs(m.y - Math.round(m.y / T.WORLD.cell) * T.WORLD.cell));
      offRoad = Math.max(offRoad, toRoad);
    }
  }
  const ok = patrol.cars.length === T.TITLE_PATROL.cars && touched === 0 && offRoad < T.WORLD.margin - 15 && nearest > 300 && slowest > 60;
  check(`${map.id}: ${patrol.cars.length} police cruise a minute round the ring ${patrol.ring} blocks out, keeping to the road and touching nothing`, ok, `touched ${touched}, furthest from a road's middle ${Math.round(offRoad)}, nearest to the car ${Math.round(nearest)}, slowest ${Math.round(slowest)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
