import * as Phaser from 'phaser';
import { DEPTH, EFFECTS, FLAMER, FREEZE, PALETTE, RENDER } from '../config/tuning.js';
import { chunkPose, stepChunk, stepChunkTurn } from './Tumble.js';
import { DEBRIS, DEBRIS_KINDS, frameName, makeDebrisSheet, shardFrames } from './debrisModels.js';
import { projection } from './projection.js';
import { paintEmber, paintFireCore, paintGlow, paintPool, paintPuff, paintRing, paintScorch } from './softShapes.js';

const screen = { x: 0, y: 0 };
const CORE_SIZE = 128; // pixels across a fire core drawing
const shadowShift = { x: 0, y: 0 };
const CHUNK_KINDS = ['tire', 'panel', 'bumper', 'tire', 'hood'];
const SCORCH_ALPHA = 0.85;

// Code-drawn particle textures (no image files). See softShapes.js.
export function makeEffectTextures(scene) {
  const make = (key, size, paint) => {
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.createCanvas(key, size, size);
    paint(texture.context, size);
    texture.refresh();
  };
  make('fx-glow', 64, paintGlow); // flashes, police lights, crate glow, soft shadows
  make('fx-pool', 128, paintPool); // light on the ground
  make('fx-puff', 64, paintPuff); // smoke and flame clouds
  make('fx-core', CORE_SIZE, paintFireCore); // the heart of an explosion
  make('fx-ember', 16, paintEmber); // sparks
  make('fx-scorch', 128, paintScorch); // burns
  make('fx-ring', 128, paintRing); // a blast's ring along the ground
  makeDebrisSheet(scene);
  // Frost: a small four-pointed sparkle. White, tinted when used.
  make('fx-star', 28, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const reach = i % 2 === 0 ? 14 : 4;
      ctx.lineTo(14 + Math.cos(angle) * reach, 14 + Math.sin(angle) * reach);
    }
    ctx.closePath();
    ctx.fill();
  });
}

