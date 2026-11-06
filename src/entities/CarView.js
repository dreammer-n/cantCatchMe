import { BODY_LEAN, CAR_SIZE, DEPTH, EFFECTS, FLAT_TIRE, PALETTE, RAMP, RENDER, SKIDS, BURNT, TUMBLE, VOID } from '../config/tuning.js';
import { degToRad } from '../utils/math.js';
import { atlasMeta, frameFor } from '../render/carAtlas.js';
import { LIGHT_BAR } from '../render/carModels.js';
import * as Phaser from 'phaser';
import { depthAt } from '../render/layers.js';
import { Tumble, stepHop } from '../render/Tumble.js';
import { worldShadowOutline } from '../render/lowpoly.js';
import { projection } from '../render/projection.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const leanScreen = { x: 0, y: 0 };
const lean = { worldX: 0, worldY: 0, rotation: 0, yaw: 0 };
const shift = { x: 0, y: 0 };
const CULL_MARGIN = 140; // screen units around the camera view where cars are still drawn

const grey = (v) => (v << 16) | (v << 8) | v;
function mixColor(a, b, t) {
  const mix = (shift) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t));
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

// What a car looks like on screen. Reads the car's physics state and never changes it.
// Used for the player, police cars and wrecks (look = { atlasKey, shadowPoints, lights }). A look with a
// wheelsKey is drawn in two pieces, so the body visibly leans over wheels that stay on the road.
export class CarView {
  // shadows: one Graphics shared by all cars, in the ground shadow layer (world coordinates).
  // layers: for a cruiser's siren light on the road and nearby props (police only).
  // shadowLayer: where a wreck's soft shadow goes.
  constructor(scene, look, shadows, layers = null, shadowLayer = layers && layers.shadows) {
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
      this.pool = scene.add.image(0, 0, 'fx-pool').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lights.add(this.pool);
      this.glowOver = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lightsOver.add(this.glowOver);
    }
    this.softShadow = scene.add.image(0, 0, 'fx-glow').setTint(RENDER.shadowColor).setVisible(false);
    shadowLayer.add(this.softShadow);
    this.tumble = new Tumble();
    this.flashOffset = Math.random() * 1000;
    this.alpha = 1;
    this.wasFalling = false;
    this.frozen = false;
    this.dark = false;
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

