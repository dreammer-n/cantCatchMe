import { createRng } from '../utils/math.js';

// Soft, irregular shapes painted in code: light on the ground, smoke, fire, burns and marks on the earth.
// All white, tinted when used. Nothing here may show a clean circle or a hard edge: built from overlapping
// lobes, each fading smoothly to nothing. Plain canvas drawing, so the map screen can use them too.

// Fades as (1 - t^2)^2 rather than in a straight line, which is what leaves no visible rim.
function smoothFade(gradient, peak) {
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    const fade = (1 - t * t) ** 2;
    gradient.addColorStop(t, `rgba(255,255,255,${(peak * fade).toFixed(3)})`);
  }
}

function lobe(ctx, x, y, r, peak) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  smoothFade(gradient, peak);
  ctx.fillStyle = gradient;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// A single perfectly smooth glow: flashes, police lights, soft shadows under small things.
export function paintGlow(ctx, size) {
  lobe(ctx, size / 2, size / 2, size / 2, 1);
}

// Lobes scattered round the middle. spread and lobeSize are shares of the half-size.
function lobes(ctx, size, seed, count, spread, lobeSize, peak) {
  const c = size / 2;
  const random = createRng(seed);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const reach = c * spread * Math.sqrt(random());
    const r = c * lobeSize * (0.7 + random() * 0.3);
    lobe(ctx, c + Math.cos(angle) * reach, c + Math.sin(angle) * reach, Math.min(r, c - reach), peak);
  }
}

// Light falling on the ground: bright in the middle, dying away unevenly.
export function paintPool(ctx, size) {
  lobe(ctx, size / 2, size / 2, size / 2, 0.55);
  lobes(ctx, size, 41, 7, 0.45, 0.5, 0.16);
}

// A cloud of smoke: a lumpy ball, lighter where the sun catches it.
export function paintPuff(ctx, size) {
  const c = size / 2;
  ctx.globalCompositeOperation = 'source-over';
  const random = createRng(151);
  for (let i = 0; i < 9; i += 1) {
    const angle = random() * Math.PI * 2;
    const reach = c * 0.42 * Math.sqrt(random());
    const r = Math.min(c * (0.42 + random() * 0.2), c - reach);
    const x = c + Math.cos(angle) * reach;
    const y = c + Math.sin(angle) * reach;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shade = Math.round(205 + 50 * Math.max(0, 1 - (x + y) / (size * 1.1)));
    gradient.addColorStop(0, `rgba(${shade},${shade},${shade},1)`);
    gradient.addColorStop(0.55, `rgba(${shade},${shade},${shade},0.85)`);
    gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// The heart of an explosion: white hot, through yellow and orange, with a lumpy edge.
export function paintFireCore(ctx, size) {
  const c = size / 2;
  const random = createRng(89);
  const blob = (x, y, r, colors) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    colors.forEach(([at, color]) => gradient.addColorStop(at, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + random() * 0.5;
    const reach = c * (0.34 + random() * 0.14);
    const r = c - reach;
    blob(c + Math.cos(angle) * reach, c + Math.sin(angle) * reach, r, [[0, 'rgba(255,150,40,0.95)'], [0.6, 'rgba(240,90,20,0.65)'], [1, 'rgba(180,40,10,0)']]);
  }
  blob(c, c, c * 0.8, [[0, 'rgba(255,255,245,1)'], [0.3, 'rgba(255,240,170,1)'], [0.6, 'rgba(255,190,60,0.9)'], [1, 'rgba(255,120,20,0)']]);
}

// A tiny hot ember.
export function paintEmber(ctx, size) {
  lobe(ctx, size / 2, size / 2, size / 2, 1);
  lobe(ctx, size / 2, size / 2, size / 4, 1);
}

// The ring a blast sends along the ground: brightest on its leading edge, fading behind.
export function paintRing(ctx, size) {
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.02)');
  gradient.addColorStop(0.82, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.89, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.97, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
}

// A burn on the ground: dark and uneven, with flecks thrown beyond its edge.
export function paintScorch(ctx, size) {
  const c = size / 2;
  lobes(ctx, size, 733, 16, 0.58, 0.42, 0.42);
  lobe(ctx, c, c, c * 0.58, 0.75);
  const random = createRng(734);
  for (let i = 0; i < 22; i += 1) {
    const angle = random() * Math.PI * 2;
    const reach = c * (0.55 + random() * 0.38);
    lobe(ctx, c + Math.cos(angle) * reach, c + Math.sin(angle) * reach, 1.5 + random() * c * 0.07, 0.8);
  }
}

// A wide, uneven patch on the ground: a worn place, a drift of snow, a sweep of sand.
export function paintBlob(ctx, size) {
  lobes(ctx, size, 271, 14, 0.62, 0.42, 0.32);
}

// A dune or snowdrift: a long crescent, sharp on the lee side and fading away on the other.
export function paintDrift(ctx, size) {
  const c = size / 2;
  const random = createRng(613);
  for (let i = 0; i < 26; i += 1) {
    const t = i / 25;
    const across = (t - 0.5) * size * 0.82 + (random() - 0.5) * 4;
    const bend = (1 - (2 * t - 1) ** 2) * size * 0.2;
    const r = size * (0.05 + 0.08 * Math.sin(Math.PI * t)) * (0.85 + random() * 0.3);
    lobe(ctx, c + across, c + size * 0.1 - bend, r, 0.34);
  }
}

// Marks on a chunk's ground, worked out from its seed: the same every visit. map.marks says what kind.
export function groundMarksFor(data, map, chunkSize, cell, margin) {
  const spec = map.marks;
  if (!spec) return [];
  const random = createRng(data.seed + 77);
  const count = Math.round(spec.perCell * (chunkSize / cell) ** 2);
  const marks = [];
  for (let i = 0; i < count; i += 1) {
    const r = spec.size[0] + random() * (spec.size[1] - spec.size[0]);
    const x = data.x0 + random() * chunkSize;
    const y = data.y0 + random() * chunkSize;
    const angle = random() * Math.PI * 2;
    const stretch = 1 + random() * (spec.stretch - 1);
    const drift = random() < (spec.drifts || 0);
    if (spec.lotOnly) {
      const room = margin + r * 0.5;
      if (Math.abs(x - Math.round(x / cell) * cell) < room || Math.abs(y - Math.round(y / cell) * cell) < room) continue;
    }
    marks.push({ x, y, angle, rx: r * stretch, ry: r, drift, color: spec.colors[i % spec.colors.length], alpha: spec.alpha });
  }
  return marks;
}
