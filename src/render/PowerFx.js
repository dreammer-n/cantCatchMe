import * as Phaser from 'phaser';
import { CAR_SIZE, DEPTH, FLAMER, POWER_LOOK, RENDER, SLICK } from '../config/tuning.js';
import { depthAt } from './layers.js';
import { bakeMesh, glowing, ngon } from './lowpoly.js';
import { projection } from './projection.js';

// The big power-up effects, in the game's own low-poly look: SCORCHER's fire is made of faceted flame cones
// drawn by the same renderer and light as the cars and props, set along the trail; TURBO's fire bursts from the
// exhaust as puffs of flame with a blue-hot core; SLICK's oil is one pool drawn as a shape. Drawing only: the
// power-ups themselves are in systems/PowerUpSystem.js.

const s0 = { x: 0, y: 0 };
const FLAME = POWER_LOOK.flame;
const NITRO = POWER_LOOK.nitro;
const OIL = POWER_LOOK.oil;

// A flame: a cluster of five-sided cones, darkest at the back, a bright yellow one in front. Its base is about
// FLAME.meshWidth across and its tallest cone FLAME.meshHeight high.
function flameMesh(variant) {
  const s = [1, 0.9, 1.08][variant];
  const turn = variant * 0.7;
  return [
    ngon({ x: 5, y: 6, sides: 5, r0: 10 * s, r1: 0, z0: 0, z1: 42 * s, color: FLAME.outer, rotation: turn, layer: 0 }),
    ngon({ x: -2, y: 1, sides: 5, r0: 13 * s, r1: 0, z0: 0, z1: FLAME.meshHeight * s, color: FLAME.middle, rotation: turn + 0.4, layer: 1 }),
    ngon({ x: -10, y: -2, sides: 4, r0: 7 * s, r1: 0, z0: 0, z1: 30 * s, color: FLAME.middle, rotation: turn + 1.1, layer: 2 }),
    glowing(ngon({ x: 3, y: -7, sides: 5, r0: 8 * s, r1: 0, z0: 0, z1: 34 * s, color: FLAME.core, rotation: turn + 0.9, layer: 3 })),
  ];
}

