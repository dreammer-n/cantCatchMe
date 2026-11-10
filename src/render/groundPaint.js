import { PALETTE } from '../config/tuning.js';
import { createRng } from '../utils/math.js';
import { shadeColor } from './lowpoly.js';

// What the ground marks of a chunk (WorldLayout's paint) are painted with, shared by the world (Scenery) and the map
// screen (mapDiorama), so the two always look the same.

const COLORS = {
  lot: 'lot', // the surface of a city block
  plaza: 'plaza', // a paved square
  curb: 'curb', // the cream edge of an island
  leaves: 'leafLitter',
  lawnDry: 'lawnDry',
  lawnLush: 'lawnLush',
  sidewalk: 'sidewalk', // the pavement inside it
  grass: 'lawn', // a block of lawn
  patch: 'asphaltPatchDark', // a repaired stretch of road
  crack: 'crack', // a crack in the road, and the rim of a manhole
  manhole: 'manhole', // a manhole's lid
  dirt: 'dirt', // a path through the woods
  grassDark: 'grassDark', // the Woods ground: patches, tufts, grass tracks
  grassLight: 'grassLight',
  mud: 'mud', // mud roads and ruts
  mudDark: 'mudDark',
  puddle: 'puddle',
  asphalt: 'asphalt', // broken pieces of old road, and rounded crossing corners
};

// The drawing of a chunk's surfaces (WorldLayout): ice, soft sand and river water, as filled polygons
// [{ points: [{ x, y }], color, alpha }] in the order they are painted. Shared by the world and the map screen.
// The details come from each surface's own position, so they are always the same.
export function surfacePaint(chunk) {
  const out = [];
  for (const s of chunk.surfaces || []) {
    if (s.kind === 'river') riverPaint(s, out);
    else if (s.kind === 'ice') icePaint(s, out);
    else sandPaint(s, out);
  }
  return out;
}

const scaled = (s, points, factor) => points.map((p) => ({ x: s.x + (p.x - s.x) * factor, y: s.y + (p.y - s.y) * factor }));
// Across a river only, so its ends stay on the chunk border and meet the next chunk's river exactly.
const widened = (s, points, factor) => points.map((p) => ({ x: p.x, y: s.y + (p.y - s.y) * factor }));

// A polygon along a line of points, `width` wide, thinning to `tipShare` of that at both ends.
function strip(points, width, tipShare = 1) {
  const left = [];
  const right = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const t = points.length > 1 ? i / (points.length - 1) : 0.5;
    const half = (width / 2) * (tipShare + (1 - tipShare) * Math.sin(t * Math.PI));
    left.push({ x: points[i].x - (dy / length) * half, y: points[i].y + (dx / length) * half });
    right.push({ x: points[i].x + (dy / length) * half, y: points[i].y - (dx / length) * half });
  }
  return [...left, ...right.reverse()];
}

// A small lumpy blob, for mottling, pebbles and snow dust.
function blob(rng, x, y, r, sides = 7, squash = 1) {
  const spin = rng() * Math.PI * 2;
  return Array.from({ length: sides }, (_, i) => {
    const a = spin + (i / sides) * Math.PI * 2;
    const reach = r * (0.75 + rng() * 0.5);
    return { x: x + Math.cos(a) * reach, y: y + Math.sin(a) * reach * squash };
  });
}

// A point inside the patch, up to `share` of its radius from the middle.
function inside(s, rng, share) {
  const a = rng() * Math.PI * 2;
  const d = s.collider.r * share * Math.sqrt(rng());
  return { x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d };
}