  // A dead engine (BLACKOUT): lights out and a little greyer.
  setDark(dark) {
    if (dark === this.dark) return;
    this.dark = dark;
    if (this.frozen) return;
    if (dark) this.sprite.setTint(PALETTE.stalled);
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

  // A wreck is thrown in the air: call after setLook.
  startTumble() {
    this.tumble.start(Math.random);
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
    this.softShadow.setVisible(false);
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
    if (tumbling) this.tumble.update(dt);
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
      this.softShadow.setVisible(false);
      return false;
    }
    const depth = depthAt(model.x, model.y);
    const heading = model.heading + this.tumble.spin;
    const leaning = !tumbling && !model.isFalling;
    if (leaning) bodyLean(model, lean);
    else lean.worldX = lean.worldY = lean.rotation = lean.yaw = 0;
    const hop = leaning ? this.updateHop(time) : 0;
    // On a ramp: up on its surface, nose and sides tilted as its wheels are. Off it: flying in the arc the physics
    // works out, rolling over if it left lopsided, its nose dipping as it comes down.
    const facing = projection.screenHeading(model.heading);
    let ramp = 0;
    let pitch = 0;
    let roll = 0;
    let air = 0;
    if (model.air > 0) {
      const t = model.airTotal - model.air;
      air = Math.max(0, model.airStart + model.airVz * t - (RAMP.gravity * t * t) / 2);
      roll = model.roll;
      pitch = model.airVz > 0 ? Math.atan((model.airVz - RAMP.gravity * t) / Math.max(1, model.speed)) : 0;
    } else if (model.rampShape || model.rampLift > 0) {
      ramp = model.rampLift;
      pitch = model.rampPitch;
      roll = model.rampRoll;
    }
    if (leaning) lean.rotation += -pitch * Math.sin(facing) - roll * Math.cos(facing);
    const lift = (hop + air + ramp) * projection.lift;
    if (this.showWheels) {
      const share = BODY_LEAN.wheelsFollow;
      frameFor(heading + lean.yaw, projection, pick, this.wheelDirections);
      projection.toScreen(model.x + lean.worldX * share, model.y + lean.worldY * share, 0, leanScreen);
      this.wheels.setFrame(pick.frame).setRotation(pick.rotation + lean.rotation * share).setPosition(leanScreen.x, leanScreen.y - lift).setDepth(depth - 0.01);
    }
    frameFor(heading + lean.yaw, projection, pick, this.directions);
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
        .setRotation(pick.rotation + this.tumble.tilt)
        .setY(screen.y - this.tumble.z * projection.lift)
        .setScale(model.scale / RENDER.bakeScale);
      // In the air it rises out of the flames, so it stays in view.
      if (this.tumble.z > TUMBLE.overFlamesHeight) this.sprite.setDepth(DEPTH.effects + 2);
    }
    if (this.wasFalling) this.endFall();
    // Rolling over across the screen shows as the car flattening and turning over.
    if (Math.abs(roll) > 0.02) {
      const s = model.scale / RENDER.bakeScale;
      const squash = 1 - (1 - Math.abs(Math.cos(roll))) * Math.abs(Math.sin(facing));
      this.sprite.setScale(s, s * Math.max(0.12, squash)).setFlipY(Math.cos(roll) < 0 && Math.abs(Math.sin(facing)) > 0.5);
      if (this.wheels) this.wheels.setScale(s, s * Math.max(0.12, squash));
      this.rolled = true;
    } else if (this.rolled) {
      this.rolled = false;
      this.sprite.setFlipY(false);
      this.setScales(model.scale / RENDER.bakeScale);
    }
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
    if (this.currentLook.burnt) this.drawSoftShadow(model, heading);
    else this.drawShadow(model);
    if (this.frozen) this.drawFrozenGlow(model);
    else if (this.hasLights && !this.dark) this.updateLights(model, time, depth);
    else this.hideLights();
    return true;
  }

  drawFrozenGlow(model) {
    this.hideLights();
    if (!this.pool) return;
    this.pool
      .setVisible(true)
      .setPosition(model.x, model.y)
      .setScale(EFFECTS.sirenPoolRadius / 64)
      .setTint(PALETTE.frost)
      .setAlpha(EFFECTS.frozenGlowAlpha * this.alpha);
  }

  // Over the edge. Into a hole: the nose tips down and it drops, faster and faster, into the dark. Into a
  // river: it tips nose first and sinks, taking on the colour of the water. Either way it keeps its size, and
  // once it is below the ground it is seen only through the opening: the ground round the opening hides the
  // rest of it (a mask cut to the hole's outline). No shadow: the ground it would land on is gone.
  drawFalling(model) {
    this.wasFalling = true;
    this.hideLights();
    const sprite = this.sprite;
    const progress = model.fallProgress;
    const hole = model.fallShape && model.fallShape.item;
    const water = Boolean(hole && hole.water);
    const tip = Math.min(1, progress / VOID.fallTipShare);
    const scale = model.scale / RENDER.bakeScale;
    const scaleY = scale * (1 - (water ? 0.2 : 0.3) * tip); // seen from above, a tipped car looks shorter
    const groundY = sprite.y;
    const parts = this.showWheels ? [sprite, this.wheels] : [sprite];
    this.softShadow.setVisible(false);
    const y = groundY + (water ? progress * VOID.sinkDrop : progress * progress * VOID.fallDrop);
    // The nose goes first: turn the drawing the way the nose points across the screen.
    const across = Math.sin(projection.screenHeading(model.heading));
    const tint = water ? mixColor(0xffffff, PALETTE.riverDeep, Math.min(1, progress * 1.3)) : grey(Math.round(255 * (1 - 0.9 * progress ** 1.5)));
    const fade = water ? Math.min(1, (1 - progress) * 2.2) : Math.min(1, (1 - progress) * 8);
    for (const part of parts) {
      part
        .setPosition(sprite.x, y)
        .setScale(scale, scaleY)
        .setRotation(part.rotation + across * tip * (((water ? VOID.sinkTiltDeg : VOID.fallTiltDeg) * Math.PI) / 180))
        .setTint(tint)
        .setAlpha(this.alpha * fade);
    }
    if (!hole || !hole.outline || hole.outline.length === 0 || progress < VOID.maskFrom) return;
    if (!this.fallMask) {
      this.fallMask = sprite.scene.make.graphics({ add: false });
      this.fallGeometry = this.fallMask.createGeometryMask();
    }
    const g = this.fallMask;
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillPoints(hole.outline.map((p) => projection.toScreen(p.x, p.y, 0, { x: 0, y: 0 })), true);
    for (const part of parts) if (part.mask !== this.fallGeometry) part.setMask(this.fallGeometry);
  }

  endFall() {
    this.wasFalling = false;
    this.shownScale = 1;
    for (const part of this.wheels ? [this.sprite, this.wheels] : [this.sprite]) {
      part.clearMask();
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
        .setScale(EFFECTS.sirenPoolRadius / 64)
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

  // A wreck has a soft shadow, drawn through the same sun, moving away from it as it leaves the road.
  drawSoftShadow(model, heading) {
    projection.shadowOffset(this.tumble.z + BURNT.shadowLift, shift);
    const high = Math.min(1, this.tumble.z / TUMBLE.hopMax);
    this.softShadow
      .setVisible(true)
      .setPosition(model.x + shift.x, model.y + shift.y)
      .setRotation(heading)
      .setScale((CAR_SIZE.width * BURNT.shadowGrow * model.scale) / 64, (CAR_SIZE.length * BURNT.shadowGrow * model.scale) / 64)
      .setAlpha(BURNT.shadowAlpha * (1 - 0.35 * high) * this.alpha);
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
    this.softShadow.setVisible(false);
    if (this.wheels) this.wheels.setVisible(false);
    this.hideLights();
  }

  destroy() {
    this.sprite.destroy();
    this.softShadow.destroy();
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
