import { COLLISION, CURB } from '../config/tuning.js';

// Collisions for the flat physics world. Pure maths, no Phaser.
//
// Shapes: every car is two circles (front and back); props are circles (trees, lamps, cones)
// or rotated boxes (islands, blocks, barriers).
// Props come in four kinds:
//   solid     (trees, blocks, barriers, containers): the car bounces off.
//   breakable (cones, lamp posts, wooden crates): knocked away, reported through onTouch.
//   curb      (parking islands, roundabouts): driven over, with a speed penalty and a bump on the way on.
//   void      (sinkholes): a car whose centre is over one falls in, reported in result.voidShape.
//   spikes    (spike strips): driven over, reported in result.spikes.
// Results: "impact" = how fast the car was moving INTO a solid surface (units/s). A glancing scrape
// gives a small impact, a head-on hit a big one; the crash rules compare it to thresholds.

const CIRCLE = 0;
const BOX = 1;
const R = COLLISION.carCircleRadius;
const OFF = COLLISION.carCircleOffset;

const hit = { nx: 0, ny: 0, depth: 0 };

// Static props in a grid with no edges, so each car only looks at the few props near it. Only
// squares with something in them exist: chunks add and remove their props as the player moves.
const ROWS = 2 ** 26; // room for 20 billion world units in each direction

export class StaticWorld {
  constructor(items = []) {
    this.cell = COLLISION.gridCell;
    this.grid = new Map();
    this.shapes = [];
    this.stamp = 0;
    for (const item of items) if (item.collider) this.add(item);
  }

  add(item) {
    const c = item.collider;
    const shape = {
      type: c.type === 'circle' ? CIRCLE : BOX,
      x: item.x,
      y: item.y,
      r: c.r || 0,
      hw: c.hw || 0,
      hl: c.hl || 0,
      cos: Math.cos(item.heading),
      sin: Math.sin(item.heading),
      bound: c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hl),
      solid: !item.breakable && !item.curb && !item.isVoid && !item.isSpikes,
      curb: Boolean(item.curb),
      isSpikes: Boolean(item.isSpikes),
      isVoid: Boolean(item.isVoid),
      cone: null, // set by the chunk manager on breakable props
      item,
      seen: 0,
    };
    this.shapes.push(shape);
    this.forCells(shape, (key) => {
      const list = this.grid.get(key);
      if (list) list.push(shape);
      else this.grid.set(key, [shape]);
    });
    return shape;
  }

  // Takes a prop out again. Squares left empty are forgotten, so memory stays flat on endless drives.
  remove(shape) {
    this.forCells(shape, (key) => {
      const list = this.grid.get(key);
      if (!list) return;
      const index = list.indexOf(shape);
      if (index < 0) return;
      list[index] = list[list.length - 1];
      list.pop();
      if (list.length === 0) this.grid.delete(key);
    });
    const index = this.shapes.indexOf(shape);
    if (index >= 0) {
      this.shapes[index] = this.shapes[this.shapes.length - 1];
      this.shapes.pop();
    }
  }

  forCells(shape, visit) {
    const c0 = Math.floor((shape.x - shape.bound) / this.cell);
    const c1 = Math.floor((shape.x + shape.bound) / this.cell);
    const r0 = Math.floor((shape.y - shape.bound) / this.cell);
    const r1 = Math.floor((shape.y + shape.bound) / this.cell);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) visit(col * ROWS + row);
    }
  }

  // Calls visit(shape) once for every shape that may touch the circle (x, y, r).
  forEachNear(x, y, r, visit) {
    this.stamp += 1;
    const stamp = this.stamp;
    const c0 = Math.floor((x - r) / this.cell);
    const c1 = Math.floor((x + r) / this.cell);
    const r0 = Math.floor((y - r) / this.cell);
    const r1 = Math.floor((y + r) / this.cell);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const list = this.grid.get(col * ROWS + row);
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const shape = list[i];
          if (shape.seen === stamp) continue;
          shape.seen = stamp;
          const dx = shape.x - x;
          const dy = shape.y - y;
          const reach = shape.bound + r;
          if (dx * dx + dy * dy <= reach * reach) visit(shape);
        }
      }
    }
  }

  // Is the circle free of solid props and holes?
  isClear(x, y, r) {
    let clear = true;
    this.forEachNear(x, y, r, (shape) => {
      if (clear && (shape.solid || shape.isVoid) && circleVsShape(x, y, r, shape, hit)) clear = false;
    });
    return clear;
  }
}

