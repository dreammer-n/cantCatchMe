import { CAR_SIZE, DEPTH, EFFECTS, PALETTE, RENDER, SKIDS, TUMBLE, VOID } from '../config/tuning.js';
import { atlasMeta, frameFor } from '../render/carAtlas.js';
import { LIGHT_BAR } from '../render/carModels.js';
import * as Phaser from 'phaser';
import { depthAt } from '../render/layers.js';
import { Tumble } from '../render/Tumble.js';
import { worldShadowOutline } from '../render/lowpoly.js';
import { projection } from '../render/projection.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const CULL_MARGIN = 140; // screen units around the camera view where cars are still drawn

// What a car looks like on screen. Reads the car's physics state and never changes it.
// Used for the player, police cars and wrecks (look = { atlasKey, shadowPoints, lights }).
export class CarView {
  // shadows: one Graphics shared by all cars, in the ground shadow layer (world coordinates).
  // layers: for a cruiser's siren light on the road and nearby props (police only).
  constructor(scene, look, shadows, layers = null) {
    this.sprite = scene.add.image(0, 0, look.atlasKey, 'dir0').setScale(1 / RENDER.bakeScale);
    this.shadows = shadows;
    // Normal blending (not additive): the lights sit between cars in the draw order, and a
    // blend change there would cost an extra draw call per police car.
    this.lights = [PALETTE.lightRed, PALETTE.lightBlue].map((tint) =>
      scene.add.image(0, 0, 'fx-glow').setTint(tint).setScale(0.55).setVisible(false),
    );
    this.pool = null;
    this.glowOver = null;
    if (layers) {
      this.pool = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lights.add(this.pool);
      this.glowOver = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lightsOver.add(this.glowOver);
    }
    this.tumble = new Tumble();
    this.restLook = look; // while tumbling: the drawing to use right way up ...
    this.roofLook = null; // ... and upside down
    this.flashOffset = Math.random() * 1000;
    this.alpha = 1;
    this.wasFalling = false;
    this.setLook(look);
  }

  setLook(look) {
    if (this.tumble) this.endTumble();
    this.showLook(look);
  }

  // A wreck is thrown in the air and rolls: call after setLook. roofLook: the upside-down wreck.
  startTumble(roofLook) {
    this.tumble.start(Math.random);
    this.restLook = this.currentLook;
    this.roofLook = roofLook;
  }

  endTumble() {
    this.tumble.reset();
    this.sprite.setScale(1 / RENDER.bakeScale);
  }

  showLook(look) {
    this.currentLook = look;
    const meta = atlasMeta.get(look.atlasKey);
    this.atlasKey = look.atlasKey;
    this.directions = meta.directions;
    this.shadowPoints = look.shadowPoints;
    if (!this.scratch || this.scratch.length < this.shadowPoints.length) {
      this.scratch = this.shadowPoints.map(() => ({ x: 0, y: 0 }));
      this.outline = this.shadowPoints.map(() => ({ x: 0, y: 0 }));
    }
    this.hasLights = Boolean(look.lights);
    this.sprite.setTexture(look.atlasKey, 'dir0');
    this.sprite.setOrigin(meta.originX, meta.originY);
    this.hideLights();
  }

  hideLights() {
    for (const light of this.lights) light.setVisible(false);
    if (this.pool) {
      this.pool.setVisible(false);
      this.glowOver.setVisible(false);
    }
  }

  setAlpha(alpha) {
    this.alpha = alpha;
    this.sprite.setAlpha(alpha);
  }

  // view: the camera's visible rectangle in screen units (camera.worldView). time: ms, for lights.
  // dt: seconds of tumbling to play.
  update(model, view, time, dt = 0) {
    const tumbling = this.tumble.active;
    if (tumbling) {
      this.tumble.update(dt);
      const want = this.tumble.upsideDown ? this.roofLook : this.restLook;
      if (want !== this.currentLook) this.showLook(want);
    }
    projection.toScreen(model.x, model.y, 0, screen);
    const visible =
      !view ||
      (screen.x > view.x - CULL_MARGIN &&
        screen.x < view.right + CULL_MARGIN &&
        screen.y > view.y - CULL_MARGIN &&
        screen.y < view.bottom + CULL_MARGIN * 1.5);
    this.sprite.setVisible(visible);
    if (!visible) {
      this.hideLights();
      return false;
    }
    frameFor(model.heading, projection, pick, this.directions);
    const depth = depthAt(model.x, model.y);
    this.sprite.setFrame(pick.frame).setRotation(pick.rotation).setPosition(screen.x, screen.y).setDepth(depth);
    if (model.isFalling) {
      this.drawFalling(model.fallProgress);
      return true;
    }
    if (tumbling) {
      this.sprite
        .setRotation(pick.rotation + this.tumble.spin)
        .setY(screen.y - this.tumble.z * projection.lift)
        .setScale(1 / RENDER.bakeScale, this.tumble.squash / RENDER.bakeScale);
      // In the air it flies up out of the flames, so it stays in view.
      if (this.tumble.z > TUMBLE.overFlamesHeight) this.sprite.setDepth(DEPTH.effects + 2);
    }
    if (this.wasFalling) {
      this.wasFalling = false;
      this.sprite.setScale(1 / RENDER.bakeScale).setAlpha(this.alpha);
    }
    this.drawShadow(model);
    if (this.hasLights) this.updateLights(model, time, depth);
    return true;
  }