// Soft smoke, fireballs and embers, solid flying wreckage, flames, burns and rings. Every effect has a fixed
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
        scale: { start: 0.28, end: 0.95, ease: 'Quad.easeOut' },
        alpha: { start: 0.9, end: 0, ease: 'Cubic.easeIn' },
        rotate: { min: 0, max: 360 },
        tint: PALETTE.smoke,
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    this.darkSmoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 1000, max: 1800 },
        delay: { min: 120, max: 380 }, // a blast's smoke comes as its flames die down
        speedX: { min: -24, max: 24 },
        speedY: { min: -78, max: -28 },
        scale: { start: 0.5, end: 2, ease: 'Quad.easeOut' },
        alpha: { start: 0.85, end: 0, ease: 'Quad.easeIn' },
        rotate: { min: 0, max: 360 },
        x: { min: -22, max: 22 },
        y: { min: -18, max: 18 },
        tint: [0x5c5e63, 0x74767b, 0x484a4f], // lighter than the road, so it shows on it
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    // Thin smoke trailing off flying wreckage.
    this.chunkSmoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 260, max: 460 },
        speedY: { min: -18, max: -4 },
        scale: { start: 0.2, end: 0.5 },
        alpha: { start: 0.5, end: 0 },
        rotate: { min: 0, max: 360 },
        tint: [0x5c5e63, 0x74767b],
        maxAliveParticles: EFFECTS.maxChunkSmoke,
      })
      .setDepth(DEPTH.effects + 1);
    // Flame clouds: each starts white hot, turns yellow and orange, and burns out dark red.
    this.fireball = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 420, max: 860 },
        x: { min: -26, max: 26 }, // spread at the start, or together they make a hard disc
        y: { min: -22, max: 22 },
        speed: { min: 18, max: 120 },
        angle: { min: 0, max: 360 },
        gravityY: -120,
        scale: { start: 0.7, end: 2.1, ease: 'Quad.easeOut' },
        alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' },
        rotate: { min: 0, max: 360 },
        color: [0xfff6d0, 0xffc93a, 0xff7a18, 0xb0340f, 0x3a2420],
        maxAliveParticles: EFFECTS.maxFireball,
      })
      .setDepth(DEPTH.effects + 1.5); // over the cores, so that its lumps are what shows
    // Embers thrown out of a blast: they fly, fall and burn out.
    this.fire = scene.add
      .particles(0, 0, 'fx-ember', {
        ...base,
        lifespan: { min: 320, max: 900 },
        speed: { min: 90, max: 380 },
        angle: { min: 0, max: 360 },
        gravityY: 300,
        scale: { start: 0.62, end: 0.05 },
        blendMode: Phaser.BlendModes.ADD,
        tint: [0xfff1c0, 0xffc93a, 0xff7a18],
        maxAliveParticles: EFFECTS.maxFire,
      })
      .setDepth(DEPTH.effects + 3); // with the flashes: light drawn together costs one blend change
    this.debris = scene.add
      .particles(0, 0, makeDebrisSheet(scene), {
        ...base,
        frame: shardFrames(),
        lifespan: { min: 500, max: 900 },
        speed: { min: 110, max: 280 },
        angle: { min: 200, max: 340 },
        gravityY: 520,
        rotate: { start: 0, end: 540 },
        scale: { start: 0.62, end: 0.42 },
        tint: [0x53585f, 0x7a7f88, PALETTE.policeBody],
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

    this.bursts = Array.from({ length: EFFECTS.maxBursts }, () => scene.add.image(0, 0, 'fx-core').setDepth(DEPTH.effects + 1).setVisible(false));
    this.nextBurst = 0;

    this.chunks = Array.from({ length: EFFECTS.maxChunks }, () => ({
      image: scene.add.image(0, 0, makeDebrisSheet(scene), frameName(DEBRIS_KINDS[0], 0)).setScale(1 / DEBRIS.scale).setDepth(DEPTH.effects + 2).setVisible(false),
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

    // The glow a blast throws across the ground, for a moment.
    this.blastGlows = Array.from({ length: EFFECTS.maxRings }, () => {
      const glow = scene.add.image(0, 0, 'fx-pool').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lights.add(glow);
      return glow;
    });
    this.nextBlastGlow = 0;

    this.scorches = Array.from({ length: EFFECTS.maxScorch }, () => {
      const mark = scene.add.image(0, 0, 'fx-scorch').setTint(PALETTE.scorch).setVisible(false);
      layers.ground.add(mark);
      return { mark, age: 0 };
    });
    this.nextScorch = 0;

    // The wave a power-up sends out: a soft ring with a little light inside it.
    this.pulseFill = scene.add.image(0, 0, 'fx-pool').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.pulseRing = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    layers.lights.add(this.pulseFill);
    layers.lights.add(this.pulseRing);
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
    // A white flash, then a rolling ball of fire made of several overlapping cores and clouds that burn from
    // white to dark red, embers flying out, thick smoke climbing as the fire dies. The ground lights up, a ring
    // runs out along it, solid wreckage flies, and the road keeps a burn.
    const size = big ? EFFECTS.burstBig : EFFECTS.burstWreck;
    this.flash(screen.x, screen.y, big ? 6.5 : 4.5);
    this.burst(screen.x, screen.y, size * 0.8, 0, EFFECTS.coreFadeMs);
    for (let i = 0; i < EFFECTS.coresAround; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const reach = (size * CORE_SIZE) * (0.18 + Math.random() * 0.2);
      this.burst(screen.x + Math.cos(angle) * reach, screen.y + Math.sin(angle) * reach * 0.8 - reach * 0.2, size * (0.3 + Math.random() * 0.2), 40 + i * 60, EFFECTS.coreFadeMs, EFFECTS.coreOuterTint);
    }
    this.fireball.emitParticleAt(screen.x, screen.y, big ? 30 : 20);
    this.fire.emitParticleAt(screen.x, screen.y, big ? 34 : 20);
    this.debris.emitParticleAt(screen.x, screen.y, big ? 14 : 9);
    this.darkSmoke.emitParticleAt(screen.x, screen.y, big ? 18 : 12);
    this.blastGlow(x, y, big ? EFFECTS.ringRadiusBig * 1.5 : EFFECTS.ringRadius * 1.5);
    this.groundRing(x, y, big ? EFFECTS.ringRadiusBig : EFFECTS.ringRadius);
    this.throwChunks(x, y, big ? EFFECTS.chunksBig : EFFECTS.chunksSmall);
    this.scorch(x, y);
  }

  blastGlow(x, y, radius) {
    const glow = this.blastGlows[this.nextBlastGlow];
    this.nextBlastGlow = (this.nextBlastGlow + 1) % this.blastGlows.length;
    this.scene.tweens.killTweensOf(glow);
    glow.setPosition(x, y).setScale(radius / 64).setRotation(Math.random() * 6).setAlpha(1).setTint(0xff8a2a).setVisible(true);
    this.scene.tweens.add({ targets: glow, alpha: 0, duration: EFFECTS.blastGlowMs, ease: 'Quad.easeIn', onComplete: () => glow.setVisible(false) });
  }

  groundRing(x, y, radius) {
    const ring = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    this.scene.tweens.killTweensOf(ring);
    ring.setPosition(x, y).setScale(0.25).setAlpha(0.8).setTint(0xffd9a0).setVisible(true);
    this.scene.tweens.add({ targets: ring, scale: radius / 60, alpha: 0, duration: EFFECTS.ringMs, ease: 'Quad.easeOut', onComplete: () => ring.setVisible(false) });
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
      const kind = CHUNK_KINDS[i % CHUNK_KINDS.length];
      const tire = kind === 'tire';
      Object.assign(chunk, {
        x,
        y,
        z: 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 300 + Math.random() * 220,
        spin: (Math.random() - 0.5) * (tire ? 5 : 12), // turning flat on screen; most of its motion is the tumble
        kind,
        tire,
        angle: Math.random() * 6,
        age: 0,
        trail: 0,
        tumble: Math.random() * 6,
        tumbleSpeed: 7 + Math.random() * 9,
        squash: 0,
        bounce: tire ? EFFECTS.tireBounce : EFFECTS.chunkBounce,
        scrape: tire ? EFFECTS.tireScrape : EFFECTS.chunkScrape,
        seconds: tire ? EFFECTS.tireSeconds : EFFECTS.chunkSeconds,
      });
      chunk.image.setFrame(frameName(kind, 0)).setAlpha(1).setVisible(true);
      chunk.shadow.setVisible(true);
    }
  }

  // A smaller hit: a little burst of fire and a few embers, no scorch mark.
  impact(x, y, size) {
    projection.toScreen(x, y, 14, screen);
    this.fire.emitParticleAt(screen.x, screen.y, Math.round(4 + size * 10));
    this.burst(screen.x, screen.y, size * 0.8, 0, EFFECTS.burstFadeMs);
  }

  // A ball of fire: swells fast, holds for a moment, and burns out. Real time, so it still plays during a
  // hit-stop, which is when it should be seen. size: 1 = 160 screen units across.
  burst(sx, sy, size, delay, fadeMs, tint = 0xffffff) {
    const image = this.bursts[this.nextBurst];
    this.nextBurst = (this.nextBurst + 1) % this.bursts.length;
    const full = (size * 160) / CORE_SIZE;
    this.scene.tweens.killTweensOf(image);
    image
      .setPosition(sx, sy)
      .setRotation(Math.random() * Math.PI * 2)
      .setScale(full * 0.25)
      .setAlpha(1)
      .setTint(tint)
      .setVisible(delay === 0);
    this.scene.tweens.add({ targets: image, scale: full, delay, duration: EFFECTS.burstPopMs, ease: 'Cubic.easeOut', onStart: () => image.setVisible(true) });
    this.scene.tweens.add({
      targets: image,
      alpha: 0,
      scale: full * 1.18,
      delay: delay + EFFECTS.burstPopMs + EFFECTS.burstHoldMs,
      duration: fadeMs,
      ease: 'Quad.easeIn',
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
    slot.mark.setPosition(x, y).setScale(EFFECTS.scorchRadius / 64).setRotation(Math.random() * 6).setAlpha(SCORCH_ALPHA).setVisible(true);
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
      stepChunkTurn(chunk, dt);
      projection.toScreen(chunk.x, chunk.y, chunk.z, screen);
      const left = chunk.seconds - chunk.age;
      const alpha = Math.min(1, left * 3);
      // Smoke trails off it while it is new and high.
      chunk.trail -= dt;
      if (chunk.trail <= 0 && chunk.z > 12 && chunk.age < EFFECTS.chunkTrailSeconds) {
        chunk.trail = EFFECTS.chunkTrailEvery;
        this.chunkSmoke.emitParticleAt(screen.x, screen.y, 1);
      }
      chunk.image
        .setFrame(frameName(chunk.kind, chunkPose(chunk.tumble, DEBRIS.poses)))
        .setPosition(screen.x, screen.y)
        .setRotation(chunk.angle)
        .setScale(1 / DEBRIS.scale, (1 - chunk.squash) / DEBRIS.scale)
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
    const p = this.pulse;
    if (!p) return;
    p.age += dt;
    const t = Math.min(1, p.age / p.seconds);
    const r = p.radius * (1 - (1 - t) * (1 - t));
    this.pulseRing.setVisible(true).setPosition(p.x, p.y).setScale(r / 60).setTint(p.color).setAlpha(0.95 * (1 - t));
    this.pulseFill.setVisible(true).setPosition(p.x, p.y).setScale((r * 1.1) / 64).setTint(p.color).setAlpha(0.4 * (1 - t));
    if (t >= 1) this.stopPulse();
  }

  stopPulse() {
    this.pulse = null;
    this.pulseRing.setVisible(false);
    this.pulseFill.setVisible(false);
  }

  clear() {
    for (const emitter of [this.smoke, this.darkSmoke, this.chunkSmoke, this.fireball, this.fire, this.debris, this.flames, this.frost, this.trailFire]) emitter.killAll();
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
    for (const glow of this.blastGlows) {
      this.scene.tweens.killTweensOf(glow);
      glow.setVisible(false);
    }
    this.stopPulse();
  }
}