// A steady random number from 0 to 1 for a seed.
const noise = (seed) => {
  const v = Math.sin(seed * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

export class PowerFx {
  constructor(scene, layers) {
    this.scene = scene;
    this.trailGlow = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    layers.lights.add(this.trailGlow);
    // TURBO: the original exhaust fire, wider, with a small blue-hot core right at the exhaust.
    this.nitroFire = scene.add
      .particles(0, 0, 'fx-puff', {
        emitting: false,
        lifespan: { min: 280, max: 560 },
        speedX: { min: -14, max: 14 },
        speedY: { min: -70, max: -30 },
        scale: { start: NITRO.flameSize, end: 0.12 },
        color: NITRO.flame,
        maxAliveParticles: NITRO.maxFlames,
      })
      .setDepth(DEPTH.effects);
    this.nitroCore = scene.add
      .particles(0, 0, 'fx-puff', {
        emitting: false,
        lifespan: { min: 110, max: 200 },
        speedX: { min: -6, max: 6 },
        speedY: { min: -20, max: -6 },
        scale: { start: NITRO.coreSize, end: 0.08 },
        alpha: { start: 0.95, end: 0.4 },
        tint: NITRO.core,
        maxAliveParticles: NITRO.maxCore,
      })
      .setDepth(DEPTH.effects + 0.5);
    this.nitroClock = 0;
    this.nitroGlow = scene.add.image(0, 0, 'fx-pool').setBlendMode(Phaser.BlendModes.ADD).setTint(NITRO.glow).setVisible(false);
    layers.lights.add(this.nitroGlow);
    this.oil = scene.add.graphics();
    layers.ground.add(this.oil);
    // Dark-orange smoke rolling off the fire, and small glowing embers.
    this.smoke = scene.add
      .particles(0, 0, 'fx-puff', {
        emitting: false,
        lifespan: { min: 900, max: 1500 },
        speedX: { min: -14, max: 14 },
        speedY: { min: -46, max: -22 },
        scale: { start: 0.9, end: 2.4 },
        alpha: { start: 0.42, end: 0 },
        rotate: { min: 0, max: 360 },
        tint: FLAME.smoke,
        maxAliveParticles: FLAME.maxSmoke,
      })
      .setDepth(DEPTH.effects - 2);
    this.embers = scene.add
      .particles(0, 0, 'fx-ember', {
        emitting: false,
        lifespan: { min: 400, max: 900 },
        speedX: { min: -40, max: 40 },
        speedY: { min: -150, max: -60 },
        gravityY: 40,
        scale: { start: 0.45, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        tint: [0xfff3b0, 0xffd34a, 0xff9a2e],
        maxAliveParticles: FLAME.maxEmbers,
      })
      .setDepth(DEPTH.effects + 3);
    this.flames = []; // pooled flame images, shown each frame as needed
    this.used = 0;
    this.drawings = null;
    this.drawingsView = '';
    this.points = [];
    this.pool = Array.from({ length: FLAMER.maxPatches + 1 }, () => ({ x: 0, y: 0, w: 0, h: 0, seed: 0, life: 0 }));
    this.order = [];
    this.groups = new Map();
    this.smokeClock = 0;
  }

  clear() {
    for (const g of [this.trailGlow, this.oil]) g.clear();
    this.nitroFire.killAll();
    this.nitroCore.killAll();
    for (const image of this.flames) image.setVisible(false);
    this.nitroGlow.setVisible(false);
    this.smoke.killAll();
    this.embers.killAll();
  }

  // The flame drawings for the camera as it is now (drawn again if the debug tools change the view).
  flameDrawings() {
    const view = `${projection.azimuth.toFixed(3)}:${projection.squash.toFixed(3)}`;
    if (!this.drawings || this.drawingsView !== view) {
      this.drawingsView = view;
      this.drawings = [0, 1, 2].map((v) => bakeMesh(this.scene, `fx-flame-${v}-${view}`, flameMesh(v), 0, projection, 'body', RENDER.bakeScale));
    }
    return this.drawings;
  }

  // One flame standing on (x, y) on the ground, w wide and h tall (world units), at a draw depth.
  flame(x, y, w, h, variant, sway, depth) {
    let image = this.flames[this.used];
    if (!image) {
      image = this.scene.add.image(0, 0, '__DEFAULT');
      this.flames.push(image);
    }
    this.used += 1;
    const drawing = this.drawings[variant % 3];
    projection.toScreen(x, y, 0, s0);
    image
      .setTexture(drawing.key)
      .setOrigin(drawing.originX, drawing.originY)
      .setScale((w / FLAME.meshWidth) / drawing.scale, (h / FLAME.meshHeight) / drawing.scale)
      .setRotation(sway)
      .setPosition(s0.x, s0.y)
      .setDepth(depth)
      .setVisible(true);
  }

  // live: a run is going on (not the title screen).
  update(sim, time, dt, live) {
    this.flameDrawings();
    this.used = 0;
    this.drawFireTrail(sim.powerUps, sim.player, time, dt, live);
    this.drawBurningPolice(sim.police, time);
    for (let i = this.used; i < this.flames.length; i += 1) this.flames[i].setVisible(false);
    this.drawNitro(sim.player, sim.powerUps, dt, live);
    this.drawOil(sim.powerUps.puddles);
  }

  // ---- SCORCHER ----

  drawFireTrail(powerUps, player, time, dt, live) {
    const glow = this.trailGlow;
    glow.clear();
    const points = this.points;
    points.length = 0;
    let used = 0;
    const take = (x, y, life, seed) => {
      const p = this.pool[used];
      used += 1;
      p.x = x;
      p.y = y;
      p.life = life;
      p.seed = seed;
      points.push(p);
    };
    // The newest flames first, starting at the exhaust while the fire still pours out, so the trail is joined to
    // the car.
    const pouring = live && powerUps.flamerTime > 0;
    if (pouring) {
      const back = CAR_SIZE.length * 0.55 * player.scale;
      take(player.x - Math.sin(player.heading) * back, player.y + Math.cos(player.heading) * back, 1, 0);
    }
    const order = this.order;
    order.length = 0;
    for (const patch of powerUps.patches) if (patch.active) order.push(patch);
    order.sort((a, b) => a.age - b.age);
    for (const patch of order) take(patch.x, patch.y, 1 - patch.age / FLAMER.patchSeconds, Math.abs(patch.x * 0.13 + patch.y * 0.071) % 7);
    if (points.length === 0) return;

    // Size along the trail: small at the exhaust, full a little way back, dying down as each part burns out.
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const start = pouring ? Math.min(1, 0.45 + i * 0.28) : 1;
      const burning = Math.min(1, p.life * 2.4);
      const flicker = 0.8 + 0.2 * Math.sin(time * 0.013 + p.seed * 5.1) * Math.sin(time * 0.007 + p.seed * 2.3);
      p.w = FLAME.width * start * burning * (0.85 + 0.15 * Math.sin(p.seed * 3.7));
      p.h = FLAME.height * start * burning * flicker;
    }
    // The road under it lit orange, as one band along the trail.
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 1 || length > FLAMER.spacing * 3.2) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const wa = a.w * 0.8;
      const wb = b.w * 0.8;
      glow.fillStyle(FLAME.groundGlow, FLAME.groundGlowAlpha * Math.min(a.life, b.life));
      glow.fillPoints([{ x: a.x + nx * wa, y: a.y + ny * wa }, { x: b.x + nx * wb, y: b.y + ny * wb }, { x: b.x - nx * wb, y: b.y - ny * wb }, { x: a.x - nx * wa, y: a.y - ny * wa }], true);
    }
    // One to three flames at every point, each its own size, lean and place either side of the trail, flaring
    // and dying down out of step with the others: an untidy fire, never a row.
    for (const p of points) {
      if (p.w < 3) continue;
      const count = 1 + Math.floor(noise(p.seed * 3.1) * 3);
      for (let k = 0; k < count; k += 1) {
        const seed = p.seed * 7.7 + k * 1.37;
        const size = FLAME.sizeRange[0] + noise(seed) * (FLAME.sizeRange[1] - FLAME.sizeRange[0]);
        const flare = 0.7 + 0.3 * Math.sin(time * (0.011 + noise(seed + 2) * 0.012) + seed * 9);
        const lean = (noise(seed + 4) - 0.5) * 2 * FLAME.lean + 0.08 * Math.sin(time * 0.01 + seed);
        const side = (noise(seed + 6) - 0.5) * 2 * FLAME.scatter * p.w;
        const along = (noise(seed + 8) - 0.5) * FLAMER.spacing;
        const fx = p.x + side * 0.8 + along * 0.6;
        const fy = p.y - side * 0.5 + along * 0.8;
        this.flame(fx, fy, p.w * size * (k === 0 ? 1 : 0.7), p.h * size * flare, Math.floor(noise(seed + 10) * 3), lean, depthAt(fx, fy));
      }
    }

    // Smoke off the older part of the trail, embers off any of it.
    this.smokeClock -= dt;
    if (this.smokeClock <= 0 && live) {
      this.smokeClock = 1 / FLAME.smokePerSecond;
      const p = points[Math.floor(points.length * (0.4 + Math.random() * 0.6)) % points.length];
      if (p.life > 0.15) {
        projection.toScreen(p.x, p.y, p.h * 0.9, s0);
        this.smoke.emitParticleAt(s0.x + (Math.random() - 0.5) * p.w, s0.y, 1);
      }
    }
    if (live && Math.random() < dt * FLAME.embersPerSecond) {
      const p = points[Math.floor(Math.random() * points.length)];
      projection.toScreen(p.x, p.y, p.h * 0.5, s0);
      this.embers.emitParticleAt(s0.x + (Math.random() - 0.5) * p.w, s0.y, 1);
    }
  }

  // A police car the fire has caught: flames all over its body until it goes up.
  drawBurningPolice(policeList, time) {
    for (const police of policeList) {
      if (!police.alive || !(police.burning > 0) || !police.view || !police.view.sprite.visible) continue;
      const car = police.model;
      const fx = Math.sin(car.heading);
      const fy = -Math.cos(car.heading);
      const grow = Math.min(1, (FLAMER.burnSeconds - police.burning) / 0.25 + 0.4);
      const over = police.view.sprite.depth + 1; // over the car's body
      FLAME.bodySpots.forEach(([along, across, size], k) => {
        const x = car.x + fx * along * CAR_SIZE.length - fy * across * CAR_SIZE.width;
        const y = car.y + fy * along * CAR_SIZE.length + fx * across * CAR_SIZE.width;
        const flicker = 0.78 + 0.22 * Math.sin(time * 0.016 + k * 2.1 + police.id);
        this.flame(x, y, FLAME.bodyWidth * size * grow, FLAME.bodyHeight * size * grow * flicker, k + police.id, 0.05 * Math.sin(time * 0.01 + k), over + k * 0.01);
      });
    }
  }

  // ---- TURBO ----

  // Fire bursting from the exhaust, spread across the car's width, with a blue-hot core right at the pipe; the fire
  // stays where it was let out, so it streams behind the car. A warm glow on the road under it.
  drawNitro(player, powerUps, dt, live) {
    if (!live || player.boost <= 1) {
      this.nitroGlow.setVisible(false);
      return;
    }
    const fx = Math.sin(player.heading);
    const fy = -Math.cos(player.heading);
    const back = CAR_SIZE.length * 0.55 * player.scale;
    const ex = player.x - fx * back;
    const ey = player.y - fy * back;
    this.nitroClock -= dt * 1000;
    if (this.nitroClock <= 0) {
      this.nitroClock = NITRO.everyMs;
      const half = (CAR_SIZE.width / 2) * NITRO.spread * player.scale;
      for (let k = 0; k < NITRO.flamesEach; k += 1) {
        const across = (Math.random() * 2 - 1) * half;
        projection.toScreen(ex - fy * across, ey + fx * across, 8, s0);
        this.nitroFire.emitParticleAt(s0.x, s0.y, 1);
      }
      projection.toScreen(ex, ey, 8, s0);
      this.nitroCore.emitParticleAt(s0.x, s0.y, 1);
      if (Math.random() < 0.4) this.embers.emitParticleAt(s0.x, s0.y, 1);
    }
    this.nitroGlow
      .setVisible(true)
      .setPosition(ex - fx * 40, ey - fy * 40)
      .setScale(NITRO.glowSize / 64)
      .setAlpha(NITRO.glowAlpha * (0.85 + Math.random() * 0.15));
  }

  // ---- SLICK ----

  // The puddles of one spill make one big pool of oil: its outline is worked out round the middle of them, a
  // ray at a time, out to the furthest puddle edge on that ray, then made to wander.
  drawOil(puddles) {
    const g = this.oil;
    g.clear();
    const groups = this.groups;
    for (const list of groups.values()) list.length = 0;
    for (const puddle of puddles) {
      if (!puddle.active) continue;
      if (!groups.has(puddle.group)) groups.set(puddle.group, []);
      groups.get(puddle.group).push(puddle);
    }
    for (const [group, list] of groups) {
      if (list.length === 0) continue;
      let cx = 0;
      let cy = 0;
      let oldest = 0;
      for (const p of list) {
        cx += p.x;
        cy += p.y;
        oldest = Math.max(oldest, p.age);
      }
      cx /= list.length;
      cy /= list.length;
      const fade = Math.max(0, Math.min(1, (SLICK.seconds - oldest) / 1));
      const seed = group * 1.731;
      const samples = OIL.samples;
      const outline = [];
      for (let i = 0; i < samples; i += 1) {
        const angle = (i / samples) * Math.PI * 2;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        let reach = 0;
        for (const p of list) {
          const r = SLICK.radius * OIL.size * (0.35 + 0.65 * Math.min(1, p.age / 0.3));
          const dx = p.x - cx;
          const dy = p.y - cy;
          const along = dx * ux + dy * uy;
          const off = dx * dx + dy * dy - along * along;
          if (off < r * r) reach = Math.max(reach, along + Math.sqrt(r * r - off));
        }
        reach = Math.max(reach, 12) * (1 + 0.09 * Math.sin(angle * 3 + seed) + 0.05 * Math.sin(angle * 7 + seed * 2));
        outline.push({ x: cx + ux * reach, y: cy + uy * reach, reach });
      }
      const ring = (share) => outline.map((p) => ({ x: cx + (p.x - cx) * share, y: cy + (p.y - cy) * share }));
      g.fillStyle(OIL.rim, 0.95 * fade);
      g.fillPoints(outline, true);
      g.fillStyle(OIL.body, 0.9 * fade);
      g.fillPoints(ring(0.88), true);
      // Sheen: a few blue and purple strips along the edges.
      for (const [start, span, color, alpha] of OIL.sheen) {
        const from = Math.floor((start + seed * 3) % samples);
        g.lineStyle(OIL.sheenWidth, color, alpha * fade);
        g.beginPath();
        for (let k = 0; k <= span; k += 1) {
          const p = outline[(from + k) % samples];
          const x = cx + (p.x - cx) * 0.8;
          const y = cy + (p.y - cy) * 0.8;
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokePath();
      }
      // Two or three drops flicked out beside it.
      for (let k = 0; k < OIL.drops; k += 1) {
        const index = Math.floor((seed * 7 + k * 13.7) % samples);
        const p = outline[index];
        const out = 1.18 + 0.12 * Math.sin(seed + k);
        const x = cx + (p.x - cx) * out;
        const y = cy + (p.y - cy) * out;
        const r = 5 + ((seed * 5 + k * 3) % 6);
        g.fillStyle(OIL.rim, 0.95 * fade);
        g.fillEllipse(x, y, r * 2.2, r * 1.7);
        g.fillStyle(OIL.sheen[0][2], 0.5 * fade);
        g.fillEllipse(x - r * 0.25, y - r * 0.25, r * 0.8, r * 0.45);
      }
    }
    for (const [group, list] of groups) if (list.length === 0) groups.delete(group);
  }
}
