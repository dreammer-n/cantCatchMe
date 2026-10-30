import * as Phaser from 'phaser';
import { DEBUG } from '../config/debug.js';
import {
  AUDIO,
  CRASH,
  DEFAULT_HANDLING_PRESET,
  DEPTH,
  DEV_PANEL,
  DISPLAY,
  EFFECTS,
  EXPLOSION,
  HANDLING_PRESETS,
  HITSTOP,
  PALETTE,
  POWERUP,
  RENDER,
  TRAUMA,
  TUMBLE,
  VIEW,
  VOID,
  WRECK,
} from '../config/tuning.js';
import { CarView, isSkidding, rearWheels } from '../entities/CarView.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { CameraRig } from '../render/CameraRig.js';
import { ensureCarAtlas } from '../render/carAtlas.js';
import { carShadowPoints } from '../render/carModels.js';
import { Effects } from '../render/Effects.js';
import { createLayers, depthAt } from '../render/layers.js';
import { bakeMesh, releaseOtherViews } from '../render/lowpoly.js';
import { projection } from '../render/projection.js';
import { crate as crateModel } from '../render/propModels.js';
import { Scenery } from '../render/Scenery.js';
import { SirenBeams } from '../render/SirenBeams.js';
import { ChaseSimulation } from '../systems/ChaseSimulation.js';
import { HitStop } from '../systems/HitStop.js';
import { Records } from '../systems/ScoreSystem.js';
import { ThreatRadar } from '../systems/ThreatRadar.js';
import { SkidMarks } from '../systems/SkidMarks.js';
import { degToRad, wrapAngle } from '../utils/math.js';

const screenPoint = { x: 0, y: 0 };
const ATTRACT_HEADING = degToRad(150); // a flattering three-quarter view on the title screen