// Ice: soft frosty edges fading into the snow, glossy blue ice, thin jagged cracks, curved glints of shine
// and a few drifts of snow dust over it. A pond gets a bank of snow round it.
function icePaint(s, out) {
  const rng = createRng(Math.floor(s.x * 7 + s.y * 13) >>> 0);
  const r = s.collider.r;
  if (s.pond) {
    out.push({ points: scaled(s, s.outline, 1.2), color: PALETTE.snow, alpha: 0.45 });
    out.push({ points: scaled(s, s.outline, 1.11), color: PALETTE.snow, alpha: 1 });
  }
  out.push({ points: scaled(s, s.outline, 1.13), color: PALETTE.iceRim, alpha: 0.3 });
  out.push({ points: scaled(s, s.outline, 1.06), color: PALETTE.iceRim, alpha: 0.7 });
  out.push({ points: s.outline, color: PALETTE.ice, alpha: 0.95 });
  // Lighter toward the top left, where the light comes off it: the ice looks polished.
  const toLight = { x: -r * 0.12, y: -r * 0.12 };
  out.push({ points: scaled(s, s.outline, 0.72).map((p) => ({ x: p.x + toLight.x, y: p.y + toLight.y })), color: PALETTE.iceLight, alpha: 0.55 });
  // Cracks: jagged lines from a point inside out toward the edge, a dark line with a white one beside it.
  const cracks = s.pond ? 6 : 3 + Math.floor(rng() * 2);
  for (let k = 0; k < cracks; k += 1) {
    const start = inside(s, rng, 0.5);
    let angle = rng() * Math.PI * 2;
    const line = [start];
    const steps = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < steps; i += 1) {
      angle += (rng() - 0.5) * 1.2;
      const last = line[line.length - 1];
      const length = r * (0.12 + rng() * 0.12);
      line.push({ x: last.x + Math.cos(angle) * length, y: last.y + Math.sin(angle) * length });
    }
    out.push({ points: strip(line.map((p) => ({ x: p.x + 1.2, y: p.y + 1.2 })), 2.2, 0.3), color: PALETTE.iceCrack, alpha: 0.55 });
    out.push({ points: strip(line, 1.6, 0.3), color: PALETTE.iceShine, alpha: 0.85 });
  }
  // Two curved glints near the lit side.
  for (const [from, to, reach] of [[3.6, 4.4, 0.62], [3.75, 4.15, 0.42]]) {
    const arc = Array.from({ length: 7 }, (_, i) => {
      const a = from + ((to - from) * i) / 6;
      return { x: s.x + Math.cos(a) * r * reach, y: s.y + Math.sin(a) * r * reach };
    });
    out.push({ points: strip(arc, r * 0.06, 0.15), color: 0xffffff, alpha: 0.8 });
  }
  // Snow dust blown over it, thickest near the edge.
  const dust = s.pond ? 7 : 4;
  for (let k = 0; k < dust; k += 1) {
    const p = inside(s, rng, 0.85);
    out.push({ points: blob(rng, p.x, p.y, r * (0.08 + rng() * 0.1), 8, 0.7), color: PALETTE.snow, alpha: 0.5 });
  }
}

// Soft sand: damp, packed sand, darker than the desert round it, with soft edges, blotches, the curved ruts of
// tires that went through it and a few pebbles.
function sandPaint(s, out) {
  const rng = createRng(Math.floor(s.x * 11 + s.y * 5) >>> 0);
  const r = s.collider.r;
  out.push({ points: scaled(s, s.outline, 1.16), color: PALETTE.softSand, alpha: 0.18 });
  out.push({ points: scaled(s, s.outline, 1.07), color: PALETTE.softSand, alpha: 0.4 });
  out.push({ points: s.outline, color: PALETTE.dampSand, alpha: 0.8 });
  for (let k = 0; k < 6; k += 1) {
    const p = inside(s, rng, 0.65);
    out.push({ points: blob(rng, p.x, p.y, r * (0.14 + rng() * 0.16), 7, 0.75), color: k % 2 ? PALETTE.sandDark : PALETTE.softSand, alpha: 0.3 });
  }
  // Two pairs of tire ruts curving across it.
  for (let k = 0; k < 2; k += 1) {
    const bend = (rng() < 0.5 ? -1 : 1) * r * (1.6 + rng());
    const turn = rng() * Math.PI;
    const cx = s.x + Math.cos(turn) * bend;
    const cy = s.y + Math.sin(turn) * bend;
    const radius = Math.abs(bend) + (rng() - 0.5) * r * 0.4;
    const facing = Math.atan2(s.y - cy, s.x - cx);
    const span = (r * 1.6) / radius;
    for (const gauge of [-11, 11]) {
      const arc = Array.from({ length: 9 }, (_, i) => {
        const a = facing - span / 2 + (span * i) / 8;
        return { x: cx + Math.cos(a) * (radius + gauge), y: cy + Math.sin(a) * (radius + gauge) };
      });
      out.push({ points: strip(arc, 5, 0.2), color: PALETTE.sandDark, alpha: 0.45 });
    }
  }
  for (let k = 0; k < 7; k += 1) {
    const p = inside(s, rng, 0.9);
    const size = 2 + rng() * 2.5;
    out.push({ points: blob(rng, p.x, p.y, size, 5), color: PALETTE.pebble, alpha: 0.9 });
    out.push({ points: blob(rng, p.x - size * 0.3, p.y - size * 0.3, size * 0.4, 4), color: PALETTE.sandRipple, alpha: 0.8 });
  }
}

