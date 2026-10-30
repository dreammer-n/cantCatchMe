import { RENDER } from '../config/tuning.js';
import { wrapAngle } from '../utils/math.js';
import { carMesh } from './carModels.js';
import { boundsOf, paintMesh, projectMesh } from './lowpoly.js';
import { projection } from './projection.js';

// Directional car drawings, made at startup from the 3D low-poly model: RENDER.directions views
// evenly spaced around the compass, all through the current camera. Frames are named dir0 .. dir(N-1)
// (dir0 = facing north, then clockwise); every frame is the same size with the car's ground centre
// at the same pivot. All directions are drawn (no mirroring), because the light comes from one side.
// Real artwork can later replace this with a loaded atlas of the same layout.

const TAU = Math.PI * 2;
const COLUMNS = 8;
const PADDING = 2; // world units around the drawing inside each frame

export const atlasMeta = new Map(); // atlas key -> { originX, originY, cellW, cellH, width, height, directions }
const MAX_DIRECTIONS = Math.max(RENDER.directions, ...Object.values(RENDER.carDirections));
const FRAME_NAMES = Array.from({ length: MAX_DIRECTIONS }, (_, i) => `dir${i}`);

export function directionsFor(name) {
  return RENDER.carDirections[name] || RENDER.directions;
}

export function atlasKey(name, proj) {
  return `car:${name}:${proj.key}`;
}

export function directionHeading(index, directions = RENDER.directions) {
  return (index * TAU) / directions;
}

// Every view of the car, plus how far the drawings reach from the pivot (to size the frames).
export function measureCar(name, proj) {
  const mesh = carMesh(name);
  const directions = directionsFor(name);
  const views = [];
  let halfWidth = 0;
  let up = 0;
  let down = 0;
  for (let i = 0; i < directions; i += 1) {
    const projected = projectMesh(mesh, directionHeading(i, directions), proj);
    const b = boundsOf(projected);
    halfWidth = Math.max(halfWidth, -b.minX, b.maxX);
    up = Math.max(up, -b.minY);
    down = Math.max(down, b.maxY);
    views.push(projected);
  }
  return { views, halfWidth, up, down, directions };
}

export function atlasLayout(measure) {
  const scale = RENDER.bakeScale;
  const cellW = Math.ceil((measure.halfWidth + PADDING) * 2 * scale);
  const cellH = Math.ceil((measure.up + measure.down + PADDING * 2) * scale);
  const rows = Math.ceil((measure.directions || RENDER.directions) / COLUMNS);
  return { cellW, cellH, pivotY: (measure.up + PADDING) * scale, width: COLUMNS * cellW, height: rows * cellH };
}

// Builds the atlas for the current camera (once per camera setup). Returns its key.
export function ensureCarAtlas(scene, name, proj = projection) {
  const key = atlasKey(name, proj);
  if (scene.textures.exists(key)) return key;

  const measure = measureCar(name, proj);
  const { cellW, cellH, pivotY, width, height } = atlasLayout(measure);
  const scale = RENDER.bakeScale;
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture.context;
  measure.views.forEach((projected, i) => {
    const x = (i % COLUMNS) * cellW;
    const y = Math.floor(i / COLUMNS) * cellH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip(); // keep each view inside its own frame
    ctx.translate(x + cellW / 2, y + pivotY);
    ctx.scale(scale, scale);
    paintMesh(ctx, projected);
    ctx.restore();
    texture.add(FRAME_NAMES[i], 0, x, y, cellW, cellH);
  });
  texture.refresh();

  atlasMeta.set(key, { originX: 0.5, originY: pivotY / cellH, cellW, cellH, width, height, directions: measure.directions });
  return key;
}

// Picks the drawing for a world heading. Writes { frame, rotation } into `out`.
// rotation = small leftover angle between that drawing and the true on-screen direction.
export function frameFor(heading, proj, out = { frame: 'dir0', rotation: 0 }, directions = RENDER.directions) {
  const n = directions;
  const step = TAU / n;
  const turns = (((heading % TAU) + TAU) % TAU) / step;
  const index = Math.round(turns) % n;
  out.frame = FRAME_NAMES[index];
  out.rotation = wrapAngle(proj.screenHeading(heading) - proj.screenHeading(index * step)) * RENDER.residualRotation;
  return out;
}
