import { RENDER } from '../config/tuning.js';

// Tiny flat-shaded low-poly renderer (no 3D engine).
//
// Objects are built from a few convex solids ("parts"): boxes, tapered boxes and simple cones.
// Each is drawn through the camera projection: faces turned away from the camera are skipped,
// every visible face gets one flat colour from the fixed light, and parts are painted back to front.
// Because the camera never rotates, a prop only needs drawing once, and a car only once per
// direction, so this all runs at startup and the game itself just shows images.
//
// Local axes of a model: x = right, y = forward (the way it faces), z = up. World units.

const ZERO_RECT = { x0: 0, x1: 0, y0: 0, y1: 0 };

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

const KEY = normalize(RENDER.keyLight);
const FILL = normalize(RENDER.fillLight);

// ---------------------------------------------------------------------------------------------
// Building shapes
// ---------------------------------------------------------------------------------------------

function faceColors(colors) {
  return typeof colors === 'number' ? { all: colors } : colors;
}

function pickColor(colors, name) {
  return colors[name] ?? (name === 'top' ? colors.top : colors.sides) ?? colors.all;
}

// Six-sided solid from 4 bottom and 4 top corners, each [x, y, z], listed back-left, back-right,
// front-right, front-left (y grows toward the front). Corners can be at different heights, which
// gives sloped hoods, windscreens and boot lids. Must stay convex. `layer` decides paint order
// between parts (lower first); parts in the same layer are painted far to near.
export function hexa(bottom, top, colors, layer = 0) {
  const c = faceColors(colors);
  const verts = [...bottom, ...top];
  // Side faces list two bottom corners then the two top corners above them (for decals).
  const faces = [
    { name: 'back', v: [0, 1, 5, 4] },
    { name: 'right', v: [1, 2, 6, 5] },
    { name: 'front', v: [2, 3, 7, 6] },
    { name: 'left', v: [3, 0, 4, 7] },
    { name: 'top', v: [4, 5, 6, 7] },
  ].map((face) => ({ ...face, color: pickColor(c, face.name), decals: [] }));
  return { verts, faces, layer };
}

function corners(r, z) {
  const zz = Array.isArray(z) ? z : [z, z, z, z];
  return [
    [r.x0, r.y0, zz[0]],
    [r.x1, r.y0, zz[1]],
    [r.x1, r.y1, zz[2]],
    [r.x0, r.y1, zz[3]],
  ];
}

// A box whose top can be smaller or shifted (curbs, bevels, cabins). Rectangles are
// { x0, x1, y0, y1 } in local units; y1 is the front. z0/z1 may be a number or 4 corner heights
// (back-left, back-right, front-right, front-left).
export function frustum(bottom, top, z0, z1, colors, layer = 0) {
  return hexa(corners(bottom, z0), corners(top, z1), colors, layer);
}

export function box(x0, x1, y0, y1, z0, z1, colors, layer = 0) {
  const rect = { x0, x1, y0, y1 };
  return frustum(rect, rect, z0, z1, colors, layer);
}

// Rectangle helper centred on (x, y).
export function rect(x, y, width, length) {
  return { x0: x - width / 2, x1: x + width / 2, y0: y - length / 2, y1: y + length / 2 };
}

// Many-sided column or cone (tree trunks, tree crowns, traffic cones). r1 = 0 makes a point.
export function ngon({ x = 0, y = 0, sides, r0, r1, z0, z1, color, topColor = color, rotation = 0, layer = 0 }) {
  const verts = [];
  for (let i = 0; i < sides; i += 1) {
    const a = rotation + (i * Math.PI * 2) / sides;
    verts.push([x + r0 * Math.cos(a), y + r0 * Math.sin(a), z0]);
  }
  const apex = r1 <= 0;
  if (apex) verts.push([x, y, z1]);
  else {
    for (let i = 0; i < sides; i += 1) {
      const a = rotation + (i * Math.PI * 2) / sides;
      verts.push([x + r1 * Math.cos(a), y + r1 * Math.sin(a), z1]);
    }
  }
  const faces = [];
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    faces.push({
      name: `side${i}`,
      v: apex ? [i, j, sides] : [i, j, sides + j, sides + i],
      color,
      decals: [],
    });
  }
  if (!apex) faces.push({ name: 'top', v: verts.slice(sides).map((_, i) => sides + i), color: topColor, decals: [] });
  return { verts, faces, layer };
}

