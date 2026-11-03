import { PALETTE } from '../config/tuning.js';
import { shadeColor } from './lowpoly.js';

// What the ground marks of a chunk (WorldLayout's paint) are painted with, shared by the world (Scenery) and the map
// screen (mapDiorama), so the two always look the same.

const COLORS = {
  lot: 'lot', // the surface of a city block
  plaza: 'plaza', // a paved square
  curb: 'curb', // the cream edge of a block
  sidewalk: 'sidewalk', // the pavement inside it
  grass: 'lawn', // a block of lawn
  patch: 'asphaltPatchDark', // a repaired stretch of road
  crack: 'crack', // a crack in the road, and the rim of a manhole
  manhole: 'manhole', // a manhole's lid
};

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
