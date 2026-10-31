import { BODY_LEAN, CAR_SIZE, DEPTH, EFFECTS, FLAT_TIRE, PALETTE, RENDER, SKIDS, TUMBLE, VOID } from '../config/tuning.js';
import { degToRad } from '../utils/math.js';
import { atlasMeta, frameFor } from '../render/carAtlas.js';
import { LIGHT_BAR } from '../render/carModels.js';
import * as Phaser from 'phaser';
import { depthAt } from '../render/layers.js';
import { Tumble, holeLipY, stepHop } from '../render/Tumble.js';
import { worldShadowOutline } from '../render/lowpoly.js';
import { projection } from '../render/projection.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const leanScreen = { x: 0, y: 0 };
const lean = { worldX: 0, worldY: 0, rotation: 0, yaw: 0 };
const CULL_MARGIN = 140; // screen units around the camera view where cars are still drawn

// What a car looks like on screen. Reads the car's physics state and never changes it.
// Used for the player, police cars and wrecks (look = { atlasKey, shadowPoints, lights }). A look with a
// wheelsKey is drawn in two pieces, so the body visibly leans over wheels that stay on the road.
export class CarView {
  // shadows: one Graphics shared by all cars, in the ground shadow layer (world coordinates).
  // layers: for a cruiser's siren light on the road and nearby props (police only).
  constructor(scene, look, shadows, layers = null) {
    this.sprite = scene.add.image(0, 0, look.atlasKey, 'dir0').setScale(1 / RENDER.bakeScale);
    this.wheels = look.wheelsKey ? scene.add.image(0, 0, look.wheelsKey, 'dir0').setScale(1 / RENDER.bakeScale) : null;
    this.showWheels = false;
    this.hop = { z: 0, v: 0 }; // the little bounce after a knock
    this.hopSide = 1;
    this.lastHopTime = 0;
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
    this.frozen = false;
    this.shownScale = 1;
    this.setLook(look);
  }

  // Frozen solid: an icy tint, lights out, a pool of cold light underneath.
  setFrozen(frozen) {
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    if (frozen) this.sprite.setTint(PALETTE.ice);
    else this.sprite.clearTint();
  }

  // Knocked or over a curb: the car jumps on its wheels and lands again. Drawing only.
  bump(impact) {
    const strength = Math.min(1, impact / BODY_LEAN.hopFullImpact);
    this.hop.v = Math.max(this.hop.v, BODY_LEAN.hopSpeed * strength);
    this.hopSide = Math.random() < 0.5 ? -1 : 1;
  }

  updateHop(time) {
    const dt = Math.max(0, Math.min(0.05, (time - this.lastHopTime) / 1000));
    this.lastHopTime = time;
    if (this.hop.z > 0 || this.hop.v > 0) stepHop(this.hop, dt, BODY_LEAN.hopGravity, BODY_LEAN.hopBounce);
    return this.hop.z;
  }

  setLook(look) {
    this.hop.z = 0;
    this.hop.v = 0;
    if (this.wasFalling) this.endFall();
    if (this.tumble) this.endTumble();
    this.setFrozen(false);
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
    this.shownScale = 1;
    this.setScales(1 / RENDER.bakeScale);
  }

  setScales(scale) {
    this.sprite.setScale(scale);
    if (this.wheels) this.wheels.setScale(scale);
  }