const SHELL_SIDES = ['back', 'backRight', 'right', 'frontRight', 'front', 'frontLeft', 'left', 'backLeft'];

// One level of a shell: a rectangle with its four corners cut off. z = a height, or [back, front] for a slope.
function shellRing(hw, y0, y1, z, cutBack, cutFront) {
  const [zb, zf] = Array.isArray(z) ? z : [z, z];
  const cutB = Math.min(cutBack, (y1 - y0) * 0.45); // a short panel can't lose more than it has
  const cutF = Math.min(cutFront, (y1 - y0) * 0.45);
  const at = (y) => zb + ((y - y0) / (y1 - y0 || 1)) * (zf - zb);
  return [
    [-hw + cutB, y0, at(y0)],
    [hw - cutB, y0, at(y0)],
    [hw, y0 + cutB, at(y0 + cutB)],
    [hw, y1 - cutF, at(y1 - cutF)],
    [hw - cutF, y1, at(y1)],
    [-hw + cutF, y1, at(y1)],
    [-hw, y1 - cutF, at(y1 - cutF)],
    [-hw, y0 + cutB, at(y0 + cutB)],
  ];
}

// A body panel: a convex solid with cut corners and a bevelled top edge, so it catches the light like pressed
// metal. hw = half width at the bottom, y0 = back, y1 = front. z1 may be [back, front]. cut, bevel: how much is
// taken off the corners and the top edge; cutB / cutF, bevelB / bevelF set the back and front ends on their own
// (0 where one panel joins the next). lean, leanB, leanF draw the sides and ends in toward the top, as on a
// windscreen. Faces are named back, right, front, left and top, like a box, so decal() works the same.
export function shell({ hw, y0, y1, z0, z1, color, cut = 2.5, cutB = cut, cutF = cut, bevel = 1.5, bevelB = bevel, bevelF = bevel, lean = 0, leanB = 0, leanF = 0, layer = 0 }) {
  const [zb, zf] = Array.isArray(z1) ? z1 : [z1, z1];
  const rings = [shellRing(hw, y0, y1, z0, cutB, cutF), shellRing(hw - lean, y0 + leanB, y1 - leanF, [zb - bevel, zf - bevel], cutB, cutF)];
  const topHw = hw - lean - bevel;
  const topY0 = y0 + leanB + bevelB;
  const topY1 = y1 - leanF - bevelF;
  if (bevel > 0) rings.push(shellRing(topHw, topY0, topY1, [zb, zf], cutB, cutF));
  const verts = rings.flat();
  const faces = [];
  const count = 8;
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let k = 0; k < count; k += 1) {
      const a = r * count + k;
      const b = r * count + ((k + 1) % count);
      const c = (r + 1) * count + ((k + 1) % count);
      const d = (r + 1) * count + k;
      // Where a corner isn't cut, its face has no width.
      if (Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]) < 1e-6) continue;
      faces.push({ name: r === 0 ? SHELL_SIDES[k] : `${SHELL_SIDES[k]}Bevel`, v: [a, b, c, d], color, decals: [] });
    }
  }
  const last = (rings.length - 1) * count;
  const topCut = bevel > 0 ? topHw : hw - lean;
  const backY = bevel > 0 ? topY0 : y0 + leanB;
  const frontY = bevel > 0 ? topY1 : y1 - leanF;
  faces.push({
    name: 'top',
    v: Array.from({ length: count }, (_, i) => last + i),
    color,
    decals: [],
    // The full rectangle of the top, so decal() can place things across it.
    quad: [[-topCut, backY, zb], [topCut, backY, zb], [topCut, frontY, zf], [-topCut, frontY, zf]],
  });
  return { verts, faces, layer, minX: -hw, maxX: hw };
}