// The game world. All rules live in ChaseSimulation (pure logic); this scene draws the result,
// plays effects and sounds for the simulation's events, and runs the flow:
//   'attract' (title screen: the car turns slowly on the start ring)
//   'playing' -> 'crashed' (slow motion for a moment) -> results (GameOverScene)
export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    this.controls = this.registry.get('input');
    this.audio = this.registry.get('audio');
    this.layout = this.registry.get('layout');
    this.layers = createLayers(this);
    this.scenery = new Scenery(this, this.layers);
    this.sim = new ChaseSimulation({ layout: this.layout, handling: this.currentHandling() });

    // One shared drawing for every car's ground shadow (cleared each frame).
    this.carShadows = this.add.graphics();
    this.layers.shadows.add(this.carShadows);
    this.looks = this.makeLooks();
    this.playerView = new CarView(this, this.looks.player, this.carShadows);
    this.freeViews = [];
    this.skids = new SkidMarks(this, this.layers.ground);
    this.effects = new Effects(this, this.layers);
    this.createCrate();

    this.wheels = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    this.hitStop = new HitStop();
    this.pendingPower = false; // a Shockwave press during a hit-stop waits for the action to restart
    this.radar = new ThreatRadar();
    this.beams = new SirenBeams(this, this.layers.lights);
    this.rig = new CameraRig();
    this.rig.reset(this.sim.player.x, this.sim.player.y);
    this.view = { x: 0, y: 0, right: 0, bottom: 0 }; // visible screen rectangle
    this.simView = { cx: 0, cy: 0, halfW: 0, halfH: 0 };
    this.smokeClock = new Map();
    this.mode = 'attract';
    this.turntable = false; // debug inspection tool
    this.simTime = 0; // seconds of game time (for tests)
    this.crashClock = 0;
    this.finished = false;

    this.applyFraming();
    this.scale.on('resize', this.applyFraming, this);
    this.registry.events.on('changedata-handlingPreset', this.onHandlingChanged, this);
    const stopWatchingView = projection.onChange(() => this.onViewChanged());
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.applyFraming, this);
      this.registry.events.off('changedata-handlingPreset', this.onHandlingChanged, this);
      stopWatchingView();
    });

    this.enterAttract();
    if (DEBUG) this.installDebugHooks();
  }

  currentHandling() {
    return HANDLING_PRESETS[this.registry.get('handlingPreset')] || HANDLING_PRESETS[DEFAULT_HANDLING_PRESET];
  }

  onHandlingChanged() {
    this.sim.player.setHandling(this.currentHandling());
  }

  makeLooks() {
    const look = (name, lights) => ({ atlasKey: ensureCarAtlas(this, name), shadowPoints: carShadowPoints(name), lights });
    return { player: look('player', false), police: look('police', true), interceptor: look('interceptor', true), wreck: look('wreck', false), wreckRoof: look('wreckRoof', false) };
  }

  // ------------------------------------------------------------------------------------------
  // Flow
  // ------------------------------------------------------------------------------------------

  enterAttract() {
    this.sim.reset(1);
    this.sim.player.heading = ATTRACT_HEADING;
    this.mode = 'attract';
    this.turntable = false;
    this.resetVisuals();
    this.snapCamera();
    this.audio.quiet();
  }

  startRun(seed = (Math.random() * 2 ** 31) >>> 0) {
    this.sim.reset(seed);
    this.hitStop.reset();
    this.pendingPower = false;
    this.mode = 'playing';
    this.turntable = false;
    this.crashClock = 0;
    this.finished = false;
    this.resetVisuals();
    this.snapCamera();
    this.audio.play('start');
    PlatformManager.runStarted();
    this.game.events.emit('run-started');
  }

  get running() {
    return this.mode === 'playing';
  }

  finishRun() {
    this.finished = true;
    const summary = this.sim.stats.summary();
    const { newBest, best } = Records.submit(summary);
    PlatformManager.flush();
    this.audio.quiet();
    const data = { summary, best, newBest, cause: this.sim.crash ? this.sim.crash.cause : 'police' };
    this.game.events.emit('run-over', data);
    this.scene.launch('GameOverScene', data);
  }

  resetVisuals() {
    for (const police of this.sim.police) if (police.view) this.releaseView(police);
    for (const view of this.freeViews) view.hide();
    this.playerView.setLook(this.looks.player);
    this.playerView.setAlpha(1);
    this.skids.clear();
    this.effects.clear();
    this.smokeClock.clear();
    this.hideCrate();
    this.radar.clear();
    this.scenery.sync(this.sim.chunks, Infinity);
    this.cameras.main.resetFX();
  }

  // ------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------

  update(time, delta) {
    const frameMs = Math.min(delta, DISPLAY.maxFrameDeltaMs);
    const dt = frameMs / 1000;
    this.simTime += dt;
    const command = this.controls.getCommand();
    let gameDt = dt;
    const frozen = this.hitStop.update(frameMs);
    if (command.activatePowerUp) this.pendingPower = true;

    if (frozen) {
      gameDt = 0; // the action holds; camera shake and starbursts carry on
    } else if (this.mode === 'attract' || this.turntable) {
      this.spinInPlace(this.turntable ? command.steer : 0, dt);
    } else {
      if (this.mode === 'crashed') {
        gameDt = dt * CRASH.slowMotion;
        this.crashClock += dt;
        if (!this.finished && this.crashClock >= CRASH.gameOverDelay) this.finishRun();
      }
      const playing = this.mode === 'playing';
      const events = this.sim.step(gameDt, { steer: playing ? command.steer : 0, activatePowerUp: playing && this.pendingPower }, this.simView);
      this.pendingPower = false;
      this.handleEvents(events);
    }

    this.scenery.sync(this.sim.chunks);
    this.followCar(dt);
    if (this.mode === 'playing' && !this.turntable) this.radar.update(this.sim, this.simView, dt);
    else this.radar.clear();
    this.beams.update(this.radar.threats, this.sim.player, time);
    this.carShadows.clear();
    this.syncCars(time, gameDt, dt);
    this.updateTyresAndFires(gameDt * 1000);
    this.updateCrate(time);
    this.scenery.syncCones(this.sim.cones);
    this.scenery.cull(this.view);
    this.effects.update(gameDt);
    this.updateAudio(dt);
  }

  handleEvents(events) {
    const player = this.sim.player;
    for (const e of events) {
      switch (e.type) {
        case 'spawn':
          this.acquireView(e.police, this.lookFor(e.police));
          break;
        case 'wreck':
          if (e.police.view && e.cause !== 'void') {
            e.police.view.setLook(this.looks.wreck);
            e.police.view.startTumble(this.looks.wreckRoof);
          }
          break;
        case 'fall':
          this.audio.play('bump', 0.6);
          this.rig.addTrauma(TRAUMA.fall);
          break;
        case 'explosion': {
          const distance = Math.hypot(e.x - player.x, e.y - player.y);
          this.effects.explosion(e.x, e.y, e.player);
          if (!e.player && distance < HITSTOP.wreckRange) this.punch(HITSTOP.wreckMs);
          this.audio.play('explosion', 1 - distance / AUDIO.explosionRange);
          if (!e.player && distance < EXPLOSION.shakeDistance) this.rig.addTrauma(TRAUMA.explosion * (1 - distance / EXPLOSION.shakeDistance));
          break;
        }
        case 'crash':
          this.mode = 'crashed';
          if (e.cause === 'void') {
            // Already out of sight: no wreck, no bang, and a shorter wait for the results.
            this.crashClock = CRASH.gameOverDelay - VOID.resultsDelay;
          } else {
            this.playerView.setLook(this.looks.wreck);
            this.playerView.startTumble(this.looks.wreckRoof);
            this.hitStop.trigger(HITSTOP.crashMs);
            this.audio.play('crash');
            this.rig.addTrauma(TRAUMA.crash);
          }
          this.controls.releaseHeld();
          PlatformManager.runFailed();
          this.game.events.emit('run-crashed', e.cause);
          break;
        case 'despawn':
        case 'wreckGone':
          if (e.police.view) this.releaseView(e.police);
          break;
        case 'combo':
          this.toast(comboText(e.count), 'combo');
          this.audio.play('combo');
          this.punch(HITSTOP.comboMs);
          break;
        case 'nearMiss':
          this.toast('CLOSE CALL!', 'near');
          this.audio.play('nearMiss');
          this.rig.addTrauma(TRAUMA.nearMiss);
          break;
        case 'pickup':
          this.toast('SHOCKWAVE READY!', 'power');
          this.audio.play('pickup');
          break;
        case 'pulse':
          this.effects.shockwave(e.x, e.y, e.radius, POWERUP.pulseSeconds);
          this.audio.play('pulse');
          this.rig.addTrauma(TRAUMA.pulse);
          break;
        case 'bump':
          this.audio.play('bump', e.impact / 250);
          this.rig.addTrauma(TRAUMA.bump);
          this.effects.impact(e.x, e.y, EFFECTS.burstBump);
          this.punch(HITSTOP.bumpMs);
          break;
        case 'scrape':
          this.rig.addTrauma(TRAUMA.scrape);
          this.effects.impact(e.x, e.y, EFFECTS.burstScrape);
          this.punch(HITSTOP.scrapeMs);
          break;
        case 'curb':
          this.audio.play('bump', 0.3);
          this.rig.addTrauma(TRAUMA.curb);
          break;
        case 'cone':
          if (e.cone.item.kind === 'civilian') this.onParkedCarHit(e);
          else {
            this.audio.play('cone', 0.8);
            if (e.player) this.rig.addTrauma(TRAUMA.knock);
          }
          break;
        default:
          break;
      }
    }
  }

  onParkedCarHit(e) {
    this.audio.play('bump', e.player ? 0.8 : 0.4);
    this.effects.impact(e.x, e.y, EFFECTS.burstSmash);
    if (!e.player) return;
    this.rig.addTrauma(TRAUMA.smash);
    this.punch(HITSTOP.smashMs);
  }

  lookFor(police) {
    return police.role === 'interceptor' ? this.looks.interceptor : this.looks.police;
  }

  // Freezes the action for a moment. Only in play: a crash has its own slow motion.
  punch(ms) {
    if (this.mode === 'playing') this.hitStop.trigger(ms);
  }

  toast(text, kind) {
    this.game.events.emit('toast', text, kind);
  }

  acquireView(police, look) {
    const view = this.freeViews.pop() || new CarView(this, look, this.carShadows, this.layers);
    view.setLook(look);
    view.setAlpha(1);
    police.view = view;
  }

  releaseView(police) {
    police.view.hide();
    this.freeViews.push(police.view);
    police.view = null;
  }

  syncCars(time, gameDt, realDt) {
    // The player's crash plays out during the slow motion, so it runs on real time.
    this.playerView.update(this.sim.player, this.view, time, realDt * TUMBLE.playerTimeScale);
    for (const police of this.sim.police) {
      if (!police.active || !police.view) continue;
      if (police.state === 'wreck') {
        const left = WRECK.lifetime - police.wreckTime;
        police.view.setAlpha(left < WRECK.fadeSeconds ? Math.max(0, left / WRECK.fadeSeconds) : 1);
      }
      police.view.update(police.model, this.view, time, gameDt);
    }
  }

  // Skid marks and tyre smoke for every sliding car on screen; smoke and flames from wrecks.
  updateTyresAndFires(ms) {
    const driving = this.mode !== 'attract' && !this.turntable;
    if (driving && this.mode === 'playing') {
      this.tyres(0, this.sim.player, ms);
    } else {
      this.skids.addPoint(0, 0, 0, false);
      this.skids.addPoint(1, 0, 0, false);
    }
    for (const police of this.sim.police) {
      if (!police.view) continue;
      const onScreen = police.view.sprite.visible;
      if (police.alive && onScreen) this.tyres((police.id + 1) * 2, police.model, ms);
      else if (police.state === 'wreck' && onScreen && !police.model.isFalling) this.burn(police.id, police.model, police.wreckTime, ms);
    }
    if (this.sim.state === 'crashed' && !this.sim.player.isFalling) this.burn(-1, this.sim.player, this.crashClock * 2, ms);
    this.skids.update(ms);
  }

  tyres(track, model, ms) {
    const skidding = isSkidding(model);
    rearWheels(model, this.wheels);
    this.skids.addPoint(track, this.wheels[0].x, this.wheels[0].y, skidding);
    this.skids.addPoint(track + 1, this.wheels[1].x, this.wheels[1].y, skidding);
    if (!skidding) return;
    const clock = (this.smokeClock.get(track) || 0) + ms;
    if (clock >= EFFECTS.smokeEveryMs) {
      this.effects.smokePuff(this.wheels[0].x, this.wheels[0].y);
      this.effects.smokePuff(this.wheels[1].x, this.wheels[1].y);
      this.smokeClock.set(track, 0);
    } else {
      this.smokeClock.set(track, clock);
    }
  }

  burn(id, model, age, ms) {
    if (age > WRECK.lifetime - WRECK.fadeSeconds) return;
    const key = `w${id}`;
    const clock = (this.smokeClock.get(key) || 0) + ms;
    if (clock < EFFECTS.wreckSmokeEveryMs) {
      this.smokeClock.set(key, clock);
      return;
    }
    this.smokeClock.set(key, 0);
    this.effects.smokePuff(model.x, model.y, 22, true);
    if (age < 3.5) this.effects.flame(model.x, model.y);
  }

  // ------------------------------------------------------------------------------------------
  // Shockwave crate
  // ------------------------------------------------------------------------------------------

  createCrate() {
    this.crateMesh = crateModel();
    this.crateGlow = this.add.image(0, 0, 'fx-glow').setTint(PALETTE.crateGlow).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.shadows + 1);
    this.crateShadow = this.add.image(0, 0, '__DEFAULT').setAlpha(RENDER.shadowAlpha).setDepth(DEPTH.shadows);
    this.crateBody = this.add.image(0, 0, '__DEFAULT');
    this.bakeCrate();
    this.hideCrate();
  }

  bakeCrate() {
    const key = `prop:crate:0:${projection.key}`;
    const body = bakeMesh(this, key, this.crateMesh, 0, projection, 'body');
    const shadow = bakeMesh(this, `${key}:shadow`, this.crateMesh, 0, projection, 'shadow');
    this.crateBody.setTexture(body.key).setOrigin(body.originX, body.originY).setScale(1 / body.scale);
    this.crateShadow.setTexture(shadow.key).setOrigin(shadow.originX, shadow.originY).setScale(1 / shadow.scale);
  }

  hideCrate() {
    for (const image of [this.crateGlow, this.crateShadow, this.crateBody]) image.setVisible(false);
  }

  updateCrate(time) {
    const crate = this.sim.powerUps.crate;
    if (!crate.active || this.mode === 'attract') {
      this.hideCrate();
      return;
    }
    projection.toScreen(crate.x, crate.y, 0, screenPoint);
    const bob = 12 + Math.sin(time / 260) * 6;
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    this.crateGlow.setVisible(true).setPosition(screenPoint.x, screenPoint.y).setScale(2.2 + pulse * 0.5, (2.2 + pulse * 0.5) * projection.squash).setAlpha(0.45 + pulse * 0.25);
    this.crateShadow.setVisible(true).setPosition(screenPoint.x, screenPoint.y);
    this.crateBody
      .setVisible(true)
      .setPosition(screenPoint.x, screenPoint.y - bob * projection.lift)
      .setDepth(depthAt(crate.x, crate.y));
  }

  // Crate position on the screen in canvas pixels (for the off-screen arrow), or null.
  crateOnCanvas(out) {
    const crate = this.sim.powerUps.crate;
    if (!crate.active || this.mode !== 'playing') return null;
    return this.pointOnCanvas(crate.x, crate.y, 10, out);
  }

  // A world position in canvas pixels. For things drawn over the world by UIScene.
  pointOnCanvas(x, y, z, out) {
    const camera = this.cameras.main;
    projection.toScreen(x, y, z, screenPoint);
    out.x = (screenPoint.x - this.view.x) * camera.zoom;
    out.y = (screenPoint.y - this.view.y) * camera.zoom;
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------------------------------

  // The car looks the same size on every screen; physics never changes with screen shape.
  applyFraming() {
    const camera = this.cameras.main;
    const { width, height } = this.scale;
    camera.setSize(width, height);
    this.baseZoom = Math.min(width, height) / VIEW.shortSideWorldUnits;
    camera.setZoom(this.baseZoom * this.rig.zoom);
    this.centerCamera();
  }

  // Look-ahead, speed zoom and shake are worked out by the rig; this applies them to the camera.
  followCar(dt) {
    const camera = this.cameras.main;
    this.rig.update(this.sim.player, dt, camera.width / this.baseZoom / 2, camera.height / this.baseZoom / 2);
    camera.setZoom(this.baseZoom * this.rig.zoom);
    this.centerCamera();
  }

  snapCamera() {
    this.rig.reset(this.sim.player.x, this.sim.player.y);
    this.cameras.main.setZoom(this.baseZoom);
    this.centerCamera();
  }

  centerCamera() {
    const camera = this.cameras.main;
    projection.toScreen(this.rig.x, this.rig.y, 0, screenPoint);
    camera.centerOn(screenPoint.x + this.rig.shakeX, screenPoint.y + this.rig.shakeY);
    const halfW = camera.width / camera.zoom / 2;
    const halfH = camera.height / camera.zoom / 2;
    Object.assign(this.simView, { cx: screenPoint.x, cy: screenPoint.y, halfW, halfH });
    Object.assign(this.view, { x: screenPoint.x - halfW, y: screenPoint.y - halfH, right: screenPoint.x + halfW, bottom: screenPoint.y + halfH });
  }

  // The camera setup changed (debug tool): re-turn and re-tilt the ground, redraw everything for
  // the new view.
  onViewChanged() {
    this.layers.applyProjection();
    this.scenery.redraw();
    this.looks = this.makeLooks();
    this.playerView.setLook(this.sim.state === 'crashed' ? this.looks.wreck : this.looks.player);
    for (const police of this.sim.police) {
      if (police.view) police.view.setLook(police.alive ? this.lookFor(police) : this.looks.wreck);
    }
    this.bakeCrate();
    releaseOtherViews(this, projection.key);
    this.centerCamera();
  }

  // ------------------------------------------------------------------------------------------
  // Sound
  // ------------------------------------------------------------------------------------------

  updateAudio(dt) {
    const player = this.sim.player;
    let nearest = Infinity;
    if (this.mode !== 'attract') {
      for (const police of this.sim.police) {
        if (!police.alive) continue;
        nearest = Math.min(nearest, Math.hypot(police.model.x - player.x, police.model.y - player.y));
      }
    }
    this.audio.update(dt, {
      driving: this.mode === 'playing' && !this.turntable,
      speed: player.speed,
      slip: Math.abs(player.lateralSpeed),
      sirenDistance: this.mode === 'playing' ? nearest : Infinity,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Title screen showcase / debug turntable: the car turns on the spot.
  // ------------------------------------------------------------------------------------------

  setTurntable(on) {
    if (this.mode !== 'playing') return;
    const car = this.sim.player;
    this.turntable = on;
    car.reset(car.x, car.y, car.heading);
    if (!on) car.launch(car.handling.topSpeed);
  }

  spinInPlace(steer, dt) {
    const car = this.sim.player;
    const rate = steer !== 0 ? steer * DEV_PANEL.turntableTurnDeg : DEV_PANEL.turntableSpinDeg;
    car.heading = wrapAngle(car.heading + degToRad(rate) * dt);
  }

  // ------------------------------------------------------------------------------------------
  // Debug (only with ?debug in the address)
  // ------------------------------------------------------------------------------------------

  getDebugState() {
    const car = this.sim.player;
    const camera = this.cameras.main;
    const sprite = this.playerView.sprite;
    return {
      x: car.x,
      y: car.y,
      heading: car.heading,
      speed: car.speed,
      driftDeg: car.driftAngleDeg,
      slipAngle: car.slipAngle,
      chassisRoll: car.chassisRoll,
      trauma: this.rig.trauma,
      warnings: this.radar.threats.length,
      isFalling: car.isFalling,
      chunkX: this.sim.chunks.cx,
      chunkY: this.sim.chunks.cy,
      chunksLoaded: this.sim.chunks.active.size,
      shapes: this.sim.world.shapes.length,
      propsInUse: this.scenery.items.length,
      propsFree: this.scenery.freeProps.length,
      mode: this.mode,
      runState: this.sim.state,
      runTime: this.sim.time,
      police: this.sim.alivePolice,
      cars: this.sim.activeCars,
      wrecks: this.sim.stats.wrecks,
      nearMisses: this.sim.stats.nearMisses,
      powerHeld: this.sim.powerUps.held,
      crate: this.sim.powerUps.crate.active,
      preset: this.registry.get('handlingPreset'),
      skidMarks: this.skids.activeCount,
      cameraX: camera.midPoint.x,
      cameraY: camera.midPoint.y,
      zoom: camera.zoom,
      paused: this.scene.isPaused(),
      view: projection.viewId,
      azimuth: projection.azimuthDeg,
      elevation: projection.elevationDeg,
      groundScaleY: this.layers.groundScaleY,
      spriteX: sprite.x,
      spriteY: sprite.y,
      spriteFrame: sprite.frame.name,
      spriteRotation: sprite.rotation,
      carDepth: sprite.depth,
      cameraRotation: camera.rotation,
      groundRotation: this.carShadows.parentContainer.rotation,
      spriteScaleX: sprite.scaleX,
      spriteScaleY: sprite.scaleY,
      turntable: this.turntable,
      simTime: this.simTime,
      visibleProps: this.scenery.items.filter((item) => item.body.visible).length,
      platform: PlatformManager.platformId,
      storage: PlatformManager.storageKind,
      audioAllowed: this.audio.platformAllowed,
      soundOn: this.audio.soundOn,
      audioPaused: this.audio.paused || this.audio.platformPaused,
      policePool: this.sim.police.length,
      freeViews: this.freeViews.length,
      textures: this.textures.getTextureKeys().length,
    };
  }

  installDebugHooks() {
    const hook = () => this.getDebugState();
    hook.scenery = () => this.scenery.describe();
    hook.sim = () => this.sim;
    hook.scene = () => this;
    hook.startRun = (seed) => this.startRun(seed);
    hook.spawnPolice = (x, y, heading, options) => {
      const police = this.sim.spawnPolice(x, y, heading, { role: 'chaser', speedFactor: 1.1, turnDeg: 125, aimSide: 0, ...options });
      this.acquireView(police, this.lookFor(police));
      return police.id;
    };
    hook.teleport = (x, y, heading = 0, freeze = false) => {
      const car = this.sim.player;
      car.reset(x, y, heading);
      car.launch(car.handling.topSpeed);
      this.snapCamera();
      this.playerView.update(car, this.view, 0);
      if (freeze) this.scene.pause();
    };
    hook.unfreeze = () => this.scene.resume();
    hook.crash = (cause = 'obstacle') => {
      this.sim.crashPlayer(cause);
      this.sim.runExplosions();
      this.handleEvents(this.sim.events.splice(0));
    };
    hook.scenes = () => this.game.scene.getScenes(true).map((scene) => scene.scene.key);
    hook.sceneInfo = (key) => {
      const scene = this.scene.get(key);
      return { now: scene.time.now, readyAt: scene.readyAt, active: scene.scene.isActive() };
    };
    hook.perf = installPerfProbe(this.game);
    window.__carChaseDebug = hook;
  }
}

function comboText(count) {
  if (count === 2) return 'DOUBLE WRECK!';
  if (count === 3) return 'TRIPLE WRECK!';
  return `${count}× PILE-UP!`;
}

// Debug probe: average time the game spends per frame (update + draw submission) and the
// number of draw calls sent to the graphics card. Draw calls are the main cost on phones.
function installPerfProbe(game) {
  if (game.perfProbe) return game.perfProbe;
  const samples = [];
  let start = 0;
  let calls = 0;
  let lastCalls = 0;
  const gl = game.renderer.gl;
  if (gl) {
    for (const name of ['drawArrays', 'drawElements']) {
      const original = gl[name].bind(gl);
      gl[name] = (...args) => {
        calls += 1;
        return original(...args);
      };
    }
  }
  game.events.on('prestep', () => {
    start = performance.now();
    calls = 0;
  });
  game.events.on('postrender', () => {
    samples.push(performance.now() - start);
    if (samples.length > 120) samples.shift();
    lastCalls = calls;
  });
  game.perfProbe = () => ({
    frameMs: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
    drawCalls: lastCalls,
  });
  return game.perfProbe;
}
