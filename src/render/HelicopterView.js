import * as Phaser from 'phaser';
import { DEPTH, HELICOPTER, PALETTE, RENDER } from '../config/tuning.js';
import { atlasMeta, ensureCarAtlas, frameFor } from './carAtlas.js';
import { ROTOR } from './carModels.js';
import { bakeMesh } from './lowpoly.js';
import { projection } from './projection.js';
import { depthAt } from './layers.js';
import { spikeStrip, trafficBarrel } from './propModels.js';
import { makeBeamTexture } from './SirenBeams.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const ground = { x: 0, y: 0 };
const shift = { x: 0, y: 0 };
const BEAM_LENGTH = 256; // the size of the beam drawing (SirenBeams.js)
const BEAM_WIDTH = 128;
const BARREL_FLIGHT = 0.9; // a knocked barrel flies this long (drawing only) ...
const BARREL_HOP = 34; // ... this high

// Draws the helicopter: the body high up, a spinning rotor drawn fresh each frame, its shadow far off on
// the road, a searchlight on the car while it hunts, and the flares, spike strips and traffic barrels it drops
// (the barrels stay after it has gone). Reads entities/Helicopter.js and never changes it.
export class HelicopterView {
  constructor(scene, layers) {
    this.scene = scene;
    makeBeamTexture(scene);
    this.body = scene.add.image(0, 0, 'fx-glow').setScale(ROTOR.modelScale / RENDER.bakeScale).setDepth(DEPTH.effects + 6).setVisible(false);
    this.rotor = scene.add.graphics().setDepth(DEPTH.effects + 7).setVisible(false);
    this.disc = scene.add.image(0, 0, 'fx-glow').setTint(PALETTE.rotorBlur).setDepth(DEPTH.effects + 6.5).setVisible(false);
    // Soft, because it is far above the road: one patch for the body, a fainter one for the spinning rotor.
    const softShadow = () => {
      const image = scene.add.image(0, 0, 'fx-glow').setTint(RENDER.shadowColor).setVisible(false);
      layers.shadows.add(image);
      return image;
    };
    this.bodyShadow = softShadow();
    this.rotorShadow = softShadow();
    this.beam = scene.add.image(0, 0, 'fx-beam').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.effects + 5).setTint(PALETTE.searchlight).setVisible(false);
    this.spot = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.searchlight).setVisible(false);
    layers.lights.add(this.spot);
    this.spotOver = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.searchlight).setVisible(false);
    layers.lightsOver.add(this.spotOver);
    this.drops = Array.from({ length: HELICOPTER.maxDrops }, () => {
      const glow = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.flare).setVisible(false);
      const ring = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.flare).setVisible(false);
      layers.lights.add(glow);
      layers.lights.add(ring);
      return {
        glow,
        ring,
        flare: scene.add.image(0, 0, 'fx-star').setTint(PALETTE.flare).setVisible(false),
        strip: scene.add.image(0, 0, '__DEFAULT').setVisible(false),
        barrels: Array.from({ length: HELICOPTER.barrels }, () => ({
          body: scene.add.image(0, 0, '__DEFAULT').setVisible(false),
          shadow: scene.add.image(0, 0, '__DEFAULT').setAlpha(RENDER.shadowAlpha).setDepth(DEPTH.shadows).setVisible(false),
        })),
      };
    });
    this.drawn = false; // drawn when first needed, or in the warm-up after the title (GameScene.warmUp)
  }

  // Called when first needed and whenever the camera setup changes.
  redraw() {
    this.drawn = true;
    this.atlas = ensureCarAtlas(this.scene, 'helicopter');
    this.directions = atlasMeta.get(this.atlas).directions;
    const meta = atlasMeta.get(this.atlas);
    this.body.setTexture(this.atlas, 'dir0').setOrigin(meta.originX, meta.originY);
    const key = `prop:dropbarrel:${projection.key}`;
    this.barrelBody = bakeMesh(this.scene, key, trafficBarrel(), 0, projection, 'body');
    this.barrelShadow = bakeMesh(this.scene, `${key}:shadow`, trafficBarrel(), 0, projection, 'shadow');
    this.stripMesh = spikeStrip();
    for (const drop of this.drops) {
      for (const barrel of drop.barrels) {
        barrel.body.setTexture(this.barrelBody.key).setOrigin(this.barrelBody.originX, this.barrelBody.originY);
        barrel.shadow.setTexture(this.barrelShadow.key).setOrigin(this.barrelShadow.originX, this.barrelShadow.originY);
      }
    }
  }

  hide() {
    for (const image of [this.body, this.rotor, this.disc, this.bodyShadow, this.rotorShadow, this.beam, this.spot, this.spotOver]) image.setVisible(false);
    for (const drop of this.drops) this.hideDrop(drop);
  }

  hideDrop(view) {
    for (const image of [view.glow, view.ring, view.flare, view.strip]) image.setVisible(false);
    for (const barrel of view.barrels) {
      barrel.body.setVisible(false);
      barrel.shadow.setVisible(false);
    }
  }

  update(heli, time) {
    const dropping = heli.drops.some((drop) => drop.active);
    if (!heli.active && !dropping) {
      this.hide();
      return;
    }
    if (!this.drawn) this.redraw();
    heli.drops.forEach((drop, i) => this.drawDrop(drop, this.drops[i], time));
    if (!heli.active) {
      for (const image of [this.body, this.rotor, this.disc, this.bodyShadow, this.rotorShadow, this.beam, this.spot, this.spotOver]) image.setVisible(false);
      return;
    }
    // The searchlight only while it is hunting the player.
    if (heli.state === 'chasing') this.drawLight(heli);
    else for (const image of [this.beam, this.spot, this.spotOver]) image.setVisible(false);
    this.drawBody(heli);
    this.drawRotor(heli, time);
    this.drawShadow(heli);
  }

  drawBody(heli) {
    frameFor(heli.heading, projection, pick, this.directions);
    projection.toScreen(heli.x, heli.y, heli.z, screen);
    this.body.setVisible(true).setFrame(pick.frame).setRotation(pick.rotation).setPosition(screen.x, screen.y);
  }

  // One tapered blade through the hub, as a thin diamond seen from this camera.
  drawBlade(cx, cy, angle, alpha) {
    const g = this.rotor;
    const r = ROTOR.radius;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle) * projection.squash;
    const nx = -dy * HELICOPTER.bladeWidth;
    const ny = dx * HELICOPTER.bladeWidth;
    g.fillStyle(PALETTE.rotorBlade, alpha);
    g.beginPath();
    g.moveTo(cx - dx * r, cy - dy * r);
    g.lineTo(cx + nx, cy + ny);
    g.lineTo(cx + dx * r, cy + dy * r);
    g.lineTo(cx - nx, cy - ny);
    g.closePath();
    g.fillPath();
  }

  // A soft blur of spinning, then the blades with a fading trail behind each, turned to a new angle each frame.
  drawRotor(heli, time) {
    const g = this.rotor;
    g.clear();
    g.setVisible(true);
    const angle = (time / 1000) * HELICOPTER.rotorSpeed;
    projection.toScreen(heli.x, heli.y, heli.z + ROTOR.height, screen);
    const cx = screen.x;
    const cy = screen.y;
    const size = (ROTOR.radius * 2.3) / 64;
    this.disc.setVisible(true).setPosition(cx, cy).setScale(size, size * projection.squash).setAlpha(HELICOPTER.rotorBlurAlpha);
    for (const offset of [0, Math.PI / 2]) {
      this.drawBlade(cx, cy, angle + offset - 0.3, 0.14);
      this.drawBlade(cx, cy, angle + offset - 0.15, 0.3);
      this.drawBlade(cx, cy, angle + offset, 0.92);
    }
    g.fillStyle(PALETTE.rotorBlade, 1);
    g.fillEllipse(cx, cy, 11, 11 * projection.squash);
    // The small rotor at the side of the tail.
    const tx = heli.x - Math.sin(heli.heading) * ROTOR.tailReach;
    const ty = heli.y + Math.cos(heli.heading) * ROTOR.tailReach;
    projection.toScreen(tx, ty, heli.z + ROTOR.tailHeight, screen);
    const spin = angle * 1.7;
    g.lineStyle(3, PALETTE.rotorBlade, 0.85);
    g.lineBetween(screen.x, screen.y - Math.cos(spin) * 15, screen.x, screen.y + Math.cos(spin) * 15);
  }

  // Far from the helicopter on the road: the higher it flies, the further the sun throws its shadow.
  drawShadow(heli) {
    projection.shadowOffset(heli.z, shift);
    const x = heli.x + shift.x;
    const y = heli.y + shift.y;
    this.bodyShadow
      .setVisible(true)
      .setPosition(x, y)
      .setRotation(heli.heading)
      .setScale(HELICOPTER.shadowWidth / 64, HELICOPTER.shadowLength / 64)
      .setAlpha(HELICOPTER.shadowAlpha);
    this.rotorShadow
      .setVisible(true)
      .setPosition(x, y)
      .setScale((ROTOR.radius * 2.2) / 64)
      .setAlpha(HELICOPTER.shadowAlpha * 0.4);
  }

  // A pool of light on the road, a faint wash on what stands in it, and a beam down to it.
  drawLight(heli) {
    const scale = HELICOPTER.spotRadius / 32;
    this.spot.setVisible(true).setPosition(heli.spotX, heli.spotY).setScale(scale).setAlpha(HELICOPTER.spotAlpha);
    this.spotOver.setVisible(true).setPosition(heli.spotX, heli.spotY).setScale(scale).setAlpha(HELICOPTER.spotOverAlpha);
    projection.toScreen(heli.x, heli.y, heli.z - 6, screen);
    const fromX = screen.x;
    const fromY = screen.y;
    projection.toScreen(heli.spotX, heli.spotY, 0, ground);
    const dx = ground.x - fromX;
    const dy = ground.y - fromY;
    this.beam
      .setVisible(true)
      .setPosition(fromX, fromY)
      .setRotation(Math.atan2(dy, dx))
      .setScale(Math.hypot(dx, dy) / BEAM_LENGTH, HELICOPTER.beamWidth / BEAM_WIDTH)
      .setAlpha(HELICOPTER.beamAlpha);
  }

  drawDrop(drop, view, time) {
    if (!drop.active) {
      this.hideDrop(view);
      return;
    }
    const rx = Math.cos(drop.heading);
    const ry = Math.sin(drop.heading);
    const count = view.barrels.length;
    const spot = (i) => (i - (count - 1) / 2) * HELICOPTER.barrelSpacing;
    if (drop.state === 'warning') {
      // Spitting red flare and a shrinking ring: this is where it will land.
      projection.toScreen(drop.x, drop.y, 0, screen);
      const pulse = 0.65 + 0.35 * Math.sin(time / 70);
      const left = 1 - drop.time / drop.warning;
      const size = drop.kind === 'spikes' ? 60 : HELICOPTER.barrelSpacing * 1.6;
      view.glow.setVisible(true).setPosition(drop.x, drop.y).setScale((size * 1.6) / 32).setAlpha(0.85 * pulse);
      view.ring.setVisible(true).setPosition(drop.x, drop.y).setScale(((size + left * 70) * 2) / 116).setAlpha(0.9);
      view.flare.setVisible(true).setPosition(screen.x, screen.y - 6).setScale(1.1 + pulse * 0.7).setRotation(time / 120).setDepth(DEPTH.effects);
      // Falling into view over the end of the warning.
      const falling = (drop.time - (drop.warning - HELICOPTER.dropFallSeconds)) / HELICOPTER.dropFallSeconds;
      const z = falling > 0 ? (1 - falling * falling) * HELICOPTER.fallHeight : 0;
      if (drop.kind === 'spikes') {
        for (const barrel of view.barrels) {
          barrel.body.setVisible(false);
          barrel.shadow.setVisible(false);
        }
        if (falling <= 0) {
          view.strip.setVisible(false);
          return;
        }
        // Same eight turns as the strip it becomes on the road (Scenery.syncSpikes).
        const eighth = Math.PI / 8;
        const turn = ((Math.round(drop.heading / eighth) % 8) + 8) % 8;
        const strip = bakeMesh(this.scene, `prop:dropstrip:${turn}:${projection.key}`, this.stripMesh, turn * eighth, projection, 'body');
        view.strip
          .setTexture(strip.key)
          .setOrigin(strip.originX, strip.originY)
          .setScale(1 / strip.scale)
          .setVisible(true)
          .setPosition(screen.x, screen.y - z * projection.lift)
          .setDepth(DEPTH.effects + 2);
        return;
      }
      view.strip.setVisible(false);
      view.barrels.forEach((barrel, i) => {
        if (falling <= 0) {
          barrel.body.setVisible(false);
          barrel.shadow.setVisible(false);
          return;
        }
        const x = drop.x + rx * spot(i);
        const y = drop.y + ry * spot(i);
        projection.toScreen(x, y, 0, screen);
        barrel.shadow.setVisible(true).setPosition(screen.x, screen.y).setScale(falling / this.barrelShadow.scale).setAlpha(RENDER.shadowAlpha);
        barrel.body.setVisible(true).setPosition(screen.x, screen.y - z * projection.lift).setScale(1 / this.barrelBody.scale).setRotation(0).setAlpha(1).setDepth(DEPTH.effects + 2);
      });
      return;
    }
    // Barrels standing in the road, or knocked flying.
    for (const image of [view.glow, view.ring, view.flare, view.strip]) image.setVisible(false);
    const fading = Math.min(1, (HELICOPTER.barrelSeconds - drop.time) / 0.5);
    drop.barrels.forEach((barrel, i) => {
      const image = view.barrels[i];
      if (!barrel.hit) {
        projection.toScreen(barrel.x, barrel.y, 0, screen);
        image.body.setVisible(true).setPosition(screen.x, screen.y).setScale(1 / this.barrelBody.scale).setRotation(0).setAlpha(fading).setDepth(depthAt(barrel.x, barrel.y));
        image.shadow.setVisible(true).setPosition(screen.x, screen.y).setScale(1 / this.barrelShadow.scale).setAlpha(RENDER.shadowAlpha * fading);
        return;
      }
      const t = barrel.hitTime;
      if (t > BARREL_FLIGHT) {
        image.body.setVisible(false);
        image.shadow.setVisible(false);
        return;
      }
      const x = barrel.x + barrel.vx * t * (1 - t / (2 * BARREL_FLIGHT));
      const y = barrel.y + barrel.vy * t * (1 - t / (2 * BARREL_FLIGHT));
      const z = 4 * BARREL_HOP * (t / BARREL_FLIGHT) * (1 - t / BARREL_FLIGHT);
      projection.toScreen(x, y, 0, screen);
      image.shadow.setVisible(true).setPosition(screen.x, screen.y).setAlpha(RENDER.shadowAlpha * (1 - t / BARREL_FLIGHT));
      image.body.setVisible(true).setPosition(screen.x, screen.y - z * projection.lift).setRotation(barrel.spin * t).setAlpha(1 - t / BARREL_FLIGHT).setDepth(DEPTH.effects + 1);
    });
  }

}