// A faceted round solid: rings of points, each turned half a step from the last, joined by triangles, with
// a little variation in colour from facet to facet. rings: [height share, radius share] from the bottom up,
// the last being its point on top. squash flattens it, for a rock.
export function faceted({ x = 0, y = 0, z0, z1, radius, color, sides = 7, layer = 0, rings = [[0, 0.5], [0.3, 1], [0.68, 0.84], [1, 0]] }) {
  const verts = [];
  const ringStart = [];
  rings.forEach(([h, r], index) => {
    ringStart.push(verts.length);
    const count = r === 0 ? 1 : sides;
    for (let i = 0; i < count; i += 1) {
      const a = ((i + (index % 2) * 0.5) * Math.PI * 2) / sides;
      verts.push([x + radius * r * Math.cos(a), y + radius * r * Math.sin(a), z0 + (z1 - z0) * h]);
    }
  });
  const faces = [];
  const tone = (n) => shadeColor(color, 0.92 + ((n * 7) % 5) * 0.045);
  const face = (v, n) => faces.push({ name: `facet${n}`, v, color: tone(n), decals: [] });
  let n = 0;
  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = ringStart[r];
    const b = ringStart[r + 1];
    const toPoint = rings[r + 1][1] === 0;
    const odd = r % 2 === 1;
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      if (toPoint) {
        face([a + i, a + j, b], n);
        n += 1;
      } else if (odd) {
        face([a + i, a + j, b + j], n);
        face([a + i, b + j, b + i], n + 1);
        n += 2;
      } else {
        face([a + i, a + j, b + i], n);
        face([a + j, b + j, b + i], n + 1);
        n += 2;
      }
    }
  }
  return { verts, faces, layer };
}

// A round wheel, its axle along local x: a many-sided drum with a hub painted on the outer face (side -1 =
// the car's left, 1 = its right). radius sets its height too: it stands on z = 0.
export function roundWheel({ x0, x1, y, radius, color, hub, side, sides = 10 }) {
  const verts = [];
  for (const x of [x0, x1]) {
    for (let i = 0; i < sides; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
      verts.push([x, y + radius * Math.cos(a), radius + radius * Math.sin(a)]);
    }
  }
  const faces = [];
  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides;
    faces.push({ name: `tread${i}`, v: [i, j, sides + j, sides + i], color, decals: [] });
  }
  const wall = shadeColor(color, 1.5);
  const ring = (start) => Array.from({ length: sides }, (_, i) => start + i);
  faces.push({ name: 'inner', v: side < 0 ? ring(sides) : ring(0), color: wall, decals: [] });
  const outer = { name: 'outer', v: side < 0 ? ring(0) : ring(sides), color: wall, decals: [] };
  const outerX = side < 0 ? x0 : x1;
  const disc = (share, discColor) => ({
    pts: Array.from({ length: sides }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
      return [outerX, y + radius * share * Math.cos(a), radius + radius * share * Math.sin(a)];
    }),
    color: discColor,
    unlit: false,
  });
  outer.decals.push(disc(0.56, hub), disc(0.18, shadeColor(hub, 0.55)));
  faces.push(outer);
  return { verts, faces, layer: 0 };
}