  showLook(look) {
    this.currentLook = look;
    const meta = atlasMeta.get(look.atlasKey);
    this.atlasKey = look.atlasKey;
    this.lightSpot = look.lightSpot || LIGHT_BAR;
    this.directions = meta.directions;
    this.shadowPoints = look.shadowPoints;
    if (!this.scratch || this.scratch.length < this.shadowPoints.length) {
      this.scratch = this.shadowPoints.map(() => ({ x: 0, y: 0 }));
      this.outline = this.shadowPoints.map(() => ({ x: 0, y: 0 }));
    }
    this.hasLights = Boolean(look.lights);
    this.sprite.setTexture(look.atlasKey, 'dir0');
    this.sprite.setOrigin(meta.originX, meta.originY);
    this.showWheels = Boolean(this.wheels && look.wheelsKey);
    if (this.wheels) {
      this.wheels.setVisible(this.showWheels);
      if (this.showWheels) {
        const wheelMeta = atlasMeta.get(look.wheelsKey);
        this.wheelDirections = wheelMeta.directions;
        this.wheels.setTexture(look.wheelsKey, 'dir0').setOrigin(wheelMeta.originX, wheelMeta.originY);
      }
    }
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
    if (this.wheels) this.wheels.setAlpha(alpha);
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
    if (this.wheels) this.wheels.setVisible(visible && this.showWheels);
    if (!visible) {
      this.hideLights();
      return false;
    }
    const depth = depthAt(model.x, model.y);
    const leaning = !tumbling && !model.isFalling;
    if (leaning) bodyLean(model, lean);
    else lean.worldX = lean.worldY = lean.rotation = lean.yaw = 0;
    const hop = leaning ? this.updateHop(time) : 0;
    const lift = hop * projection.lift;
    if (this.showWheels) {
      const share = BODY_LEAN.wheelsFollow;
      frameFor(model.heading + lean.yaw, projection, pick, this.wheelDirections);
      projection.toScreen(model.x + lean.worldX * share, model.y + lean.worldY * share, 0, leanScreen);
      this.wheels.setFrame(pick.frame).setRotation(pick.rotation + lean.rotation * share).setPosition(leanScreen.x, leanScreen.y - lift).setDepth(depth - 0.01);
    }
    frameFor(model.heading + lean.yaw, projection, pick, this.directions);
    projection.toScreen(model.x + lean.worldX, model.y + lean.worldY, 0, leanScreen);
    this.sprite
      .setFrame(pick.frame)
      .setRotation(pick.rotation + lean.rotation + hop * BODY_LEAN.hopTilt * this.hopSide)
      .setPosition(leanScreen.x, leanScreen.y - lift)
      .setDepth(depth);
    this.leanX = leanScreen.x - screen.x;
    this.leanY = leanScreen.y - lift - screen.y;
    if (model.isFalling) {
      this.drawFalling(model);
      return true;
    }
    if (tumbling) {
      this.sprite
        .setRotation(pick.rotation + this.tumble.spin)
        .setY(screen.y - this.tumble.z * projection.lift)
        .setScale(model.scale / RENDER.bakeScale, (model.scale * this.tumble.squash) / RENDER.bakeScale);
      // In the air it flies up out of the flames, so it stays in view.
      if (this.tumble.z > TUMBLE.overFlamesHeight) this.sprite.setDepth(DEPTH.effects + 2);
    }
    if (this.wasFalling) this.endFall();
    const flat = model.flatness;
    if (flat > 0 && !tumbling) {
      // It sits down on the flat corner, which leans whichever way that corner faces on screen, and rattles.
      const facing = Math.cos(projection.screenHeading(model.heading));
      this.sprite
        .setRotation(this.sprite.rotation + model.flatSide * facing * degToRad(FLAT_TIRE.leanDeg) * flat)
        .setY(this.sprite.y + Math.sin(time * FLAT_TIRE.rattleRate) * FLAT_TIRE.rattle * flat);
    }
    if (!tumbling && model.scale !== this.shownScale) {
      this.shownScale = model.scale;
      this.setScales(model.scale / RENDER.bakeScale);
    }
    this.drawShadow(model);
    if (this.frozen) this.drawFrozenGlow(model);
    else if (this.hasLights) this.updateLights(model, time, depth);
    return true;
  }

  drawFrozenGlow(model) {
    this.hideLights();
    if (!this.pool) return;
    this.pool
      .setVisible(true)
      .setPosition(model.x, model.y)
      .setScale(EFFECTS.sirenPoolRadius / 32)
      .setTint(PALETTE.frost)
      .setAlpha(EFFECTS.frozenGlowAlpha * this.alpha);
  }

  // Over the edge: the nose tips down, it drops faster and faster into the dark, and the near lip of
  // the hole hides it as it goes. No shadow: the ground it would land on is gone.
  drawFalling(model) {
    this.wasFalling = true;
    this.hideLights();
    const sprite = this.sprite;
    const progress = model.fallProgress;
    const tip = Math.min(1, progress / VOID.fallTipShare);
    const scale = (model.scale * (1 - (1 - VOID.fallScale) * progress)) / RENDER.bakeScale;
    const scaleY = scale * (1 - 0.3 * tip); // seen from above, a tipped car looks shorter
    const groundY = sprite.y;
    const parts = this.showWheels ? [sprite, this.wheels] : [sprite];
    const y = groundY + progress * progress * VOID.fallDrop;
    // The nose goes first: turn the drawing the way the nose points across the screen.
    const across = Math.sin(projection.screenHeading(model.heading));
    const shade = Math.round(255 * (1 - 0.9 * progress ** 1.5));
    for (const part of parts) {
      part
        .setPosition(sprite.x, y)
        .setScale(scale, scaleY)
        .setRotation(part.rotation + across * tip * ((VOID.fallTiltDeg * Math.PI) / 180))
        .setTint((shade << 16) | (shade << 8) | shade)
        .setAlpha(this.alpha * Math.min(1, (1 - progress) * 8));
    }
    const outline = model.fallShape && model.fallShape.item.outline;
    if (!outline || outline.length === 0) return;
    // Hidden below the lip. A car that came in over the near side still has its tail over the road, so
    // nothing above its own undercarriage line is hidden: only what has actually dropped.
    const height = sprite.frame.cutHeight;
    const underside = groundY + (1 - sprite.originY) * height * scaleY;
    const lip = Math.max(holeLipY(outline, sprite.x, projection), underside);
    for (const part of parts) {
      const partHeight = part.frame.cutHeight;
      const top = y - part.originY * partHeight * scaleY;
      part.setCrop(0, 0, part.frame.cutWidth, Math.max(0, Math.min(partHeight, (lip - top) / scaleY)));
    }
  }

