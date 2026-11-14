import { Car } from '../entities/Car.js';
import { COLLISION, POLICE_HANDLING, START, TITLE_PATROL, WORLD } from '../config/tuning.js';
import { wrapAngle } from '../utils/math.js';

// The title screen's police (owner, 2026-11-14): a few cruisers driving round the blocks around the waiting car,
// lights flashing, so the game shows what it is about before PLAY. Pure logic: the game scene draws them. They are
// not part of the chase: nothing hits them and they hit nothing. Their ring of roads keeps a block or more away from
// the car, and it is only used if a car driving it would touch nothing solid and no hole or water on the way round.
export class TitlePatrol {
  constructor() {
    this.handling = { ...POLICE_HANDLING, topSpeed: POLICE_HANDLING.topSpeed * TITLE_PATROL.speedShare };
    this.cars = [];
    this.ring = 0; // how many blocks out the ring of roads is (0: no patrol on this map)
  }

  // world: the loaded chunks' collisions (isClear). Picks the first ring of roads clear all round, both ways.
  setUp(world) {
    this.cars.length = 0;
    this.ring = 0;
    for (const blocks of TITLE_PATROL.rings) {
      const routes = [makeRoute(blocks, 1), makeRoute(blocks, -1)];
      if (!routes.every((route) => routeIsClear(route, this.handling, world))) continue;
      this.ring = blocks;
      for (let i = 0; i < TITLE_PATROL.cars; i += 1) {
        const route = routes[i % 2];
        // The cars each way spread out evenly, each starting halfway along a side (not on a corner, where it would
        // overshoot). Both ways start from the same sides, so they pass each other halfway along the sides, not on
        // the corners, two of which are off a phone's screen held upright.
        const share = Math.floor(i / 2) / Math.ceil(TITLE_PATROL.cars / 2);
        this.cars.push(placeCar(route, share * route.total + route.lengths[0] / 2, this.handling));
      }
      return;
    }
  }

  update(dt) {
    for (const car of this.cars) driveCar(car, dt);
  }
}

// A ring of roads around the start crossing, `blocks` cells out, in its right-hand lane. way 1: clockwise on the
// map (north side heading east), -1 the other way round.
export function makeRoute(blocks, way) {
  // Clockwise, the right-hand lane is the inside of the ring; the other way round it is the outside.
  const half = blocks * WORLD.cell - way * TITLE_PATROL.lane;
  const { x, y } = START;
  const corners = [
    { x: x - half, y: y - half },
    { x: x + half, y: y - half },
    { x: x + half, y: y + half },
    { x: x - half, y: y + half },
  ];
  if (way < 0) corners.reverse();
  const lengths = corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
  return { corners, lengths, total: lengths.reduce((a, b) => a + b, 0) };
}

// The point `s` units along the route (wrapping round), and the heading there.
export function pointAt(route, s, out = { x: 0, y: 0, heading: 0 }) {
  let left = ((s % route.total) + route.total) % route.total;
  let i = 0;
  while (left > route.lengths[i]) {
    left -= route.lengths[i];
    i += 1;
  }
  const p = route.corners[i];
  const q = route.corners[(i + 1) % route.corners.length];
  const share = left / route.lengths[i];
  out.x = p.x + (q.x - p.x) * share;
  out.y = p.y + (q.y - p.y) * share;
  out.heading = Math.atan2(q.x - p.x, -(q.y - p.y)); // 0 = north, clockwise
  return out;
}

// How far along the route the nearest point to (x, y) is, looking at the side it was last on and the next one. It
// keeps counting up lap after lap, so the car never looks back.
function progressNear(route, x, y, hint) {
  const n = route.corners.length;
  const lap = Math.floor(hint / route.total) * route.total;
  let left = hint - lap;
  let side = 0;
  let base = 0;
  while (side < n - 1 && left > route.lengths[side]) {
    left -= route.lengths[side];
    base += route.lengths[side];
    side += 1;
  }
  let best = hint - lap;
  let bestD = Infinity;
  for (let k = 0; k < 2; k += 1) {
    const i = (side + k) % n;
    const p = route.corners[i];
    const q = route.corners[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(p.x + dx * t - x, p.y + dy * t - y);
    if (d < bestD) {
      bestD = d;
      best = base + t * route.lengths[i];
    }
    base += route.lengths[i];
  }
  return lap + best;
}

const target = { x: 0, y: 0, heading: 0 };

function placeCar(route, s, handling) {
  const model = new Car(handling);
  pointAt(route, s, target);
  model.reset(target.x, target.y, target.heading);
  model.vx = Math.sin(target.heading) * handling.topSpeed;
  model.vy = -Math.cos(target.heading) * handling.topSpeed;
  model.forwardSpeed = handling.topSpeed;
  return { model, route, s };
}

// Pure pursuit: steer for a point a little way ahead along the route.
function driveCar(car, dt) {
  const model = car.model;
  car.s = progressNear(car.route, model.x, model.y, car.s);
  pointAt(car.route, car.s + TITLE_PATROL.lookAhead, target);
  const want = Math.atan2(target.x - model.x, -(target.y - model.y));
  const steer = Math.max(-1, Math.min(1, wrapAngle(want - model.heading) * TITLE_PATROL.steerGain));
  model.stepFor(steer, dt, 1 / 60);
}

// Drives one lap in a dry run, checking the car's front and back have room the whole way, with a little to spare.
export function routeIsClear(route, handling, world) {
  const car = placeCar(route, route.lengths[0] / 2, handling);
  const room = COLLISION.carCircleRadius + TITLE_PATROL.spare;
  const step = 1 / 20;
  for (let t = 0; t < (route.total / handling.topSpeed) * 1.2; t += step) {
    driveCar(car, step);
    if (!carHasRoom(car.model, world, room)) return false;
  }
  return true;
}

export function carHasRoom(model, world, room) {
  const fx = Math.sin(model.heading) * COLLISION.carCircleOffset;
  const fy = -Math.cos(model.heading) * COLLISION.carCircleOffset;
  return world.isClear(model.x + fx, model.y + fy, room) && world.isClear(model.x - fx, model.y - fy, room);
}