// A chunky wheel for the pressed-body cars: the tread's outer edge is taken off, and the outer face carries a
// tire wall, a contrasting rim and a dark centre.
export function chunkyWheel({ x0, x1, y, radius, color, rim, hub, side, sides = 12, chamfer = 1.1, layer = 0 }) {
  const outerX = side < 0 ? x0 : x1;
  const innerX = side < 0 ? x1 : x0;
  const point = (x, share, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    return [x, y + radius * share * Math.cos(a), radius + radius * share * Math.sin(a)];
  };
  const verts = [];
  for (const [x, share] of [[innerX, 1], [outerX - side * chamfer, 1], [outerX, 1 - chamfer / radius]]) {
    for (let i = 0; i < sides; i += 1) verts.push(point(x, share, i));
  }
  const faces = [];
  for (let r = 0; r < 2; r += 1) {
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      faces.push({ name: `${r ? 'edge' : 'tread'}${i}`, v: [r * sides + i, r * sides + j, (r + 1) * sides + j, (r + 1) * sides + i], color, decals: [] });
    }
  }
  const ring = (start) => Array.from({ length: sides }, (_, i) => start + i);
  faces.push({ name: 'inner', v: ring(0), color, decals: [] });
  const disc = (share, discColor) => ({ pts: Array.from({ length: sides }, (_, i) => point(outerX, share, i)), color: discColor, unlit: false });
  faces.push({
    name: 'outer',
    v: ring(sides * 2),
    color: shadeColor(color, 1.5),
    decals: [disc(0.64, rim), disc(0.46, shadeColor(rim, 0.62)), disc(0.24, hub)],
  });
  return { verts, faces, layer };
}

// A body built from slices, back to front, like the frames of a real car: each station is { y, half }, half
// being the same number of [x, z] points on its right side, from the bottom edge up to the inner edge of the
// top. The left side is the mirror image; the underneath stays open, since it is never seen. Unlike a shell it
// need not be convex, so it can have wheel arches, a waist and a raised hood: its faces are sorted when drawn.
// paint(band, yMiddle) gives each face's colour (band = the gap between two half points; the last is the top).
// Faces are named right0:3, left0:3 (band, then the gap between stations) and top:3, plus front and back.
export function loft({ stations, paint, layer = 0 }) {
  const n = stations[0].half.length;
  const size = n * 2;
  const verts = [];
  for (const { y, half } of stations) {
    for (const [x, z] of half) verts.push([x, y, z]);
    for (let i = n - 1; i >= 0; i -= 1) verts.push([-half[i][0], y, half[i][1]]);
  }
  const faces = [];
  const heights = (station) => station.half.map((p) => p[1]);
  // A point each face looks away from. Well below the body, since a top can dip below its own fenders, and the
  // inner slope of a fender has to count as facing up.
  const floor = Math.min(...stations.flatMap(heights)) - 40;
  const middleOf = (a, b) => [0, (a.y + b.y) / 2, floor];
  const add = (name, v, band, inside, quad = v.map((i) => verts[i])) => {
    faces.push({ name, v, color: paint(band, inside[1]), decals: [], inside, quad });
  };
  for (let s = 0; s < stations.length - 1; s += 1) {
    const a = s * size;
    const c = (s + 1) * size;
    const inside = middleOf(stations[s], stations[s + 1]);
    for (let band = 0; band < n - 1; band += 1) {
      add(`right${band}:${s}`, [a + band, c + band, c + band + 1, a + band + 1], band, inside);
      const low = size - 1 - band;
      const high = size - 2 - band;
      add(`left${band}:${s}`, [a + low, c + low, c + high, a + high], band, inside);
    }
    add(`top:${s}`, [a + n, a + n - 1, c + n - 1, c + n], n - 1, inside);
  }
  const cap = (name, index, next) => {
    const { y, half } = stations[index];
    const zs = heights(stations[index]);
    const x = Math.max(...half.map((p) => p[0]));
    const low = Math.min(...zs);
    const high = Math.max(...zs);
    const quad = [[-x, y, low], [x, y, low], [x, y, high], [-x, y, high]];
    add(name, Array.from({ length: size }, (_, i) => index * size + i), 1, middleOf(stations[index], stations[next]), quad);
  };
  cap('back', 0, 1);
  cap('front', stations.length - 1, stations.length - 2);
  return { verts, faces, layer, sortFaces: true, stations };
}