  // Into a hole: it shrinks with distance, sinks faster and faster, and fades into the dark.
  // No shadow: the ground it would land on is gone.
  drawFalling(progress) {
    this.wasFalling = true;
    this.sprite
      .setScale((1 - (1 - VOID.fallScale) * progress) / RENDER.bakeScale)
      .setPosition(this.sprite.x, this.sprite.y + progress * progress * VOID.fallDrop)
      .setAlpha(this.alpha * (1 - progress * progress));
    this.hideLights();
  }

  // Two glows over the light bar, alternating red / blue, and the same colours on the road below.
  updateLights(model, time, depth) {
    const beat = (time + this.flashOffset) / EFFECTS.lightFlashMs;
    const phase = Math.floor(beat) % 2;
    if (this.pool) {
      const pulse = 0.65 + 0.35 * Math.sin(Math.PI * (beat - Math.floor(beat)));
      this.pool
        .setVisible(true)
        .setPosition(model.x, model.y)
        .setScale(EFFECTS.sirenPoolRadius / 32)
        .setTint(phase === 0 ? PALETTE.lightRed : PALETTE.lightBlue)
        .setAlpha(EFFECTS.sirenPoolAlpha * pulse * this.alpha);
      this.glowOver
        .setVisible(true)
        .setPosition(model.x, model.y)
        .setScale((EFFECTS.sirenPoolRadius * 1.5) / 32)
        .setTint(phase === 0 ? PALETTE.lightRed : PALETTE.lightBlue)
        .setAlpha(EFFECTS.sirenGlowOverAlpha * pulse * this.alpha);
    }
    const cos = Math.cos(model.heading);
    const sin = Math.sin(model.heading);
    const ly = LIGHT_BAR.centreY;
    for (let i = 0; i < 2; i += 1) {
      const lx = (i === 0 ? -1 : 1) * LIGHT_BAR.halfWidth * 0.5;
      const wx = model.x + lx * cos + ly * sin;
      const wy = model.y + lx * sin - ly * cos;
      projection.toScreen(wx, wy, LIGHT_BAR.topZ, screen);
      const on = phase === i;
      this.lights[i]
        .setVisible(true)
        .setPosition(screen.x, screen.y)
        .setAlpha((on ? 0.95 : 0.25) * this.alpha)
        .setScale(on ? 0.6 : 0.35)
        .setDepth(depth + 0.5);
    }
  }

  drawShadow(model) {
    const count = worldShadowOutline(this.shadowPoints, model.x, model.y, model.heading, projection, this.outline, this.scratch);
    const g = this.shadows;
    this.drawContactShadow(model);
    if (count < 3) return;
    g.fillStyle(RENDER.shadowColor, RENDER.shadowAlpha * this.alpha);
    g.beginPath();
    g.moveTo(this.outline[0].x, this.outline[0].y);
    for (let i = 1; i < count; i += 1) g.lineTo(this.outline[i].x, this.outline[i].y);
    g.closePath();
    g.fillPath();
  }

  // Footprint-shaped dark patch directly under the car (no offset), the same at every heading.
  drawContactShadow(model) {
    const g = this.shadows;
    const hw = CAR_SIZE.width / 2 + RENDER.contactShadow.grow;
    const hl = CAR_SIZE.length / 2 + RENDER.contactShadow.grow;
    const fx = Math.sin(model.heading);
    const fy = -Math.cos(model.heading);
    g.fillStyle(RENDER.shadowColor, RENDER.contactShadow.alpha * this.alpha);
    g.beginPath();
    g.moveTo(model.x + fy * hw + fx * hl, model.y - fx * hw + fy * hl);
    g.lineTo(model.x - fy * hw + fx * hl, model.y + fx * hw + fy * hl);
    g.lineTo(model.x - fy * hw - fx * hl, model.y + fx * hw - fy * hl);
    g.lineTo(model.x + fy * hw - fx * hl, model.y - fx * hw - fy * hl);
    g.closePath();
    g.fillPath();
  }

  hide() {
    this.sprite.setVisible(false);
    this.hideLights();
  }

  destroy() {
    this.sprite.destroy();
    for (const light of this.lights) light.destroy();
    if (this.pool) {
      this.pool.destroy();
      this.glowOver.destroy();
    }
  }
}

// Is the car sliding enough to leave tyre marks and smoke?
export function isSkidding(model) {
  return Math.abs(model.lateralSpeed) > SKIDS.slipThreshold;
}

// World positions of the two rear tyres, written into `out` (no new objects each frame).
export function rearWheels(model, out) {
  const { x, y, heading } = model;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  const back = CAR_SIZE.length * SKIDS.rearAxle;
  const side = CAR_SIZE.width * SKIDS.wheelSpread;
  const cx = x - fx * back;
  const cy = y - fy * back;
  out[0].x = cx + fy * side; // left tyre (right vector is (-fy, fx))
  out[0].y = cy - fx * side;
  out[1].x = cx - fy * side;
  out[1].y = cy + fx * side;
  return out;
}