// A river: muddy banks, the water, a darker channel down the middle and a few glints.
function riverPaint(s, out) {
  out.push({ points: widened(s, s.outline, 1.16), color: PALETTE.riverBank, alpha: 1 });
  out.push({ points: s.outline, color: PALETTE.river, alpha: 1 });
  out.push({ points: widened(s, s.outline, 0.45), color: PALETTE.riverDeep, alpha: 0.8 });
  const x0 = s.outline[0].x;
  const x1 = s.outline[Math.floor(s.outline.length / 2) - 1].x;
  for (let k = 0; k < 9; k += 1) {
    const x = x0 + ((k + 0.5) / 9) * (x1 - x0) + ((s.seed * (k + 3)) % 90) - 45;
    const y = s.y + ((((s.seed >> 3) * (k + 1)) % 120) - 60);
    out.push({ points: [{ x: x - 34, y }, { x, y: y - 3 }, { x: x + 34, y }, { x, y: y + 3 }], color: PALETTE.riverShine, alpha: 0.7 });
  }
}

// mark: { color, shade }. No colour = white road paint.
export function groundColor(mark) {
  const base = mark.color ? PALETTE[COLORS[mark.color]] : PALETTE.paintWhite;
  return mark.shade ? shadeColor(base, mark.shade) : base;
}

// The box round a flat polygon, worked out once and kept on it.
const boxes = new WeakMap();
function boxOf(flat) {
  let box = boxes.get(flat);
  if (!box) {
    box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < flat.length; i += 2) {
      box.x0 = Math.min(box.x0, flat[i]);
      box.x1 = Math.max(box.x1, flat[i]);
      box.y0 = Math.min(box.y0, flat[i + 1]);
      box.y1 = Math.max(box.y1, flat[i + 1]);
    }
    boxes.set(flat, box);
  }
  return box;
}

// A flat polygon [x, y, x, y, ...] cut to a rectangle (Sutherland-Hodgman). Returns [{ x, y }], empty if it misses.
// Most polygons are wholly in or out of a given rectangle, which their box shows without any cutting.
export function clipToRect(flat, x0, y0, x1, y1) {
  const box = boxOf(flat);
  if (box.x1 <= x0 || box.x0 >= x1 || box.y1 <= y0 || box.y0 >= y1) return [];
  let points = [];
  for (let i = 0; i < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
  if (box.x0 >= x0 && box.x1 <= x1 && box.y0 >= y0 && box.y1 <= y1) return points;
  const edges = [
    (p) => p.x >= x0,
    (p) => p.x <= x1,
    (p) => p.y >= y0,
    (p) => p.y <= y1,
  ];
  const crossings = [
    (a, b) => ({ x: x0, y: a.y + ((x0 - a.x) / (b.x - a.x)) * (b.y - a.y) }),
    (a, b) => ({ x: x1, y: a.y + ((x1 - a.x) / (b.x - a.x)) * (b.y - a.y) }),
    (a, b) => ({ x: a.x + ((y0 - a.y) / (b.y - a.y)) * (b.x - a.x), y: y0 }),
    (a, b) => ({ x: a.x + ((y1 - a.y) / (b.y - a.y)) * (b.x - a.x), y: y1 }),
  ];
  for (let e = 0; e < 4 && points.length > 0; e += 1) {
    const inside = edges[e];
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (inside(a)) {
        out.push(a);
        if (!inside(b)) out.push(crossings[e](a, b));
      } else if (inside(b)) out.push(crossings[e](a, b));
    }
    points = out;
  }
  return points.length >= 3 ? points : [];
}