// Paints a smaller rectangle onto one face of a part (windows, lights, stripes).
// u runs along the face's first edge, v from that edge to the opposite one (bottom to top on sides,
// back to front on the top face). 0..1 each.
export function decal(part, faceName, u0, u1, v0, v1, color, unlit = false) {
  const face = part.faces.find((f) => f.name === faceName);
  const [p0, p1, p2, p3] = face.quad || face.v.map((i) => part.verts[i]);
  const at = (u, v) => {
    const a = lerp3(p0, p1, u);
    const b = lerp3(p3, p2, u);
    return lerp3(a, b, v);
  };
  face.decals.push({ pts: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], color, unlit });
  return part;
}

// Faces that glow (lamps) keep their colour whatever the light.
export function glowing(part) {
  for (const face of part.faces) face.unlit = true;
  return part;
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------------------------------------
// Projecting and shading
// ---------------------------------------------------------------------------------------------

// Local point -> camera space { u: right, v: toward viewer, z: up } for an object turned to `heading`
// (radians, clockwise from north, same convention as the car physics).
function toCamera(point, heading, proj) {
  const [lx, ly, lz] = point;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  const wx = lx * Math.cos(heading) + ly * fx;
  const wy = lx * Math.sin(heading) + ly * fy;
  return {
    u: wx * proj.cosA - wy * proj.sinA,
    v: wx * proj.sinA + wy * proj.cosA,
    z: lz,
    wx,
    wy,
  };
}

function toScreen(c, proj) {
  return { x: c.u, y: c.v * proj.squash - c.z * proj.lift };
}

// Newell's method: robust normal for any flat polygon.
function polygonNormal(points) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    nx += (a.v - b.v) * (a.z + b.z);
    ny += (a.z - b.z) * (a.u + b.u);
    nz += (a.u - b.u) * (a.v + b.v);
  }
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function centre(points) {
  let u = 0;
  let v = 0;
  let z = 0;
  for (const p of points) {
    u += p.u;
    v += p.v;
    z += p.z;
  }
  return { u: u / points.length, v: v / points.length, z: z / points.length };
}

export function brightness(n) {
  const key = Math.max(0, n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2]);
  const fill = Math.max(0, n[0] * FILL[0] + n[1] * FILL[1] + n[2] * FILL[2]);
  return RENDER.ambient + RENDER.keyGain * key + RENDER.fillGain * fill + RENDER.skyGain * Math.max(0, n[2]);
}

const TOP_LIGHT = brightness([0, 0, 1]);

export function shadeColor(hex, factor) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((hex & 255) * factor));
  return (r << 16) | (g << 8) | b;
}

export function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

// Everything needed to paint one model at one heading: visible faces in paint order, with colour.
export function projectMesh(mesh, heading, proj) {
  const view = [0, proj.lift, proj.squash]; // direction toward the camera, in camera space
  const parts = mesh.map((part) => {
    const cam = part.verts.map((p) => toCamera(p, heading, proj));
    const middle = centre(cam);
    const faces = [];
    for (const face of part.faces) {
      const pts = face.v.map((i) => cam[i]);
      let n = polygonNormal(pts);
      const c = centre(pts);
      // Point the normal outward (away from the part's middle, or from a point the face says is inside it).
      const inner = face.inside ? toCamera(face.inside, heading, proj) : middle;
      if (n[0] * (c.u - inner.u) + n[1] * (c.v - inner.v) + n[2] * (c.z - inner.z) < 0) n = n.map((k) => -k);
      if (n[0] * view[0] + n[1] * view[1] + n[2] * view[2] <= 1e-4) continue; // faces away
      // The sun is low: a top that slopes even slightly would swing from bright to dark as a car turns, and
      // look like a different paint. Near-flat tops stay close to a flat top's light; bevels keep their contrast.
      const flatTop = Math.max(0, Math.min(1, (Math.abs(n[2]) - 0.9) / 0.1));
      const light = brightness(n) + (TOP_LIGHT - brightness(n)) * flatTop * 0.75;
      faces.push({
        name: face.name,
        nearness: c.v * proj.lift + c.z * proj.squash,
        pts: pts.map((p) => toScreen(p, proj)),
        color: face.unlit ? face.color : shadeColor(face.color, light),
        decals: face.decals.map((d) => ({
          pts: d.pts.map((p) => toScreen(toCamera(p, heading, proj), proj)),
          color: d.unlit ? d.color : shadeColor(d.color, light),
          joined: d.joined,
        })),
      });
    }
    if (part.sortFaces) faces.sort((a, b) => a.nearness - b.nearness); // only a convex part can skip this
    // Distance toward the camera, for painting far parts first.
    const nearness = middle.v * proj.lift + middle.z * proj.squash;
    return { layer: part.layer, nearness, faces, cam };
  });
  parts.sort((a, b) => a.layer - b.layer || a.nearness - b.nearness);
  return parts;
}

