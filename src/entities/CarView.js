import { CAR_SIZE, EFFECTS, PALETTE, RENDER, SKIDS } from '../config/tuning.js';
import { atlasMeta, frameFor } from '../render/carAtlas.js';
import { LIGHT_BAR } from '../render/carModels.js';
import { depthAt } from '../render/layers.js';
import { worldShadowOutline } from '../render/lowpoly.js';
import { projection } from '../render/projection.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const CULL_MARGIN = 140; // screen units around the camera view where cars are still drawn

// What a car looks like on screen. Reads the car's physics state and never changes it.
// Used for the player, police cars and wrecks (look = { atlasKey, shadowPoints, lights }).
export class CarView {
  // shadows: one Graphics shared by all cars, in the ground shadow layer (world coordinates).
  constructor(scene, look, shadows) {
    this.sprite = scene.add.image(0, 0, look.atlasKey, 'dir0').setScale(1 / RENDER.bakeScale);
    this.shadows = shadows;
    // Normal blending (not additive): the lights sit between cars in the draw order, and a
    // blend change there would cost an extra draw call per police car.
    this.lights = [PALETTE.lightRed, PALETTE.lightBlue].map((tint) =>
      scene.add.image(0, 0, 'fx-glow').setTint(tint).setScale(0.55).setVisible(false),
    );
    this.flashOffset = Math.random() * 1000;
    this.alpha = 1;
    this.setLook(look);
  }

  setLook(look) {
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
    for (const light of this.lights) light.setVisible(false);
  }

  setAlpha(alpha) {
    this.alpha = alpha;
    this.sprite.setAlpha(alpha);
  }

  // view: the camera's visible rectangle in screen units (camera.worldView). time: ms, for lights.
  update(model, view, time) {
    projection.toScreen(model.x, model.y, 0, screen);
    const visible =
      !view ||
      (screen.x > view.x - CULL_MARGIN &&
        screen.x < view.right + CULL_MARGIN &&
        screen.y > view.y - CULL_MARGIN &&
        screen.y < view.bottom + CULL_MARGIN * 1.5);
    this.sprite.setVisible(visible);
    if (!visible) {
      for (const light of this.lights) light.setVisible(false);
      return false;
    }
    frameFor(model.heading, projection, pick, this.directions);
    const depth = depthAt(model.x, model.y);
    this.sprite.setFrame(pick.frame).setRotation(pick.rotation).setPosition(screen.x, screen.y).setDepth(depth);
    this.drawShadow(model);
    if (this.hasLights) this.updateLights(model, time, depth);
    return true;
  }

  // Two glows over the light bar, alternating red / blue.
  updateLights(model, time, depth) {
    const phase = Math.floor((time + this.flashOffset) / EFFECTS.lightFlashMs) % 2;
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
    for (const light of this.lights) light.setVisible(false);
  }

  destroy() {
    this.sprite.destroy();
    for (const light of this.lights) light.destroy();
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
