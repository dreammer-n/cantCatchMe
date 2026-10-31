import * as Phaser from 'phaser';
import { DEPTH, HELICOPTER, PALETTE, RENDER } from '../config/tuning.js';
import { atlasMeta, ensureCarAtlas, frameFor } from './carAtlas.js';
import { carShadowPoints, ROTOR } from './carModels.js';
import { bakeMesh, worldShadowOutline } from './lowpoly.js';
import { projection } from './projection.js';
import { concreteBlock } from './propModels.js';
import { makeBeamTexture } from './SirenBeams.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const ground = { x: 0, y: 0 };
const shift = { x: 0, y: 0 };
const BEAM_LENGTH = 256; // the size of the beam drawing (SirenBeams.js)
const BEAM_WIDTH = 128;

// Draws the helicopter: the body high up, a spinning rotor drawn fresh each frame, its shadow far off on
// the road, a searchlight on the car, and the flares and concrete blocks it drops. Reads
// entities/Helicopter.js and never changes it.
export class HelicopterView {
  // shadows: the shared Graphics for car shadows, in the ground shadow layer.
  constructor(scene, layers, shadows) {
    this.scene = scene;
    this.shadows = shadows;
    makeBeamTexture(scene);
    this.body = scene.add.image(0, 0, ensureCarAtlas(scene, 'helicopter'), 'dir0').setScale(ROTOR.modelScale / RENDER.bakeScale).setDepth(DEPTH.effects + 6).setVisible(false);
    this.rotor = scene.add.graphics().setDepth(DEPTH.effects + 7).setVisible(false);
    this.points = carShadowPoints('helicopter');
    this.scratch = this.points.map(() => ({ x: 0, y: 0 }));
    this.outline = this.points.map(() => ({ x: 0, y: 0 }));
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
        block: scene.add.image(0, 0, '__DEFAULT').setVisible(false),
        shadow: scene.add.image(0, 0, '__DEFAULT').setAlpha(RENDER.shadowAlpha).setDepth(DEPTH.shadows).setVisible(false),
      };
    });
    this.redraw();
  }

  // Called at startup and whenever the camera setup changes.
  redraw() {
    this.atlas = ensureCarAtlas(this.scene, 'helicopter');
    this.directions = atlasMeta.get(this.atlas).directions;
    const meta = atlasMeta.get(this.atlas);
    this.body.setTexture(this.atlas, 'dir0').setOrigin(meta.originX, meta.originY);
    const half = HELICOPTER.blockHalfSize * 2;
    const mesh = concreteBlock({ width: half, length: half, height: HELICOPTER.blockHeight });
    const key = `prop:dropblock:${projection.key}`;
    this.blockBody = bakeMesh(this.scene, key, mesh, 0, projection, 'body');
    this.blockShadow = bakeMesh(this.scene, `${key}:shadow`, mesh, 0, projection, 'shadow');
    for (const drop of this.drops) {
      drop.block.setTexture(this.blockBody.key).setOrigin(this.blockBody.originX, this.blockBody.originY);
      drop.shadow.setTexture(this.blockShadow.key).setOrigin(this.blockShadow.originX, this.blockShadow.originY);
    }
  }

  hide() {
    for (const image of [this.body, this.rotor, this.beam, this.spot, this.spotOver]) image.setVisible(false);
    for (const drop of this.drops) for (const image of [drop.glow, drop.ring, drop.flare, drop.block, drop.shadow]) image.setVisible(false);
  }

  update(heli, time) {
    if (!heli.active) {
      this.hide();
      return;
    }
    this.drawLight(heli);
    this.drawBody(heli);
    this.drawRotor(heli, time);
    this.drawShadow(heli);
    heli.drops.forEach((drop, i) => this.drawDrop(drop, this.drops[i], time));
  }

  drawBody(heli) {
    frameFor(heli.heading, projection, pick, this.directions);
    projection.toScreen(heli.x, heli.y, heli.z, screen);
    this.body.setVisible(true).setFrame(pick.frame).setRotation(pick.rotation).setPosition(screen.x, screen.y);
  }

  // A blurred disc and two blades, turned to a new angle each frame.
  drawRotor(heli, time) {
    const g = this.rotor;
    g.clear();
    g.setVisible(true);
    const angle = (time / 1000) * HELICOPTER.rotorSpeed;
    const r = ROTOR.radius;
    projection.toScreen(heli.x, heli.y, heli.z + ROTOR.height, screen);
    const cx = screen.x;
    const cy = screen.y;
    g.fillStyle(PALETTE.rotorBlur, 0.2);
    g.fillEllipse(cx, cy, r * 2, r * 2 * projection.squash);
    for (const offset of [0, Math.PI / 2]) {
      const dx = Math.cos(angle + offset) * r;
      const dy = Math.sin(angle + offset) * r * projection.squash;
      g.lineStyle(5, PALETTE.rotorBlade, 0.85);
      g.lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
    }
    // The small rotor at the tail.
    const tx = heli.x - Math.sin(heli.heading) * ROTOR.tailReach;
    const ty = heli.y + Math.cos(heli.heading) * ROTOR.tailReach;
    projection.toScreen(tx, ty, heli.z + ROTOR.tailHeight, screen);
    const spin = angle * 1.7;
    g.lineStyle(3, PALETTE.rotorBlade, 0.85);
    g.lineBetween(screen.x, screen.y - Math.cos(spin) * 12, screen.x, screen.y + Math.cos(spin) * 12);
  }

  // Far from the helicopter on the road: the higher it flies, the further the sun throws its shadow.
  drawShadow(heli) {
    projection.shadowOffset(heli.z, shift);
    const x = heli.x + shift.x;
    const y = heli.y + shift.y;
    const count = worldShadowOutline(this.points, x, y, heli.heading, projection, this.outline, this.scratch, ROTOR.modelScale);
    const g = this.shadows;
    if (count >= 3) {
      g.fillStyle(RENDER.shadowColor, RENDER.shadowAlpha);
      g.beginPath();
      g.moveTo(this.outline[0].x, this.outline[0].y);
      for (let i = 1; i < count; i += 1) g.lineTo(this.outline[i].x, this.outline[i].y);
      g.closePath();
      g.fillPath();
    }
    g.fillStyle(RENDER.shadowColor, RENDER.shadowAlpha * 0.5);
    g.fillCircle(x, y, ROTOR.radius);
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
      for (const image of [view.glow, view.ring, view.flare, view.block, view.shadow]) image.setVisible(false);
      return;
    }
    projection.toScreen(drop.x, drop.y, 0, screen);
    const bodyScale = 1 / this.blockBody.scale;
    const shadowScale = 1 / this.blockShadow.scale;
    let height = 1;
    let z = 0;
    let shadowShare = 1;
    const warning = drop.state === 'warning';
    if (warning) {
      // Spitting red flare and a shrinking ring: this is where the block will land.
      const pulse = 0.65 + 0.35 * Math.sin(time / 70);
      const left = 1 - drop.time / HELICOPTER.warningSeconds;
      view.glow.setVisible(true).setPosition(drop.x, drop.y).setScale((HELICOPTER.blockHalfSize * 2.6) / 32).setAlpha(0.85 * pulse);
      view.ring.setVisible(true).setPosition(drop.x, drop.y).setScale(((HELICOPTER.blockHalfSize + 8 + left * 70) * 2) / 116).setAlpha(0.9);
      view.flare.setVisible(true).setPosition(screen.x, screen.y - 6).setScale(1.1 + pulse * 0.7).setRotation(time / 120).setDepth(DEPTH.effects);
      const falling = (drop.time - (HELICOPTER.warningSeconds - HELICOPTER.fallSeconds)) / HELICOPTER.fallSeconds;
      if (falling <= 0) {
        view.block.setVisible(false);
        view.shadow.setVisible(false);
        return;
      }
      z = (1 - falling * falling) * HELICOPTER.fallHeight;
      shadowShare = falling;
    } else {
      view.glow.setVisible(false);
      view.ring.setVisible(false);
      view.flare.setVisible(false);
      if (drop.state === 'sinking') height = Math.max(0, 1 - drop.time / HELICOPTER.sinkSeconds);
    }
    view.block
      .setVisible(true)
      .setPosition(screen.x, screen.y - z * projection.lift)
      .setScale(bodyScale, bodyScale * height)
      .setDepth(z > 0 ? DEPTH.effects + 2 : DEPTH.objects + projection.depthOf(drop.x, drop.y));
    view.shadow.setVisible(true).setPosition(screen.x, screen.y).setScale(shadowScale * shadowShare * height);
  }
}