// Shadow of each part on the ground, as screen-space outlines (one convex outline per part).
export function projectShadow(mesh, heading, proj) {
  const offset = { x: 0, y: 0 };
  const flat = { x: 0, y: 0 };
  return mesh.map((part) => {
    const ground = part.verts.map((p) => {
      const c = toCamera(p, heading, proj);
      proj.shadowOffset(p[2], offset);
      proj.toScreen(c.wx + offset.x, c.wy + offset.y, 0, flat);
      return { x: flat.x, y: flat.y };
    });
    return convexHull(ground);
  });
}

// Shadow outline in WORLD ground coordinates for a model at (x, y, heading). For moving cars:
// drawn each frame in the shadow layer. Writes into `out` (array of {x, y}) and returns its length.
const shadowShift = { x: 0, y: 0 };
export function worldShadowOutline(points, x, y, heading, proj, out, scratch, scale = 1) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  for (let i = 0; i < points.length; i += 1) {
    const [px, py, pz] = points[i];
    const lx = px * scale;
    const ly = py * scale;
    proj.shadowOffset(pz * scale, shadowShift);
    scratch[i].x = x + lx * cos + ly * sin + shadowShift.x;
    scratch[i].y = y + lx * sin - ly * cos + shadowShift.y;
  }
  return convexHullInto(scratch, points.length, out);
}

// ---------------------------------------------------------------------------------------------
// Painting into a canvas (the 2D context is already moved to the model's ground point and scaled)
// ---------------------------------------------------------------------------------------------

function tracePolygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

export function paintMesh(ctx, projected) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = RENDER.seamWidth;
  for (const part of projected) {
    for (const face of part.faces) {
      const css = cssColor(face.color);
      tracePolygon(ctx, face.pts);
      ctx.fillStyle = css;
      ctx.strokeStyle = css;
      ctx.fill();
      ctx.stroke(); // closes hairline gaps between faces
      for (const d of face.decals) {
        tracePolygon(ctx, d.pts);
        ctx.fillStyle = cssColor(d.color);
        ctx.fill();
        if (d.joined) {
          // A stripe across several faces: closes the gaps between its pieces.
          ctx.strokeStyle = ctx.fillStyle;
          ctx.stroke();
        }
      }
    }
  }
}

const SHADOW_FAR = 8000;

// Shadows are painted fully dark; the image is shown semi-transparent, so overlapping parts
// don't make darker patches.
// blur: pixels of soft edge. The outlines are drawn far off the canvas and only their blur lands on it.
export function paintShadow(ctx, outlines, blur = 0) {
  const css = cssColor(RENDER.shadowColor);
  ctx.fillStyle = css;
  ctx.save();
  if (blur > 0) {
    const scale = ctx.getTransform().a;
    ctx.shadowColor = css;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = SHADOW_FAR;
    ctx.translate(-SHADOW_FAR / scale, 0);
  }
  for (const outline of outlines) {
    if (outline.length < 3) continue;
    tracePolygon(ctx, outline);
    ctx.fill();
  }
  ctx.restore();
}

