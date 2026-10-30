import * as Phaser from 'phaser';
import { DEPTH, EFFECTS, PALETTE } from '../config/tuning.js';
import { projection } from './projection.js';

const screen = { x: 0, y: 0 };

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
  soft('fx-dot', 32, 0.35); // smoke, fire, scorch marks
  soft('fx-glow', 64, 0.2); // flashes, police lights, crate glow
  if (!scene.textures.exists('fx-chip')) {
    const texture = scene.textures.createCanvas('fx-chip', 8, 8);
    texture.context.fillStyle = '#ffffff';
    texture.context.fillRect(1, 1, 6, 6);
    texture.refresh();
  }
}

// Smoke, fire, debris, flashes, scorch marks and the shockwave ring. Every effect has a fixed
// budget (EFFECTS) so a big pile-up can't slow a phone down.
// Particles live in screen space (positions come through the projection); scorch marks and the
// shockwave ring lie flat on the ground (ground layer, world coordinates).
export class Effects {
  constructor(scene, layers) {
    this.scene = scene;
    makeEffectTextures(scene);
    const base = { emitting: false };
    this.smoke = scene.add
      .particles(0, 0, 'fx-dot', {
        ...base,
        lifespan: { min: 550, max: 950 },
        speedX: { min: -14, max: 14 },
        speedY: { min: -38, max: -12 },
        scale: { start: 0.45, end: 1.5 },
        alpha: { start: 0.3, end: 0 },
        tint: PALETTE.smoke,
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    this.darkSmoke = scene.add
      .particles(0, 0, 'fx-dot', {
        ...base,
        lifespan: { min: 900, max: 1500 },
        speedX: { min: -10, max: 10 },
        speedY: { min: -46, max: -22 },
        scale: { start: 0.6, end: 2.1 },
        alpha: { start: 0.4, end: 0 },
        tint: [0x3a3c40, 0x4b4d52, 0x2c2e31],
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    this.fire = scene.add
      .particles(0, 0, 'fx-dot', {
        ...base,
        lifespan: { min: 260, max: 650 },
        speed: { min: 40, max: 210 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.1, end: 0.1 },
        alpha: { start: 1, end: 0 },
        tint: [0xfff1a8, PALETTE.fire, 0xe8553d],
        blendMode: Phaser.BlendModes.ADD,
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
      .particles(0, 0, 'fx-dot', {
        ...base,
        lifespan: { min: 220, max: 420 },
        speedX: { min: -8, max: 8 },
        speedY: { min: -60, max: -30 },
        scale: { start: 0.55, end: 0.1 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xfff1a8, PALETTE.fire],
        blendMode: Phaser.BlendModes.ADD,
        maxAliveParticles: EFFECTS.maxFire,
      })
      .setDepth(DEPTH.effects + 1);

    this.flashes = Array.from({ length: 6 }, () =>
      scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.effects + 2).setVisible(false),
    );
    this.nextFlash = 0;

    this.scorches = Array.from({ length: EFFECTS.maxScorch }, () => {
      const mark = scene.add.image(0, 0, 'fx-dot').setTint(PALETTE.scorch).setVisible(false);
      layers.ground.add(mark);
      return { mark, age: 0 };
    });
    this.nextScorch = 0;

    this.ring = scene.add.graphics();
    layers.ground.add(this.ring);
    this.pulse = null;
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
    this.fire.emitParticleAt(screen.x, screen.y, big ? 34 : 22);
    this.debris.emitParticleAt(screen.x, screen.y, big ? 16 : 10);
    this.darkSmoke.emitParticleAt(screen.x, screen.y, big ? 8 : 5);
    this.flash(screen.x, screen.y, big ? 5 : 3.4);
    this.scorch(x, y);
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
    slot.mark.setPosition(x, y).setScale(3.2 + Math.random(), 2.6 + Math.random()).setRotation(Math.random() * 3).setAlpha(0.55).setVisible(true);
  }

  // Shockwave: a ring that sweeps out over the ground.
  shockwave(x, y, radius, seconds) {
    this.pulse = { x, y, radius, seconds, age: 0 };
    projection.toScreen(x, y, 10, screen);
    this.flash(screen.x, screen.y, 6);
  }

  update(dt) {
    for (const slot of this.scorches) {
      if (!slot.mark.visible) continue;
      slot.age += dt;
      const t = slot.age / EFFECTS.scorchSeconds;
      if (t >= 1) slot.mark.setVisible(false);
      else slot.mark.setAlpha(0.55 * (1 - t * t));
    }
    const g = this.ring;
    g.clear();
    const p = this.pulse;
    if (!p) return;
    p.age += dt;
    const t = Math.min(1, p.age / p.seconds);
    const r = p.radius * (1 - (1 - t) * (1 - t));
    g.fillStyle(PALETTE.pulse, 0.18 * (1 - t));
    g.fillCircle(p.x, p.y, r);
    g.lineStyle(14 * (1 - t) + 3, PALETTE.pulse, 0.85 * (1 - t));
    g.strokeCircle(p.x, p.y, r);
    if (t >= 1) this.pulse = null;
  }

  // Camera shake that fades with distance from the player.
  shake(camera, distance, maxDistance, strength = EFFECTS.shakeNear) {
    if (distance > maxDistance) return;
    camera.shake(EFFECTS.shakeMs, strength * (1 - distance / maxDistance));
  }

  clear() {
    for (const emitter of [this.smoke, this.darkSmoke, this.fire, this.debris, this.flames]) emitter.killAll();
    for (const flash of this.flashes) flash.setVisible(false);
    for (const slot of this.scorches) slot.mark.setVisible(false);
    this.pulse = null;
    this.ring.clear();
  }
}