  endFall() {
    this.wasFalling = false;
    this.shownScale = 1;
    for (const part of this.wheels ? [this.sprite, this.wheels] : [this.sprite]) {
      part.setCrop();
      part.clearTint();
      part.setScale(1 / RENDER.bakeScale).setAlpha(this.alpha);
    }
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
    const spot = this.lightSpot;
    const ly = spot.centreY * model.scale;
    for (let i = 0; i < 2; i += 1) {
      const lx = (i === 0 ? -1 : 1) * spot.halfWidth * 0.5 * model.scale;
      const wx = model.x + lx * cos + ly * sin;
      const wy = model.y + lx * sin - ly * cos;
      projection.toScreen(wx, wy, spot.topZ * model.scale, screen);
      const on = phase === i;
      this.lights[i]
        .setVisible(true)
        .setPosition(screen.x + this.leanX, screen.y + this.leanY)
        .setAlpha((on ? 0.95 : 0.25) * this.alpha)
        .setScale(on ? 0.6 : 0.35)
        .setDepth(depth + 0.5);
    }
  }

  drawShadow(model) {
    // The shadow follows the lean; the dark patch right under the car stays with the wheels.
    const x = model.x + lean.worldX * BODY_LEAN.shadowShare;
    const y = model.y + lean.worldY * BODY_LEAN.shadowShare;
    const count = worldShadowOutline(this.shadowPoints, x, y, model.heading, projection, this.outline, this.scratch, model.scale);
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
    const hw = (CAR_SIZE.width / 2) * model.scale + RENDER.contactShadow.grow;
    const hl = (CAR_SIZE.length / 2) * model.scale + RENDER.contactShadow.grow;
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
    if (this.wheels) this.wheels.setVisible(false);
    this.hideLights();
  }

  destroy() {
    this.sprite.destroy();
    if (this.wheels) this.wheels.destroy();
    for (const light of this.lights) light.destroy();
    if (this.pool) {
      this.pool.destroy();
      this.glowOver.destroy();
    }
  }
}

// How the body is displaced by its suspension right now: a shift over the wheels, the tilt that shows up
// on screen, and the nose drawn a little ahead of the turn. A roll reads as a tilt when the car faces up or
// down the screen, a pitch when it faces across it.
export function bodyLean(model, out) {
  const h = model.handling;
  const roll = model.chassisRoll;
  const pitch = model.chassisPitch;
  const side = (roll / degToRad(h.rollMaxDeg)) * BODY_LEAN.rollShift * model.scale;
  const ahead = (pitch / degToRad(h.pitchMaxDeg)) * BODY_LEAN.pitchShift * model.scale;
  const sin = Math.sin(model.heading);
  const cos = Math.cos(model.heading);
  out.worldX = cos * side + sin * ahead;
  out.worldY = sin * side - cos * ahead;
  const facing = projection.screenHeading(model.heading);
  out.rotation = roll * Math.cos(facing) + pitch * Math.sin(facing);
  const most = degToRad(BODY_LEAN.yawMaxDeg);
  out.yaw = Math.max(-most, Math.min(most, model.angularVelocity * BODY_LEAN.yawLeadSeconds));
  return out;
}

// Is the car sliding enough to leave tire marks and smoke?
export function isSkidding(model) {
  return Math.abs(model.lateralSpeed) > SKIDS.slipThreshold;
}

// World positions of the two rear tires, written into `out` (no new objects each frame).
export function rearWheels(model, out) {
  const { x, y, heading } = model;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  const back = CAR_SIZE.length * SKIDS.rearAxle * model.scale;
  const side = CAR_SIZE.width * SKIDS.wheelSpread * model.scale;
  const cx = x - fx * back;
  const cy = y - fy * back;
  out[0].x = cx + fy * side; // left tire (right vector is (-fy, fx))
  out[0].y = cy - fx * side;
  out[1].x = cx - fy * side;
  out[1].y = cy + fx * side;
  return out;
}
