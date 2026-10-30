import { ARENA, COLLISION } from '../config/tuning.js';

// Collisions for the flat physics world. Pure maths, no Phaser.
//
// Shapes: every car is two circles (front and back); props are circles (trees, lamps, cones)
// or rotated boxes (islands, blocks, barriers); the arena edge is four straight walls.
// Results: "impact" = how fast the car was moving INTO the surface (units/s). A glancing scrape
// gives a small impact, a head-on hit a big one; the crash rules compare it to thresholds.

const CIRCLE = 0;
const BOX = 1;
const R = COLLISION.carCircleRadius;
const OFF = COLLISION.carCircleOffset;

const hit = { nx: 0, ny: 0, depth: 0 };

// Static props in a grid, so each car only looks at the few props near it.
export class StaticWorld {
  constructor(items) {
    this.cell = COLLISION.gridCell;
    this.cols = Math.ceil(ARENA.width / this.cell) + 2;
    this.rows = Math.ceil(ARENA.height / this.cell) + 2;
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
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
      solid: !item.breakable,
      item,
      seen: 0,
    };
    this.shapes.push(shape);
    this.forCells(shape.x, shape.y, shape.bound, (list) => list.push(shape));
    return shape;
  }

  forCells(x, y, r, visit) {
    const c0 = this.clampCol(Math.floor((x - r) / this.cell) + 1);
    const c1 = this.clampCol(Math.floor((x + r) / this.cell) + 1);
    const r0 = this.clampRow(Math.floor((y - r) / this.cell) + 1);
    const r1 = this.clampRow(Math.floor((y + r) / this.cell) + 1);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) visit(this.grid[row * this.cols + col]);
    }
  }

  clampCol(c) {
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  clampRow(r) {
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  // Calls visit(shape) once for every shape that may touch the circle (x, y, r).
  forEachNear(x, y, r, visit) {
    this.stamp += 1;
    const stamp = this.stamp;
    const c0 = this.clampCol(Math.floor((x - r) / this.cell) + 1);
    const c1 = this.clampCol(Math.floor((x + r) / this.cell) + 1);
    const r0 = this.clampRow(Math.floor((y - r) / this.cell) + 1);
    const r1 = this.clampRow(Math.floor((y + r) / this.cell) + 1);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const list = this.grid[row * this.cols + col];
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

  // Is the circle free of solid props and inside the arena (with `edge` to spare)?
  isClear(x, y, r, edge = 0) {
    if (x < r + edge || y < r + edge || x > ARENA.width - r - edge || y > ARENA.height - r - edge) return false;
    let clear = true;
    this.forEachNear(x, y, r, (shape) => {
      if (clear && shape.solid && circleVsShape(x, y, r, shape, hit)) clear = false;
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
  const fx = Math.sin(car.heading) * OFF;
  const fy = -Math.cos(car.heading) * OFF;
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

const circles = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

// Car against props and the arena edge. Returns the strongest impact; the prop involved (or
// 'wall') is written into result.shape. Breakable props (cones) are reported through onTouch.
export function collideWithWorld(car, world, result, onTouch) {
  result.impact = 0;
  result.shape = null;
  for (let i = 0; i < 2; i += 1) {
    carCircles(car, circles);
    const c = circles[i];
    world.forEachNear(c.x, c.y, R, (shape) => {
      if (!circleVsShape(c.x, c.y, R, shape, hit)) return;
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
    // Arena edge.
    carCircles(car, circles);
    const p = circles[i];
    let impact = 0;
    if (p.x < R) impact = Math.max(impact, bounceOffSurface(car, 1, 0, R - p.x));
    if (p.x > ARENA.width - R) impact = Math.max(impact, bounceOffSurface(car, -1, 0, p.x - (ARENA.width - R)));
    if (p.y < R) impact = Math.max(impact, bounceOffSurface(car, 0, 1, R - p.y));
    if (p.y > ARENA.height - R) impact = Math.max(impact, bounceOffSurface(car, 0, -1, p.y - (ARENA.height - R)));
    if (impact > result.impact) {
      result.impact = impact;
      result.shape = 'wall';
    }
  }
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

// Two cars. Pushes them apart, exchanges momentum, spins them for off-centre hits.
// Returns the impact speed (0 when they don't touch). Each car needs a `mass`.
export function collideCars(a, b) {
  carCircles(a, ca);
  carCircles(b, cb);
  let best = -1;
  let bi = 0;
  let bj = 0;
  const reach = R * 2;
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
  const share = 1 / (ma + mb);
  a.x += nx * best * mb * share;
  a.y += ny * best * mb * share;
  b.x -= nx * best * ma * share;
  b.y -= ny * best * ma * share;

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
  deflectNose(a, nx, ny, -vr, 0.5);
  deflectNose(b, -nx, -ny, -vr, 0.5);
  return -vr;
}

// Can these two cars touch at all? (cheap test before collideCars)
export const CAR_REACH = (OFF + R) * 2;
