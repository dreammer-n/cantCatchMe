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

// Paints a smaller rectangle onto one face of a part (windows, lights, stripes).
// u runs along the face's first edge, v from that edge to the opposite one (bottom to top on sides,
// back to front on the top face). 0..1 each.
export function decal(part, faceName, u0, u1, v0, v1, color, unlit = false) {
  const face = part.faces.find((f) => f.name === faceName);
  const [p0, p1, p2, p3] = face.v.map((i) => part.verts[i]);
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
      // Point the normal outward (away from the part's middle).
      if (n[0] * (c.u - middle.u) + n[1] * (c.v - middle.v) + n[2] * (c.z - middle.z) < 0) n = n.map((k) => -k);
      if (n[0] * view[0] + n[1] * view[1] + n[2] * view[2] <= 1e-4) continue; // faces away
      const light = brightness(n);
      faces.push({
        name: face.name,
        pts: pts.map((p) => toScreen(p, proj)),
        color: face.unlit ? face.color : shadeColor(face.color, light),
        decals: face.decals.map((d) => ({
          pts: d.pts.map((p) => toScreen(toCamera(p, heading, proj), proj)),
          color: d.unlit ? d.color : shadeColor(d.color, light),
        })),
      });
    }
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
export function worldShadowOutline(points, x, y, heading, proj, out, scratch) {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  for (let i = 0; i < points.length; i += 1) {
    const [lx, ly, lz] = points[i];
    proj.shadowOffset(lz, shadowShift);
    scratch[i].x = x + lx * cos + ly * sin + shadowShift.x;
    scratch[i].y = y + lx * sin - ly * cos + shadowShift.y;
  }
  return convexHullInto(scratch, points.length, out);
}

export function meshPoints(mesh) {
  return mesh.flatMap((part) => part.verts);
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
      }
    }
  }
}

// Shadows are painted fully dark; the image is shown semi-transparent, so overlapping parts
// don't make darker patches.
export function paintShadow(ctx, outlines) {
  ctx.fillStyle = cssColor(RENDER.shadowColor);
  for (const outline of outlines) {
    if (outline.length < 3) continue;
    tracePolygon(ctx, outline);
    ctx.fill();
  }
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
  const pad = 2;
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
  else paintShadow(ctx, shadows);
  ctx.restore();
  texture.refresh();

  const meta = { key, originX: ox / width, originY: oy / height, scale };
  bakedMeta.set(key, meta);
  return meta;
}

// Frees every baked drawing (cars and props) made for other camera setups. Called after a view
// change, so only one set of drawings is ever kept in graphics memory.
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