// Screen-space box around a set of projected faces and/or shadow outlines.
export function boundsOf(projected, shadows = []) {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const grow = (p) => {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxY = Math.max(box.maxY, p.y);
  };
  for (const part of projected) for (const face of part.faces) face.pts.forEach(grow);
  for (const outline of shadows) outline.forEach(grow);
  if (box.minX === Infinity) return { ...ZERO_RECT, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return box;
}

// Draws a model once into its own texture. Returns { key, originX, originY, scale } for an Image
// (show the Image at 1 / scale). which: 'body' (the object) or 'shadow' (its ground shadow only).
const bakedMeta = new Map();
export function bakeMesh(scene, key, mesh, heading, proj, which = 'body', bodyScale = RENDER.bakeScale) {
  if (scene.textures.exists(key) && bakedMeta.has(key)) return bakedMeta.get(key);
  const scale = which === 'shadow' ? RENDER.shadowBakeScale : bodyScale;
  const pad = which === 'shadow' ? 2 + RENDER.shadowSoftness : 2;
  const projected = which === 'body' ? projectMesh(mesh, heading, proj) : [];
  const shadows = which === 'shadow' ? projectShadow(mesh, heading, proj) : [];
  const b = boundsOf(projected, shadows);
  const width = Math.max(2, Math.ceil((b.maxX - b.minX + pad * 2) * scale));
  const height = Math.max(2, Math.ceil((b.maxY - b.minY + pad * 2) * scale));
  const ox = (-b.minX + pad) * scale;
  const oy = (-b.minY + pad) * scale;

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture.context;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  if (which === 'body') paintMesh(ctx, projected);
  else paintShadow(ctx, shadows, RENDER.shadowSoftness * scale);
  ctx.restore();
  texture.refresh();

  const meta = { key, originX: ox / width, originY: oy / height, scale };
  bakedMeta.set(key, meta);
  return meta;
}

// Frees every baked drawing (cars and props) made for other camera setups. Called after a view
// change, so only one set of drawings is ever kept in graphics memory.
// Every prop drawing goes when the map changes: a new map's colours need new ones.
export function releasePropDrawings(scene) {
  for (const key of scene.textures.getTextureKeys()) {
    if (!key.startsWith('prop:')) continue;
    scene.textures.remove(key);
    bakedMeta.delete(key);
  }
}

export function releaseOtherViews(scene, viewKey) {
  for (const key of scene.textures.getTextureKeys()) {
    const baked = key.startsWith('prop:') || key.startsWith('car:');
    if (baked && !key.includes(`:${viewKey}`)) {
      scene.textures.remove(key);
      bakedMeta.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Convex hull (monotone chain)
// ---------------------------------------------------------------------------------------------

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points) {
  const out = points.map(() => ({ x: 0, y: 0 }));
  const n = convexHullInto(points.map((p) => ({ x: p.x, y: p.y })), points.length, out);
  return out.slice(0, n);
}

const hullScratch = [];

// Hull of the first `count` points (sorted in place). Writes the outline into `out`, returns its length.
export function convexHullInto(points, count, out) {
  const pts = points.length === count ? points : points.slice(0, count);
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  let k = 0;
  const hull = hullScratch;
  for (let i = 0; i < count; i += 1) {
    while (k >= 2 && cross(hull[k - 2], hull[k - 1], pts[i]) <= 0) k -= 1;
    hull[k++] = pts[i];
  }
  for (let i = count - 2, lower = k + 1; i >= 0; i -= 1) {
    while (k >= lower && cross(hull[k - 2], hull[k - 1], pts[i]) <= 0) k -= 1;
    hull[k++] = pts[i];
  }
  const length = Math.max(0, k - 1);
  for (let i = 0; i < length; i += 1) {
    out[i].x = hull[i].x;
    out[i].y = hull[i].y;
  }
  return length;
}