// Overlap of a circle with a shape. Fills `out` with the push-out direction (from the shape
// toward the circle) and depth. Returns false when they don't touch.
export function circleVsShape(cx, cy, r, shape, out) {
  const dx = cx - shape.x;
  const dy = cy - shape.y;
  if (shape.type === CIRCLE) {
    const reach = r + shape.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= reach * reach) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      out.nx = 1;
      out.ny = 0;
    } else {
      out.nx = dx / d;
      out.ny = dy / d;
    }
    out.depth = reach - d;
    return true;
  }
  // Box: work in the box's own axes (right = (cos, sin), forward = (sin, -cos)).
  const { cos, sin, hw, hl } = shape;
  const lx = dx * cos + dy * sin;
  const ly = dx * sin - dy * cos;
  const qx = lx < -hw ? -hw : lx > hw ? hw : lx;
  const qy = ly < -hl ? -hl : ly > hl ? hl : ly;
  let nx;
  let ny;
  if (qx === lx && qy === ly) {
    // Centre inside the box: leave by the nearest side.
    const px = hw - Math.abs(lx);
    const py = hl - Math.abs(ly);
    if (px < py) {
      nx = lx < 0 ? -1 : 1;
      ny = 0;
      out.depth = px + r;
    } else {
      nx = 0;
      ny = ly < 0 ? -1 : 1;
      out.depth = py + r;
    }
  } else {
    const ex = lx - qx;
    const ey = ly - qy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    nx = ex / d;
    ny = ey / d;
    out.depth = r - d;
  }
  out.nx = cos * nx + sin * ny;
  out.ny = sin * nx - cos * ny;
  return true;
}

// Centres of the car's two circles, written into out[0] (front) and out[1] (back).
export function carCircles(car, out) {
  const fx = Math.sin(car.heading) * OFF * car.scale;
  const fy = -Math.cos(car.heading) * OFF * car.scale;
  out[0].x = car.x + fx;
  out[0].y = car.y + fy;
  out[1].x = car.x - fx;
  out[1].y = car.y - fy;
  return out;
}

// After a hit, turn the nose away from the surface (so the car glances off instead of
// grinding into it). Stronger for harder hits.
function deflectNose(car, nx, ny, impact, strength) {
  let hx = Math.sin(car.heading);
  let hy = -Math.cos(car.heading);
  const hn = hx * nx + hy * ny;
  if (hn >= 0) return;
  const k = Math.min(1, impact / COLLISION.deflectFullAt) * strength * (1 + COLLISION.noseDeflect);
  hx -= hn * nx * k;
  hy -= hn * ny * k;
  car.heading = Math.atan2(hx, -hy);
  car.angularVelocity *= 0.3;
}

// Pushes the car out of a fixed surface and bounces it off. Returns the impact speed.
export function bounceOffSurface(car, nx, ny, depth) {
  car.x += nx * depth;
  car.y += ny * depth;
  const vn = car.vx * nx + car.vy * ny;
  if (vn >= 0) return 0;
  const tx = -ny;
  const ty = nx;
  const vt = (car.vx * tx + car.vy * ty) * COLLISION.scrape;
  const back = -vn * COLLISION.obstacleBounce;
  car.vx = nx * back + tx * vt;
  car.vy = ny * back + ty * vt;
  deflectNose(car, nx, ny, -vn, 1);
  return -vn;
}

// The car climbs onto a curb: it loses a fixed share of its speed and is nudged along the edge
// it crossed. The nudge only changes direction, so the speed penalty is the same at every angle.
function climbCurb(car, nx, ny) {
  const speed = Math.hypot(car.vx, car.vy);
  const vn = car.vx * nx + car.vy * ny;
  if (vn < 0) {
    car.vx -= nx * vn * CURB.bumpDeflect;
    car.vy -= ny * vn * CURB.bumpDeflect;
    deflectNose(car, nx, ny, -vn, CURB.noseDeflect);
  }
  const scale = (speed * CURB.speedKeep) / Math.max(1e-6, Math.hypot(car.vx, car.vy));
  car.vx *= scale;
  car.vy *= scale;
}

// A falling car can't pass through the far wall of its hole: this stops it there. Only a car heading
// outward is stopped: it arrives at the edge, moving in.
export function keepInsideHole(car, inset) {
  const hole = car.fallShape;
  if (!hole) return;
  const dx = car.x - hole.x;
  const dy = car.y - hole.y;
  let moved = false;
  if (hole.type === CIRCLE) {
    const limit = Math.max(0, hole.r - inset);
    const distance = Math.hypot(dx, dy);
    if (distance > limit && distance > 0 && car.vx * dx + car.vy * dy > 0) {
      car.x = hole.x + (dx / distance) * limit;
      car.y = hole.y + (dy / distance) * limit;
      moved = true;
    }
  } else {
    const { cos, sin, hw, hl } = hole;
    const lx = dx * cos + dy * sin;
    const ly = dx * sin - dy * cos;
    const limitX = Math.max(0, hw - inset);
    const limitY = Math.max(0, hl - inset);
    const vx = car.vx * cos + car.vy * sin;
    const vy = car.vx * sin - car.vy * cos;
    const cx = (lx > limitX && vx > 0) || (lx < -limitX && vx < 0) ? Math.sign(lx) * limitX : lx;
    const cy = (ly > limitY && vy > 0) || (ly < -limitY && vy < 0) ? Math.sign(ly) * limitY : ly;
    if (cx !== lx || cy !== ly) {
      car.x = hole.x + cx * cos + cy * sin;
      car.y = hole.y + cx * sin - cy * cos;
      moved = true;
    }
  }
  if (moved) {
    car.vx = 0;
    car.vy = 0;
  }
}

