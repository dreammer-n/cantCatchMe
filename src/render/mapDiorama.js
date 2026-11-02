import { CHUNKS, EFFECTS, PALETTE, RENDER, START, WORLD } from '../config/tuning.js';
import { chunkCoord, buildChunk } from '../systems/WorldLayout.js';
import { carMesh } from './carModels.js';
import { cssColor, paintMesh, paintShadow, projectMesh, projectShadow } from './lowpoly.js';
import { projection } from './projection.js';
import { LAMP_REACH, propMesh } from './propModels.js';
import { groundMarksFor, paintBlob, paintDrift, paintPool } from './softShapes.js';

// A still view of a real map, for the map screen: the same ground, props and light as in play, around the place
// a run starts, with your car waiting there and a police car behind it. Drawn on a plain canvas, so browsing
// maps doesn't have to redraw the game's own world. The caller puts the map's colours in place first.

const STAMP = 128;
const SHADOW_SOFTNESS = 2; // canvas pixels of soft edge on the shadows
const MARGIN = 170; // world units: a prop this far off the canvas can still reach onto it
const stamps = new Map();
const point = { x: 0, y: 0 };

// A soft shape in one colour, kept for reuse.
function stamp(paint, color) {
  const key = `${paint.name}:${color}`;
  if (!stamps.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = STAMP;
    canvas.height = STAMP;
    const ctx = canvas.getContext('2d');
    paint(ctx, STAMP);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = cssColor(color);
    ctx.fillRect(0, 0, STAMP, STAMP);
    stamps.set(key, canvas);
  }
  return stamps.get(key);
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function drawStamp(ctx, image, x, y, rx, ry, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(image, -rx, -ry, rx * 2, ry * 2);
  ctx.restore();
}

function floorColor(color) {
  if (color === 'lot') return PALETTE.lot;
  if (color === 'plaza') return PALETTE.plaza;
  return PALETTE.paintWhite;
}

function drawArrow(ctx, mark) {
  const { arrowLength: length, arrowWidth: width } = WORLD;
  const fx = Math.sin(mark.heading);
  const fy = -Math.cos(mark.heading);
  const at = (along, across) => [mark.x + fx * along - fy * across, mark.y + fy * along + fx * across];
  const shaft = width * 0.17;
  const neck = length * 0.12;
  polygon(ctx, [at(-length / 2, -shaft), at(-length / 2, shaft), at(neck, shaft), at(neck, -shaft)]);
  polygon(ctx, [at(length / 2, 0), at(neck, -width / 2), at(neck, width / 2)]);
}

function drawGround(ctx, chunks, map) {
  for (const chunk of chunks) {
    for (const mark of chunk.paint) {
      ctx.globalAlpha = mark.alpha;
      if (mark.track) {
        const p = mark.pts;
        ctx.fillStyle = cssColor(PALETTE.track);
        polygon(ctx, [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]], [p[6], p[7]]]);
      } else if (mark.arrow) {
        ctx.fillStyle = cssColor(PALETTE.paintWhite);
        drawArrow(ctx, mark);
      } else if (!mark.ring) {
        ctx.fillStyle = cssColor(floorColor(mark.color));
        ctx.fillRect(mark.x, mark.y, mark.w, mark.h);
      }
    }
  }
  for (const chunk of chunks) {
    for (const mark of groundMarksFor(chunk, map, CHUNKS.size, WORLD.cell, WORLD.margin)) {
      ctx.globalAlpha = mark.alpha;
      drawStamp(ctx, stamp(mark.drift ? paintDrift : paintBlob, PALETTE[mark.color]), mark.x, mark.y, mark.rx, mark.ry, mark.angle);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = EFFECTS.lampPoolAlpha;
  for (const chunk of chunks) {
    for (const item of chunk.items) {
      if (item.kind !== 'lamp') continue;
      const x = item.x + Math.sin(item.heading) * LAMP_REACH;
      const y = item.y - Math.cos(item.heading) * LAMP_REACH;
      drawStamp(ctx, stamp(paintPool, PALETTE.lampGlow), x, y, EFFECTS.lampPoolRadius, EFFECTS.lampPoolRadius, 0);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  for (const chunk of chunks) {
    for (const hole of chunk.voids) {
      ctx.fillStyle = cssColor(PALETTE.voidWall);
      polygon(ctx, hole.outline.map((p) => [p.x, p.y]));
      ctx.fillStyle = cssColor(PALETTE.void);
      polygon(ctx, hole.outline.map((p) => [hole.x + (p.x - hole.x) * 0.84, hole.y + (p.y - hole.y) * 0.84]));
    }
  }
}

// ctx: drawing on a canvas width x height pixels. zoom: pixels per world unit. focusX, focusY: where on the canvas
// the car goes, so that it isn't under the buttons.
export function drawMapDiorama(ctx, map, carId, width, height, zoom, focusX, focusY) {
  projection.toScreen(START.x, START.y, 0, point);
  const originX = focusX - point.x * zoom;
  const originY = focusY - point.y * zoom;

  // Which chunks the canvas can see, and the props on them that can reach onto it.
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => projection.groundFromScreen((x - originX) / zoom, (y - originY) / zoom, { x: 0, y: 0 }));
  const span = (key) => {
    const values = corners.map((c) => chunkCoord(c[key]));
    return [Math.min(...values), Math.max(...values)];
  };
  const [cx0, cx1] = span('x');
  const [cy0, cy1] = span('y');
  const chunks = [];
  for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) chunks.push(buildChunk(cx, cy, WORLD.seed, map));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = cssColor(PALETTE.asphalt);
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(zoom * projection.cosA, zoom * projection.sinA * projection.squash, -zoom * projection.sinA, zoom * projection.cosA * projection.squash, originX, originY);
  drawGround(ctx, chunks, map);

  // The things standing on the ground, far ones first; low islands and overhead roofs in their own places.
  const meshes = new Map();
  const things = [];
  for (const chunk of chunks) {
    for (const item of chunk.items) {
      projection.toScreen(item.x, item.y, 0, point);
      const sx = originX + point.x * zoom;
      const sy = originY + point.y * zoom;
      const reach = MARGIN * zoom;
      if (sx < -reach || sx > width + reach || sy < -reach || sy > height + reach * 1.5) continue;
      if (!meshes.has(item.model)) meshes.set(item.model, propMesh(item));
      const band = item.band === 'raised' ? 0 : item.band === 'overhead' ? 2 : 1;
      things.push({ x: item.x, y: item.y, heading: item.heading, mesh: meshes.get(item.model), band });
    }
  }
  things.push({ x: START.x, y: START.y, heading: 0, mesh: carMesh(carId), band: 1 });
  things.push({ x: START.x - 110, y: START.y + 210, heading: 0.35, mesh: carMesh('police'), band: 1 });
  for (const thing of things) thing.depth = thing.band * 1e6 + projection.depthOf(thing.x, thing.y);
  things.sort((a, b) => a.depth - b.depth);

  const place = (target, thing) => {
    projection.toScreen(thing.x, thing.y, 0, point);
    target.setTransform(zoom, 0, 0, zoom, originX + point.x * zoom, originY + point.y * zoom);
  };

  // Shadows go on a sheet of their own, so where two overlap it isn't twice as dark.
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const shade = sheet.getContext('2d');
  for (const thing of things) {
    place(shade, thing);
    paintShadow(shade, projectShadow(thing.mesh, thing.heading, projection), SHADOW_SOFTNESS);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = RENDER.shadowAlpha;
  ctx.drawImage(sheet, 0, 0);
  ctx.globalAlpha = 1;
  sheet.width = 0;

  for (const thing of things) {
    place(ctx, thing);
    paintMesh(ctx, projectMesh(thing.mesh, thing.heading, projection));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
