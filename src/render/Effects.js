import * as Phaser from 'phaser';
import { DEPTH, EFFECTS, FLAMER, FREEZE, PALETTE, RENDER } from '../config/tuning.js';
import { createRng } from '../utils/math.js';
import { stepChunk } from './Tumble.js';
import { projection } from './projection.js';

const screen = { x: 0, y: 0 };
const BURST_SIZE = 160; // pixels across the starburst drawing
const shadowShift = { x: 0, y: 0 };
const CHUNK_TEXTURES = ['fx-tire', 'fx-bumper', 'fx-panel', 'fx-tire', 'fx-panel'];
const SCORCH_ALPHA = 0.85;

// A jagged star outline: long and short spikes of uneven length, like a comic-book "POW".
function traceStar(ctx, cx, cy, outer, inner, points, random) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (i / (points * 2)) * Math.PI * 2 + (random() - 0.5) * 0.09;
    const reach = i % 2 === 0 ? outer * (0.72 + random() * 0.28) : inner * (0.85 + random() * 0.3);
    const x = cx + Math.cos(angle) * reach;
    const y = cy + Math.sin(angle) * reach;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function cssHex(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// Code-drawn particle textures (no image files).
export function makeEffectTextures(scene) {
  const soft = (key, size, inner) => {
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.createCanvas(key, size, size);
    const ctx = texture.context;
    const r = size / 2;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(inner, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.refresh();
  };
  soft('fx-dot', 32, 0.35); // scorch marks
  soft('fx-glow', 64, 0.2); // flashes, police lights, crate glow
  if (!scene.textures.exists('fx-chip')) {
    const texture = scene.textures.createCanvas('fx-chip', 8, 8);
    texture.context.fillStyle = '#ffffff';
    texture.context.fillRect(1, 1, 6, 6);
    texture.refresh();
  }
  // Cartoon cloud puff: a solid ball, shaded on the lower right. Tinted to any colour.
  if (!scene.textures.exists('fx-puff')) {
    const texture = scene.textures.createCanvas('fx-puff', 48, 48);
    const ctx = texture.context;
    ctx.fillStyle = '#c4c4c4';
    ctx.beginPath();
    ctx.arc(24, 24, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(20, 19, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    texture.refresh();
  }
  // Big flying pieces of a wreck: a tire, a bent bumper, a torn panel.
  if (!scene.textures.exists('fx-tire')) {
    const texture = scene.textures.createCanvas('fx-tire', 22, 22);
    const ctx = texture.context;
    // Many-sided, like the wheels on the cars, with bolts so that its spin can be seen.
    const disc = (color, radius) => {
      ctx.fillStyle = cssHex(color);
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) ctx.lineTo(11 + radius * Math.cos((i * Math.PI) / 5), 11 + radius * Math.sin((i * Math.PI) / 5));
      ctx.closePath();
      ctx.fill();
    };
    disc(PALETTE.chunkTire, 10.8);
    disc(PALETTE.chunkTireWall, 7.6);
    disc(PALETTE.chunkHub, 5);
    ctx.fillStyle = cssHex(PALETTE.chunkTire);
    for (let i = 0; i < 3; i += 1) ctx.fillRect(10 + 3.4 * Math.cos((i * Math.PI * 2) / 3), 10 + 3.4 * Math.sin((i * Math.PI * 2) / 3), 2, 2);
    texture.refresh();
  }
  const polygon = (key, width, height, color, points) => {
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.createCanvas(key, width, height);
    const ctx = texture.context;
    ctx.fillStyle = cssHex(color);
    ctx.beginPath();
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    texture.refresh();
  };
  polygon('fx-bumper', 34, 12, PALETTE.chunkMetal, [[0, 3], [10, 0], [34, 2], [32, 8], [14, 7], [2, 12]]);
  polygon('fx-panel', 26, 22, PALETTE.chunkPanel, [[3, 0], [22, 3], [26, 13], [15, 22], [5, 18], [0, 8]]);
  // A burn on the road: a dark, ragged disc with a soft outer edge.
  if (!scene.textures.exists('fx-scorch')) {
    const texture = scene.textures.createCanvas('fx-scorch', 64, 64);
    const ctx = texture.context;
    const random = createRng(733);
    traceStar(ctx, 32, 32, 31, 25, 14, random);
    const gradient = ctx.createRadialGradient(32, 32, 8, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.25)');
    ctx.fillStyle = gradient;
    ctx.fill();
    texture.refresh();
  }
  // The ring a blast sends across the ground.
  if (!scene.textures.exists('fx-ring')) {
    const texture = scene.textures.createCanvas('fx-ring', 128, 128);
    const ctx = texture.context;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();
    texture.refresh();
  }
  // Small four-pointed spark. White, tinted when used.
  if (!scene.textures.exists('fx-star')) {
    const texture = scene.textures.createCanvas('fx-star', 28, 28);
    const ctx = texture.context;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const reach = i % 2 === 0 ? 14 : 4;
      ctx.lineTo(14 + Math.cos(angle) * reach, 14 + Math.sin(angle) * reach);
    }
    ctx.closePath();
    ctx.fill();
    texture.refresh();
  }
  // The comic starburst: dark ink, then orange, yellow and a white-hot middle.
  if (!scene.textures.exists('fx-burst')) {
    const texture = scene.textures.createCanvas('fx-burst', BURST_SIZE, BURST_SIZE);
    const ctx = texture.context;
    const c = BURST_SIZE / 2;
    const layers = [
      ['#14080a', 1, 0.5],
      ['#ff7a18', 0.9, 0.44],
      ['#ffd21f', 0.68, 0.32],
      ['#ffffff', 0.4, 0.18],
    ];
    for (const [color, outer, inner] of layers) {
      // The same seed for every layer keeps the spikes lined up, one inside the other.
      traceStar(ctx, c, c, c * outer, c * inner, 11, createRng(417));
      ctx.fillStyle = color;
      ctx.fill();
    }
    texture.refresh();
  }
}

// Puffy smoke, comic fireballs, starbursts and sparks, flying wreckage, flames, scorch marks and rings. Every effect has a fixed
// budget (EFFECTS) so a big pile-up can't slow a phone down.
// Particles live in screen space (positions come through the projection); scorch marks and the
// shockwave ring lie flat on the ground (ground layer, world coordinates).
export class Effects {
  constructor(scene, layers) {
    this.scene = scene;
    makeEffectTextures(scene);
    const base = { emitting: false };
    // Puffs swell quickly, hold, and then fade: thick cartoon cloud, not haze.
    this.smoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 460, max: 820 },
        speedX: { min: -16, max: 16 },
        speedY: { min: -30, max: -8 },
        scale: { start: 0.3, end: 0.95, ease: 'Quad.easeOut' },
        alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' },
        tint: PALETTE.smoke,
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    this.darkSmoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 800, max: 1300 },
        delay: { min: 120, max: 320 }, // a blast's smoke comes as its flames die down
        speedX: { min: -18, max: 18 },
        speedY: { min: -60, max: -24 },
        scale: { start: 0.3, end: 1.15, ease: 'Quad.easeOut' },
        alpha: { start: 0.95, end: 0, ease: 'Cubic.easeIn' },
        tint: [0x3a3c40, 0x4b4d52, 0x2c2e31],
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    // Flame clouds: each starts white hot, turns yellow and orange, and burns out dark red.
    this.fireball = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 360, max: 680 },
        speed: { min: 40, max: 170 },
        angle: { min: 0, max: 360 },
        gravityY: -90,
        scale: { start: 0.7, end: 2, ease: 'Quad.easeOut' },
        alpha: { start: 1, end: 0, ease: 'Quart.easeIn' },
        color: [0xffffff, 0xffd21f, 0xff7a18, 0x7a2410],
        maxAliveParticles: EFFECTS.maxFireball,
      })
      .setDepth(DEPTH.effects + 1);
    // Sparks thrown out of a starburst.
    this.fire = scene.add
      .particles(0, 0, 'fx-star', {
        ...base,
        lifespan: { min: 220, max: 520 },
        speed: { min: 90, max: 320 },
        angle: { min: 0, max: 360 },
        rotate: { start: 0, end: 200 },
        scale: { start: 1.15, end: 0.15 },
        tint: [0xffffff, 0xffd21f, 0xff7a18],
        maxAliveParticles: EFFECTS.maxFire,
      })
      .setDepth(DEPTH.effects + 1);
    this.debris = scene.add
      .particles(0, 0, 'fx-chip', {
        ...base,
        lifespan: { min: 500, max: 900 },
        speed: { min: 110, max: 280 },
        angle: { min: 200, max: 340 },
        gravityY: 520,
        rotate: { min: 0, max: 360 },
        scale: { start: 1, end: 0.6 },
        tint: [0x2a2e35, 0x4b4f57, PALETTE.policeBody],
        maxAliveParticles: EFFECTS.maxDebris,
      })
      .setDepth(DEPTH.effects + 1);
    this.flames = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 220, max: 420 },
        speedX: { min: -8, max: 8 },
        speedY: { min: -60, max: -30 },
        scale: { start: 0.42, end: 0.08 },
        tint: [0xffd21f, 0xff7a18],
        maxAliveParticles: EFFECTS.maxFire,
      })
      .setDepth(DEPTH.effects + 1);

    this.flashes = Array.from({ length: 6 }, () =>
      scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.effects + 4).setVisible(false),
    );
    this.nextFlash = 0;

    this.bursts = Array.from({ length: EFFECTS.maxBursts }, () => scene.add.image(0, 0, 'fx-burst').setDepth(DEPTH.effects).setVisible(false));
    this.nextBurst = 0;

    this.chunks = Array.from({ length: EFFECTS.maxChunks }, () => ({
      image: scene.add.image(0, 0, 'fx-tire').setDepth(DEPTH.effects + 2).setVisible(false),
      // Without a shadow, nothing shows how high a piece is: from this camera it would seem to float.
      shadow: this.makeChunkShadow(scene, layers),
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
      angle: 0,
      age: 0,
    }));
    this.nextChunk = 0;

    this.rings = Array.from({ length: EFFECTS.maxRings }, () => {
      const ring = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lights.add(ring);
      return ring;
    });
    this.nextRing = 0;

    this.scorches = Array.from({ length: EFFECTS.maxScorch }, () => {
      const mark = scene.add.image(0, 0, 'fx-scorch').setTint(PALETTE.scorch).setVisible(false);
      layers.ground.add(mark);
      return { mark, age: 0 };
    });
    this.nextScorch = 0;

    this.ring = scene.add.graphics();
    layers.ground.add(this.ring);
    this.pulse = null;

    this.frost = scene.add
      .particles(0, 0, 'fx-star', {
        ...base,
        lifespan: { min: 320, max: 680 },
        speed: { min: 60, max: 260 },
        angle: { min: 0, max: 360 },
        rotate: { start: 0, end: 160 },
        scale: { start: 1.1, end: 0.1 },
        tint: [0xffffff, PALETTE.frost, PALETTE.ice],
        maxAliveParticles: EFFECTS.maxFrost,
      })
      .setDepth(DEPTH.effects + 1);

    // The Flamer's trail: big licking flames, drawn from the patches on the road.
    this.trailFire = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 280, max: 560 },
        speedX: { min: -12, max: 12 },
        speedY: { min: -70, max: -30 },
        scale: { start: 0.72, end: 0.12 },
        color: [0xffe27a, 0xff9a2e, 0xe8451a],
        maxAliveParticles: EFFECTS.maxTrailFire,
      })
      .setDepth(DEPTH.effects);

    // And one glow on the road per patch, all in the ground-lights layer.
    this.firePatches = Array.from({ length: FLAMER.maxPatches }, () => {
      const glow = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.fireGlow).setVisible(false);
      layers.lights.add(glow);
      return glow;
    });
  }

  smokePuff(x, y, z = 4, dark = false) {
    projection.toScreen(x, y, z, screen);
    (dark ? this.darkSmoke : this.smoke).emitParticleAt(screen.x, screen.y, 1);
  }

  flame(x, y) {
    projection.toScreen(x, y, 18, screen);
    this.flames.emitParticleAt(screen.x + (Math.random() - 0.5) * 16, screen.y, 1);
  }

  explosion(x, y, big = false) {
    projection.toScreen(x, y, 14, screen);
    // White core, comic star, flame clouds, then smoke rising as they die; a ring runs out along the
    // ground, wreckage flies, and the road keeps a burn.
    this.flash(screen.x, screen.y, big ? 5.5 : 3.8);
    this.burst(screen.x, screen.y, big ? EFFECTS.burstBig : EFFECTS.burstWreck);
    this.fireball.emitParticleAt(screen.x, screen.y, big ? 26 : 17);
    this.fire.emitParticleAt(screen.x, screen.y, big ? 24 : 14);
    this.debris.emitParticleAt(screen.x, screen.y, big ? 12 : 8);
    this.darkSmoke.emitParticleAt(screen.x, screen.y, big ? 12 : 8);
    this.groundRing(x, y, big ? EFFECTS.ringRadiusBig : EFFECTS.ringRadius);
    this.throwChunks(x, y, big ? EFFECTS.chunksBig : EFFECTS.chunksSmall);
    this.scorch(x, y);
  }

  groundRing(x, y, radius) {
    const ring = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    this.scene.tweens.killTweensOf(ring);
    ring.setPosition(x, y).setScale(0.25).setAlpha(0.9).setTint(0xffd9a0).setVisible(true);
    this.scene.tweens.add({ targets: ring, scale: radius / 58, alpha: 0, duration: EFFECTS.ringMs, ease: 'Quad.easeOut', onComplete: () => ring.setVisible(false) });
  }

  // Tires, bumpers and panels fly out, bounce and scrape to a stop.
  makeChunkShadow(scene, layers) {
    const shadow = scene.add.image(0, 0, 'fx-glow').setTint(RENDER.shadowColor).setVisible(false);
    layers.shadows.add(shadow);
    return shadow;
  }

  throwChunks(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      const chunk = this.chunks[this.nextChunk];
      this.nextChunk = (this.nextChunk + 1) % this.chunks.length;
      const angle = ((i + Math.random() * 0.8) / count) * Math.PI * 2;
      const speed = 110 + Math.random() * 200;
      const texture = CHUNK_TEXTURES[i % CHUNK_TEXTURES.length];
      const tire = texture === 'fx-tire';
      Object.assign(chunk, {
        x,
        y,
        z: 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 300 + Math.random() * 220,
        spin: (Math.random() - 0.5) * 22,
        angle: Math.random() * 6,
        age: 0,
        tumble: Math.random() * 6,
        tumbleSpeed: 7 + Math.random() * 9,
        squash: 0,
        bounce: tire ? EFFECTS.tireBounce : EFFECTS.chunkBounce,
        scrape: tire ? EFFECTS.tireScrape : EFFECTS.chunkScrape,
        seconds: tire ? EFFECTS.tireSeconds : EFFECTS.chunkSeconds,
      });
      chunk.image.setTexture(texture).setAlpha(1).setVisible(true);
      chunk.shadow.setVisible(true);
    }
  }

  // A smaller hit: a starburst and a few sparks, no fire or scorch mark.
  impact(x, y, size) {
    projection.toScreen(x, y, 14, screen);
    this.fire.emitParticleAt(screen.x, screen.y, Math.round(4 + size * 10));
    this.burst(screen.x, screen.y, size);
  }

  // The comic starburst: pops out, holds for a moment, and is gone. Real time, so it still plays
  // during a hit-stop, which is when it should be seen.
  burst(sx, sy, size) {
    const image = this.bursts[this.nextBurst];
    this.nextBurst = (this.nextBurst + 1) % this.bursts.length;
    this.scene.tweens.killTweensOf(image);
    image
      .setPosition(sx, sy)
      .setRotation(Math.random() * Math.PI * 2)
      .setScale(size * 0.3)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({ targets: image, scale: size, duration: EFFECTS.burstPopMs, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: image,
      alpha: 0,
      delay: EFFECTS.burstPopMs + EFFECTS.burstHoldMs,
      duration: EFFECTS.burstFadeMs,
      onComplete: () => image.setVisible(false),
    });
  }

  flash(sx, sy, size) {
    const flash = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    this.scene.tweens.killTweensOf(flash);
    flash.setPosition(sx, sy).setScale(size * 0.4).setAlpha(1).setVisible(true).setTint(0xfff1c8);
    this.scene.tweens.add({ targets: flash, scale: size, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => flash.setVisible(false) });
  }

  scorch(x, y) {
    const slot = this.scorches[this.nextScorch];
    this.nextScorch = (this.nextScorch + 1) % this.scorches.length;
    slot.age = 0;
    slot.mark.setPosition(x, y).setScale(EFFECTS.scorchRadius / 32).setRotation(Math.random() * 6).setAlpha(SCORCH_ALPHA).setVisible(true);
  }

  // Shockwave: a ring that sweeps out over the ground.
  shockwave(x, y, radius, seconds, color = PALETTE.pulse) {
    this.pulse = { x, y, radius, seconds, age: 0, color };
    projection.toScreen(x, y, 10, screen);
    this.flash(screen.x, screen.y, 6);
  }

  // Freeze: the same kind of ring in frost colours, and a burst of sparkles.
  freezeBlast(x, y) {
    this.shockwave(x, y, FREEZE.radius, FREEZE.ringSeconds, PALETTE.frost);
    this.frost.emitParticleAt(screen.x, screen.y, 36);
  }

  // A frozen car smashed to bits: ice and panels, but no fire.
  shatter(x, y) {
    projection.toScreen(x, y, 14, screen);
    this.flash(screen.x, screen.y, 2.5);
    this.frost.emitParticleAt(screen.x, screen.y, 40);
    this.throwChunks(x, y, 6);
  }

  // The bare rim scraping along the road.
  rimSparks(x, y) {
    projection.toScreen(x, y, 3, screen);
    this.fire.emitParticleAt(screen.x, screen.y, 3);
  }

  // Bits of road crumbling away as a car goes over the edge of a hole. (x, y) is where it went over:
  // only chips at the car itself, because a dust cloud there would hide the fall.
  holeCrumble(x, y, edgeX, edgeY) {
    projection.toScreen(x, y, 4, screen);
    this.debris.emitParticleAt(screen.x, screen.y, 7);
    projection.toScreen(edgeX, edgeY, 2, screen);
    this.smoke.emitParticleAt(screen.x, screen.y, 2);
  }

  // Dust rising out of a hole, once the car has gone.
  holeDust(x, y) {
    projection.toScreen(x, y, 2, screen);
    this.darkSmoke.emitParticleAt(screen.x, screen.y, 4);
  }

  // Stone dust where a pillar breaks through the road, or crumbles back into it.
  pillarDust(x, y) {
    projection.toScreen(x, y, 6, screen);
    this.smoke.emitParticleAt(screen.x, screen.y, 5);
    this.debris.emitParticleAt(screen.x, screen.y, 6);
  }

  // A police car catching fire.
  ignite(x, y) {
    projection.toScreen(x, y, 14, screen);
    this.fire.emitParticleAt(screen.x, screen.y, 8);
    this.flames.emitParticleAt(screen.x, screen.y, 5);
  }

  // Draws the Flamer's trail. patches: PowerUps.patches, one glow each; a burning patch gives off flames.
  syncPatches(patches, dt) {
    const size = (FLAMER.patchRadius * 1.5) / 32;
    const chance = dt * FLAMER.flamesPerSecond;
    for (let i = 0; i < patches.length; i += 1) {
      const patch = patches[i];
      const glow = this.firePatches[i];
      if (!patch.active) {
        glow.setVisible(false);
        continue;
      }
      const life = 1 - patch.age / FLAMER.patchSeconds;
      glow.setVisible(true).setPosition(patch.x, patch.y).setScale(size).setAlpha(EFFECTS.firePatchAlpha * Math.min(1, life * 2));
      if (Math.random() < chance * life) {
        projection.toScreen(patch.x, patch.y, 6, screen);
        this.trailFire.emitParticleAt(screen.x + (Math.random() - 0.5) * 26, screen.y + (Math.random() - 0.5) * 14, 1);
      }
    }
  }

  update(dt) {
    for (const slot of this.scorches) {
      if (!slot.mark.visible) continue;
      slot.age += dt;
      const t = slot.age / EFFECTS.scorchSeconds;
      if (t >= 1) slot.mark.setVisible(false);
      else slot.mark.setAlpha(SCORCH_ALPHA * (1 - t * t * t));
    }
    for (const chunk of this.chunks) {
      if (!chunk.image.visible || dt === 0) continue;
      chunk.age += dt;
      stepChunk(chunk, dt, EFFECTS.chunkGravity, chunk.bounce, chunk.scrape);
      projection.toScreen(chunk.x, chunk.y, chunk.z, screen);
      const left = chunk.seconds - chunk.age;
      const alpha = Math.min(1, left * 3);
      // In the air it turns over; on the road it lies flat.
      const flying = chunk.z > 0;
      if (flying) chunk.tumble += chunk.tumbleSpeed * dt;
      const wide = flying ? Math.max(0.35, Math.abs(Math.cos(chunk.tumble))) : 1;
      const tall = (chunk.vz === 0 && !flying ? 0.74 : 1) * (1 - chunk.squash);
      chunk.image
        .setPosition(screen.x, screen.y)
        .setRotation(chunk.angle)
        .setScale(wide, tall)
        .setAlpha(alpha)
        .setDepth(chunk.z > 3 ? DEPTH.effects + 2 : DEPTH.objects + projection.depthOf(chunk.x, chunk.y));
      projection.shadowOffset(chunk.z, shadowShift);
      const high = Math.min(1, chunk.z / 260);
      chunk.shadow
        .setPosition(chunk.x + shadowShift.x, chunk.y + shadowShift.y)
        .setScale((EFFECTS.chunkShadowRadius * (1 - 0.4 * high)) / 32)
        .setAlpha(EFFECTS.chunkShadowAlpha * (1 - 0.5 * high) * alpha);
      if (left <= 0) {
        chunk.image.setVisible(false);
        chunk.shadow.setVisible(false);
      }
    }
    const g = this.ring;
    g.clear();
    const p = this.pulse;
    if (!p) return;
    p.age += dt;
    const t = Math.min(1, p.age / p.seconds);
    const r = p.radius * (1 - (1 - t) * (1 - t));
    g.fillStyle(p.color, 0.18 * (1 - t));
    g.fillCircle(p.x, p.y, r);
    g.lineStyle(14 * (1 - t) + 3, p.color, 0.85 * (1 - t));
    g.strokeCircle(p.x, p.y, r);
    if (t >= 1) this.pulse = null;
  }

  clear() {
    for (const emitter of [this.smoke, this.darkSmoke, this.fireball, this.fire, this.debris, this.flames, this.frost, this.trailFire]) emitter.killAll();
    for (const glow of this.firePatches) glow.setVisible(false);
    for (const chunk of this.chunks) {
      chunk.image.setVisible(false);
      chunk.shadow.setVisible(false);
    }
    for (const ring of this.rings) {
      this.scene.tweens.killTweensOf(ring);
      ring.setVisible(false);
    }
    for (const flash of this.flashes) flash.setVisible(false);
    for (const image of this.bursts) {
      this.scene.tweens.killTweensOf(image);
      image.setVisible(false);
    }
    for (const slot of this.scorches) slot.mark.setVisible(false);
    this.pulse = null;
    this.ring.clear();
  }
}