const CENTRE_POINT = 0.01; // radius used to test only the car's centre against a hole

const circles = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

// Car against props. Returns the strongest impact; the prop involved is written into result.shape.
// result.curbHit says the car just climbed onto a curb, result.voidShape that it is over a hole.
// Breakable props are reported through onTouch.
export function collideWithWorld(car, world, result, onTouch) {
  result.impact = 0;
  result.shape = null;
  result.curbHit = false;
  result.voidShape = null;
  result.spikes = null;
  let onCurb = false;
  const r = R * car.scale;
  for (let i = 0; i < 2; i += 1) {
    carCircles(car, circles);
    const c = circles[i];
    world.forEachNear(c.x, c.y, r, (shape) => {
      if (!circleVsShape(c.x, c.y, r, shape, hit)) return;
      // Giant: holes and curbs mean nothing, and anything solid gets knocked away like a cone.
      if (car.crushing) {
        if (!shape.isVoid && !shape.curb && !shape.isSpikes && onTouch) onTouch(shape);
        return;
      }
      if (shape.isSpikes) {
        result.spikes = shape;
        return;
      }
      if (shape.isVoid) {
        if (circleVsShape(car.x, car.y, CENTRE_POINT, shape, hit)) result.voidShape = shape;
        return;
      }
      if (shape.curb) {
        if (car.plowing) return;
        // Only the first touch of a crossing counts, however long the car stays on.
        if (!onCurb && !car.onCurb) {
          climbCurb(car, hit.nx, hit.ny);
          result.curbHit = true;
        }
        onCurb = true;
        return;
      }
      if (!shape.solid) {
        if (onTouch) onTouch(shape);
        return;
      }
      const impact = bounceOffSurface(car, hit.nx, hit.ny, hit.depth);
      carCircles(car, circles);
      if (impact > result.impact) {
        result.impact = impact;
        result.shape = shape;
      }
    });
  }
  car.onCurb = onCurb;
  return result.impact;
}

const ca = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];
const cb = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

// Whether the last collideCars call found the two cars touching, even if they were already
// moving apart (and so had no impact).
export const carContact = { touched: false };

// Two cars. Pushes them apart, exchanges momentum, spins them for off-centre hits.
// Returns the impact speed (0 when they don't touch). Each car needs a `mass`.
export function collideCars(a, b) {
  carContact.touched = false;
  carCircles(a, ca);
  carCircles(b, cb);
  let best = -1;
  let bi = 0;
  let bj = 0;
  const reach = R * (a.scale + b.scale);
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const dx = ca[i].x - cb[j].x;
      const dy = ca[i].y - cb[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < reach * reach) {
        const depth = reach - Math.sqrt(d2);
        if (depth > best) {
          best = depth;
          bi = i;
          bj = j;
        }
      }
    }
  }
  if (best < 0) return 0;
  carContact.touched = true;

  let nx = ca[bi].x - cb[bj].x;
  let ny = ca[bi].y - cb[bj].y;
  const d = Math.hypot(nx, ny);
  if (d < 1e-6) {
    nx = 1;
    ny = 0;
  } else {
    nx /= d;
    ny /= d;
  }
  const ma = a.mass;
  const mb = b.mass;
  // Each is moved out of the overlap by its share; a Giant car is not moved at all.
  const share = 1 / (ma + mb);
  const moveA = a.crushing ? 0 : b.crushing ? 1 : mb * share;
  const moveB = b.crushing ? 0 : a.crushing ? 1 : ma * share;
  a.x += nx * best * moveA;
  a.y += ny * best * moveA;
  b.x -= nx * best * moveB;
  b.y -= ny * best * moveB;

  const vr = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vr >= 0) return 0;
  const j = (-(1 + COLLISION.carBounce) * vr) / (1 / ma + 1 / mb);
  a.vx += (nx * j) / ma;
  a.vy += (ny * j) / ma;
  b.vx -= (nx * j) / mb;
  b.vy -= (ny * j) / mb;

  // Off-centre hits spin the cars (contact point = between the two touching circles).
  const cx = (ca[bi].x + cb[bj].x) / 2;
  const cy = (ca[bi].y + cb[bj].y) / 2;
  a.angularVelocity += (((cx - a.x) * ny - (cy - a.y) * nx) * j * COLLISION.spin) / ma;
  b.angularVelocity -= (((cx - b.x) * ny - (cy - b.y) * nx) * j * COLLISION.spin) / mb;
  if (!a.plowing) deflectNose(a, nx, ny, -vr, 0.5);
  if (!b.plowing) deflectNose(b, -nx, -ny, -vr, 0.5);
  return -vr;
}

// Can these two cars touch at all? (cheap test before collideCars)
export const CAR_REACH = (OFF + R) * 2;
