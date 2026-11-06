import * as Phaser from 'phaser';
import { DEBUG } from '../config/debug.js';
import {
  WORLD,
  LEADERBOARD,
  applyMapPalette,
  handlingFor,
  AUDIO,
  BEARCAT,
  BODY_LEAN,
  CAR_SIZE,
  CRASH,
  DEFAULT_HANDLING_PRESET,
  DEPTH,
  DEV_PANEL,
  DISPLAY,
  EFFECTS,
  EXPLOSION,
  FLAT_TIRE,
  FREEZE,
  HANDLING_PRESETS,
  HITSTOP,
  PALETTE,
  POWERUP,
  RENDER,
  REVIVE,
  HAPTICS,
  STREET_PROPS,
  BLACKOUT,
  PHANTOM,
  TRAUMA,
  TUMBLE,
  VIEW,
  VOID,
  WRECK,
} from '../config/tuning.js';
import { CarView, isSkidding, rearWheels } from '../entities/CarView.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { vibrate } from '../utils/haptics.js';
import { CameraRig } from '../render/CameraRig.js';
import { ensureCarAtlas, releaseCarSheets } from '../render/carAtlas.js';
import { BEARCAT_LIGHTS, carPaint, carShadowPoints } from '../render/carModels.js';
import { Effects } from '../render/Effects.js';
import { MapWeather, TUMBLEWEED_BITS } from '../render/MapWeather.js';
import { PowerFx } from '../render/PowerFx.js';
import { HelicopterView } from '../render/HelicopterView.js';
import { JetView } from '../render/JetView.js';
import { createLayers, depthAt } from '../render/layers.js';
import { bakeMesh, cssColor, releaseOtherViews } from '../render/lowpoly.js';
import { buildLayout } from '../systems/WorldLayout.js';
import { projection } from '../render/projection.js';
import { DIE_ROLLS, luckyDie } from '../render/propModels.js';
import { Scenery } from '../render/Scenery.js';
import { SirenBeams } from '../render/SirenBeams.js';
import { ChaseSimulation } from '../systems/ChaseSimulation.js';
import { HitStop } from '../systems/HitStop.js';
import { Records, Garage, coinsForRun, Maps } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { ThreatRadar } from '../systems/ThreatRadar.js';
import { SkidMarks } from '../systems/SkidMarks.js';
import { degToRad, wrapAngle } from '../utils/math.js';

const screenPoint = { x: 0, y: 0 };
const ATTRACT_HEADING = degToRad(150); // a flattering three-quarter view on the title screen
const WARM_UP_AFTER_FRAMES = 2; // the title is drawn first, then the warm-up starts
const WARM_UP_PROPS = 6; // prop drawings a frame

// The game world. All rules live in ChaseSimulation (pure logic); this scene draws the result,
// plays effects and sounds for the simulation's events, and runs the flow:
//   'attract' (title screen: the car waits, still, on the start ring)
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
    this.mapId = Maps.selected;
    this.showGroundColour();
    this.scenery = new Scenery(this, this.layers, Maps.current());
    this.carId = Garage.selected;
    this.sim = new ChaseSimulation({ layout: this.layout, handling: this.currentHandling() });
    this.sim.setCar(Garage.car());
    this.onHandlingChanged();

    // One shared drawing for every car's ground shadow (cleared each frame).
    this.carShadows = this.add.graphics();
    this.layers.shadows.add(this.carShadows);
    this.looks = this.makeLooks();
    this.playerView = new CarView(this, this.looks.player, this.carShadows, null, this.layers.shadows);
    // DECOY: a hologram of the player's car.
    this.decoyView = new CarView(this, this.looks.player, this.carShadows, null, this.layers.shadows);
    this.decoyView.hide();
    // Drawn as light: a glowing blue hologram over the road, not a second solid car.
    this.decoyView.sprite.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.decoy);
    if (this.decoyView.wheels) this.decoyView.wheels.setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.decoy);
    this.ghostShown = false;
    this.freeViews = [];
    this.skids = new SkidMarks(this, this.layers.ground);
    this.effects = new Effects(this, this.layers);
    this.effects.setGround(Maps.current());
    this.weather = new MapWeather(this, this.layers, this.effects);
    this.powerFx = new PowerFx(this, this.layers);
    this.createCrate();
    this.absorb = null; // the die sinking into the car after a pickup

    this.wheels = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    this.hitStop = new HitStop();
    this.pendingPower = false; // a power-up press during a hit-stop waits for the action to restart
    this.radar = new ThreatRadar();
    this.beams = new SirenBeams(this, this.layers.lights);
    this.helicopterView = new HelicopterView(this, this.layers);
    this.jetView = new JetView(this, this.layers);
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

    this.queueWarmUp();
    this.enterAttract();
    if (import.meta.env.MODE !== 'production' && DEBUG) import('../dev/debugHooks.js').then(({ installDebugHooks }) => installDebugHooks(this));
  }

  currentHandling() {
    return HANDLING_PRESETS[this.registry.get('handlingPreset')] || handlingFor(Garage.car()); // presets: debug toolbar only
  }

  onHandlingChanged() {
    this.sim.player.setHandling(this.currentHandling());
  }

  // Puts the car chosen in the garage on the road. Call before a reset, which applies its size and weight.
  useSelectedCar() {
    this.sim.setCar(Garage.car());
    this.onHandlingChanged();
    if (this.carId === Garage.selected) return;
    this.oldCarId = this.carId;
    this.carId = Garage.selected;
    this.looks.player = this.playerLook();
    this.looks.playerWreck = this.wreckLook(this.carId);
  }

  // Moves to the map chosen on the map screen. Everything on the map is drawn again in its colours: that
  // takes a moment, so it only happens when the map really changes, between runs.
  useSelectedMap() {
    const map = Maps.current();
    if (map.id === this.mapId) return;
    this.mapId = map.id;
    applyMapPalette(map);
    this.effects.setGround(map);
    this.showGroundColour();
    this.sim.chunks.setLayout(buildLayout(WORLD.seed, map));
    this.scenery.reload(map);
    this.bakeCrate();
    this.helicopterView.redraw();
    this.jetView.redraw();
  }

  // The garage shows its car on plain road of the map's colour.
  showGroundColour() {
    document.documentElement.style.setProperty('--ground', cssColor(PALETTE.uiGround));
  }

  // Back from the garage: the car on the title screen changes at once; after a run, it waits for the next one.
  onGarageClosed() {
    if (this.mode === 'attract') this.enterAttract();
  }

  playerLook() {
    const id = this.carId;
    return { atlasKey: ensureCarAtlas(this, `${id}Body`), wheelsKey: ensureCarAtlas(this, `${id}Wheels`), shadowPoints: carShadowPoints(id), lights: false };
  }

  // The same car, burnt out: the player's own, or whichever police car it was. Drawn the first time it is needed
  // (normally already done in the warm-up).
  wreckLook(name) {
    return this.lazyLook(`${name}Wreck`, { shadowPoints: carShadowPoints(name), lights: false, burnt: true });
  }

  // A look whose drawing sheet is only made when something first asks for it.
  lazyLook(atlasName, look) {
    const scene = this;
    return Object.defineProperty(look, 'atlasKey', { get: () => ensureCarAtlas(scene, atlasName), enumerable: true });
  }

  makeLooks() {
    const look = (name, lights, lightSpot) => this.lazyLook(name, { shadowPoints: carShadowPoints(name), lights, lightSpot });
    return {
      player: this.playerLook(),
      playerWreck: this.wreckLook(this.carId),
      police: look('police', true),
      interceptor: look('interceptor', true),
      bearcat: look('bearcat', true, BEARCAT_LIGHTS),
      policeWreck: this.wreckLook('police'),
      interceptorWreck: this.wreckLook('interceptor'),
      bearcatWreck: this.wreckLook('bearcat'),
    };
  }

  // ------------------------------------------------------------------------------------------
  // Flow
  // ------------------------------------------------------------------------------------------

  enterAttract() {
    this.useSelectedCar();
    this.useSelectedMap();
    this.sim.reset(1);
    this.sim.player.heading = ATTRACT_HEADING;
    this.mode = 'attract';
    this.turntable = false;
    this.resetVisuals();
    this.snapCamera();
    this.audio.quiet();
    this.audio.setMusic('menu');
  }

  // Everything the title screen doesn't show, queued to be drawn a piece a frame once the title is up, so the game
  // reaches its title as fast as it can and a run still never waits for a drawing.
  queueWarmUp() {
    const cars = ['police', 'interceptor', 'policeWreck', `${this.carId}Wreck`, 'bearcat', 'interceptorWreck', 'bearcatWreck'];
    this.warmUp = [
      ...cars.map((name) => () => ensureCarAtlas(this, name)),
      () => this.helicopterView.redraw(),
      () => this.jetView.redraw(),
    ];
    this.warmUpDelay = WARM_UP_AFTER_FRAMES;
  }

  // One piece of the warm-up a frame; props come several at a time, they are small.
  stepWarmUp() {
    if (this.warmUpDelay > 0) {
      this.warmUpDelay -= 1;
      return;
    }
    if (this.warmUp.length > 0) this.warmUp.shift()();
    else this.scenery.bakeSome(WARM_UP_PROPS);
  }

  finishWarmUp() {
    while (this.warmUp.length > 0) this.warmUp.shift()();
    while (this.scenery.bakeSome(64));
  }

  startRun(seed = (Math.random() * 2 ** 31) >>> 0) {
    this.finishWarmUp();
    this.useSelectedCar();
    this.useSelectedMap();
    this.sim.setPace({ hard: Settings.hardStart, policeScale: Maps.current().policeScale || 1 });
    this.sim.reset(seed);
    this.hitStop.reset();
    this.pendingPower = false;
    this.mode = 'playing';
    this.turntable = false;
    this.crashClock = 0;
    this.finished = false;
    this.resetVisuals();
    this.snapCamera();
    this.audio.setMusic('chase');
    PlatformManager.runStarted();
    this.game.events.emit('run-started');
    this.game.events.emit('shields', this.sim.player.armor, this.sim.maxArmor);
  }

  get running() {
    return this.mode === 'playing';
  }

  // One second chance a run, if the player can pay for it or there is an ad to watch.
  offerReviveOrFinish() {
    const adMode = PlatformManager.rewardedAdMode();
    const canPay = Garage.coins >= REVIVE.cost;
    if (this.sim.revived || (!canPay && adMode === 'none')) {
      this.finishRun();
      return;
    }
    this.mode = 'offer';
    this.audio.quiet();
    this.game.events.emit('revive-offer', { cost: REVIVE.cost, canPay, adMode, cause: this.sim.crash ? this.sim.crash.cause : 'police' });
  }

  // paid: the coins were spent (otherwise an ad was watched).
  acceptRevive(paid) {
    if (this.mode !== 'offer') return;
    if (paid && !Garage.spend(REVIVE.cost)) {
      this.finishRun();
      return;
    }
    if (!this.sim.revivePlayer()) {
      this.finishRun();
      return;
    }
    this.handleEvents(this.sim.events.splice(0));
  }

  declineRevive() {
    if (this.mode === 'offer') this.finishRun();
  }

  finishRun() {
    this.finished = true;
    this.mode = 'crashed';
    PlatformManager.runFailed();
    const summary = this.sim.stats.summary();
    const { best } = Records.submit(summary);
    const newBest = summary.time > Maps.bestTime(Maps.selected);
    const mapUnlocks = Maps.submit(summary.time);
    const nextMap = Maps.nextLocked();
    const coins = coinsForRun(summary, this.sim.pace.hard);
    if (this.sim.pace.hard) {
      const score = Records.submitHard(summary.time);
      if (score !== null) PlatformManager.submitScore(LEADERBOARD.id, score);
    }
    Garage.award(coins.total);
    PlatformManager.flush();
    this.audio.quiet();
    this.audio.setMusic(null); // no music on the results
    PlatformManager.showInterstitial(); // a natural pause: the platform decides whether an advert is due
    const data = { summary, best, newBest, coins, mapUnlocks, nextMap, doubled: false, cause: this.sim.crash ? this.sim.crash.cause : 'police' };
    this.game.events.emit('run-over', data);
    this.scene.launch('GameOverScene', data);
  }

  resetVisuals() {
    for (const police of this.sim.police) if (police.view) this.releaseView(police);
    for (const view of this.freeViews) view.hide();
    this.playerView.setLook(this.looks.player);
    this.playerView.setAlpha(1);
    this.ghostShown = false;
    this.decoyView.setLook(this.looks.player);
    this.decoyView.hide();
    if (this.oldCarId) {
      releaseCarSheets(this, this.oldCarId);
      this.oldCarId = null;
    }
    this.skids.clear();
    this.effects.clear();
    this.powerFx.clear();
    this.weather.reset(this.mode === 'playing' ? Maps.current() : null);
    this.smokeClock.clear();
    this.absorb = null;
    this.crateBody.setScale(this.crateBodyScale).setAlpha(1).setRotation(0);
    this.hideCrate();
    this.radar.clear();
    this.scenery.sync(this.sim.chunks, Infinity);
    this.cameras.main.resetFX();
  }

  // ------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------

  update(time, delta) {
    if (this.warmUp.length > 0 || this.scenery.toBake.length > 0) this.stepWarmUp();
    const frameMs = Math.min(delta, DISPLAY.maxFrameDeltaMs);
    const dt = frameMs / 1000;
    this.simTime += dt;
    const command = this.controls.getCommand();
    let gameDt = dt;
    const frozen = this.hitStop.update(frameMs);
    if (command.activatePowerUp) this.pendingPower = true;

    if (frozen) {
      gameDt = 0; // the action holds; camera shake and starbursts carry on
    } else if (this.mode === 'attract' || this.mode === 'offer') {
      // The car waits on the title screen, still; after a crash the world holds while the second chance is offered.
    } else if (this.turntable) {
      this.spinInPlace(command.steer, dt);
    } else {
      if (this.mode === 'crashed') {
        gameDt = dt * CRASH.slowMotion;
        this.crashClock += dt;
        if (!this.finished && this.crashClock >= CRASH.gameOverDelay) this.offerReviveOrFinish();
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
    this.updateTiresAndFires(gameDt * 1000);
    this.updateCrate(time, dt);
    this.scenery.syncCones(this.sim.cones);
    this.scenery.syncPillars(this.sim.powerUps.pillars);
    this.scenery.syncSpikes(this.sim.spikeStrips);
    this.helicopterView.update(this.sim.helicopter, time);
    this.jetView.update(this.sim.airstrike, time);
    this.effects.syncPatches(this.sim.powerUps.patches);
    this.drawPowerExtras(time, dt);
    if (this.sim.player.crushing) this.rig.trauma = Math.max(this.rig.trauma, TRAUMA.giantRumble);
    this.scenery.cull(this.view);
    this.effects.update(gameDt);
    this.weather.update(this.sim, gameDt, this.mode === 'playing' && !this.turntable);
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
          if (e.cause === 'void') this.intoHole(e.police.model);
          if (e.police.view && e.cause !== 'void') {
            e.police.view.setLook(this.wreckLookFor(e.police));
            e.police.view.startTumble();
          }
          break;
        case 'fall':
          this.intoHole(player);
          this.audio.play('bump', 0.6);
          this.rig.addTrauma(TRAUMA.fall);
          break;
        case 'explosion': {
          const distance = Math.hypot(e.x - player.x, e.y - player.y);
          this.effects.explosion(e.x, e.y, e.player, carPaint(e.player ? this.carId : this.modelOf(e.police)));
          if (!e.player && distance < HITSTOP.wreckRange) this.punch(HITSTOP.wreckMs);
          this.audio.play('carCrash', 1 - distance / AUDIO.explosionRange);
          if (!e.player && distance < EXPLOSION.shakeDistance) this.rig.addTrauma(TRAUMA.explosion * (1 - distance / EXPLOSION.shakeDistance));
          break;
        }
        case 'crash':
          this.mode = 'crashed';
          if (e.cause === 'void') {
            // Already out of sight: no wreck, no bang, and a shorter wait for the results.
            this.crashClock = CRASH.gameOverDelay - VOID.resultsDelay;
            this.effects.holeDust(e.x, e.y);
            this.rig.addTrauma(TRAUMA.fall);
          } else {
            this.playerView.setLook(this.looks.playerWreck);
            this.playerView.startTumble();
            this.hitStop.trigger(HITSTOP.crashMs);
            vibrate(HAPTICS.crash);
            this.audio.play('carCrash');
            this.rig.addTrauma(TRAUMA.crash);
          }
          this.controls.releaseHeld();
          this.game.events.emit('run-crashed', e.cause);
          break;
        case 'shield':
          this.toast(e.left > 0 ? `ARMOR HIT! ${e.left} LEFT` : 'LAST SHIELD GONE!', 'combo');
          this.effects.impact(e.x, e.y, EFFECTS.burstScrape);
          this.rig.addTrauma(TRAUMA.flat);
          this.punch(HITSTOP.bumpMs);
          this.audio.play('bump');
          vibrate(HAPTICS.shield);
          this.game.events.emit('shields', e.left, this.sim.maxArmor);
          break;
        case 'airstrike':
          this.toast('AIRSTRIKE!', 'near');
          break;
        case 'bomb': {
          const distance = Math.hypot(e.x - player.x, e.y - player.y);
          this.effects.explosion(e.x, e.y, true, PALETTE.bomb);
          this.audio.play('carCrash', 1 - distance / AUDIO.explosionRange);
          if (distance < EXPLOSION.shakeDistance) this.rig.addTrauma(TRAUMA.explosion * (1 - distance / EXPLOSION.shakeDistance));
          break;
        }
        case 'decoyGone':
          this.effects.softPop(e.x, e.y);
          break;
        case 'spinOut':
          this.effects.smokePuff(e.x, e.y, 6);
          break;
        case 'revive':
          this.mode = 'playing';
          this.crashClock = 0;
          this.hitStop.reset();
          this.playerView.setLook(this.looks.player);
          this.effects.shockwave(e.x, e.y, e.radius, REVIVE.ringSeconds);
          this.audio.play('shockwave');
          this.audio.setMusic('chase');
          this.game.events.emit('run-resumed');
          this.game.events.emit('shields', this.sim.player.armor, this.sim.maxArmor);
          break;
        case 'despawn':
        case 'wreckGone':
          if (e.police.view) this.releaseView(e.police);
          break;
        case 'combo':
          this.toast(comboText(e.count), 'combo');
          this.punch(HITSTOP.comboMs);
          break;
        case 'nearMiss':
          this.toast('CLOSE CALL!', 'near');
          this.rig.addTrauma(TRAUMA.nearMiss);
          break;
        case 'flat':
          this.toast('FLAT TIRE!', 'combo');
          this.effects.impact(e.x, e.y, EFFECTS.burstScrape);
          this.rig.addTrauma(TRAUMA.flat);
          this.punch(HITSTOP.bumpMs);
          this.audio.play('bump', 0.7);
          break;
        case 'helicopter':
          this.toast('POLICE CHOPPER!', 'near');
          this.audio.play('police_radio');
          break;
        case 'dropLand': {
          const distance = Math.hypot(e.x - player.x, e.y - player.y);
          this.effects.pillarDust(e.x, e.y);
          this.effects.groundRing(e.x, e.y, EFFECTS.ringRadius);
          this.audio.play('bump', 1 - distance / AUDIO.explosionRange);
          if (distance < EXPLOSION.shakeDistance) this.rig.addTrauma(TRAUMA.dropLand * (1 - distance / EXPLOSION.shakeDistance));
          break;
        }
        case 'pickup':
          this.startAbsorb(e);
          this.game.events.emit('power-ready', POWERUP.names[e.kind]);
          break;
        case 'power':
          this.onPowerUsed(e);
          break;
        case 'shatter':
          this.effects.shatter(e.x, e.y, carPaint(this.modelOf(e.police)));
          this.toast('SMASHED!', 'combo');
          this.rig.addTrauma(TRAUMA.shatter);
          this.punch(HITSTOP.smashMs);
          this.audio.play('freeze_shatter');
          break;
        case 'crush':
          this.rig.addTrauma(TRAUMA.crush);
          this.punch(HITSTOP.crushMs);
          break;
        case 'ignite':
          this.effects.ignite(e.x, e.y);
          this.rig.addTrauma(TRAUMA.ignite);
          this.audio.play('cone', 0.6);
          break;
        case 'pillarCrumble':
          this.effects.pillarDust(e.x, e.y);
          break;
        case 'pulse':
          this.effects.kaboom(e.x, e.y, e.radius, POWERUP.pulseSeconds);
          this.rig.addTrauma(TRAUMA.pulse);
          break;
        case 'bump':
          if (e.player) this.playerView.bump(e.impact);
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
        case 'wreckKnock':
          this.audio.play('bump', 0.7);
          this.effects.impact(e.x, e.y, EFFECTS.burstSmash);
          this.playerView.bump(120);
          this.rig.addTrauma(TRAUMA.knock);
          break;
        case 'curb':
          this.playerView.bump(BODY_LEAN.hopFullImpact * 0.45);
          this.audio.play('bump', 0.3);
          this.rig.addTrauma(TRAUMA.curb);
          break;
        case 'cone':
          if (e.cone.item.kind === 'civilian' || e.cone.wasSolid) this.onParkedCarHit(e);
          else {
            this.audio.play(['bush', 'snowman', 'tumbleweed'].includes(e.cone.item.kind) ? 'bump' : 'cone', 0.8);
            if (e.player) this.rig.addTrauma(TRAUMA.knock);
            this.onStreetPieceHit(e.cone.item.kind, e.x, e.y);
          }
          break;
        case 'jump':
          this.audio.play('bump', 0.4);
          break;
        case 'land':
          this.effects.landing(e.x, e.y);
          this.playerView.bump(180);
          this.audio.play('bump', 0.7);
          this.rig.addTrauma(TRAUMA.knock);
          break;
        default:
          break;
      }
    }
  }

  // A car going over the edge: into a river it splashes; into a hole the road crumbles behind it.
  intoHole(car) {
    if (car.fallShape && car.fallShape.item.water) this.effects.splash(car.x, car.y);
    else this.crumbleBehind(car);
  }

  // A car going over the edge of a hole: the road crumbles, and dust is left at the edge behind it.
  crumbleBehind(car) {
    const speed = Math.max(1, car.speed);
    const back = CAR_SIZE.length * 0.6;
    this.effects.holeCrumble(car.x, car.y, car.x - (car.vx / speed) * back, car.y - (car.vy / speed) * back);
  }

  onParkedCarHit(e) {
    this.audio.play('bump', e.player ? 0.8 : 0.4);
    this.effects.impact(e.x, e.y, EFFECTS.burstSmash);
    if (!e.player) return;
    this.rig.addTrauma(TRAUMA.smash);
    // A Giant car goes through everything: stopping for each thing would turn it into a stutter.
    if (!this.sim.player.crushing) this.punch(HITSTOP.smashMs);
  }

  onPowerUsed(e) {
    if (e.kind !== 'shockwave') this.toast(`${POWERUP.names[e.kind]}!`, 'power');
    for (const sound of POWERUP.sounds[e.kind]) this.audio.play(sound);
    if (e.kind === 'giant') {
      this.effects.titanStomp(e.x, e.y);
      this.rig.addTrauma(TRAUMA.giant);
    } else if (e.kind === 'freeze') {
      this.effects.freezeBlast(e.x, e.y);
      this.effects.iceField(e.x, e.y, FREEZE.radius, FREEZE.seconds);
      this.rig.addTrauma(TRAUMA.freeze);
    } else if (e.kind === 'pillars') {
      for (const pillar of this.sim.powerUps.pillars) {
        if (pillar.active && pillar.state === 'up' && pillar.time === 0) this.effects.pillarBurst(pillar.x, pillar.y);
      }
      this.rig.addTrauma(TRAUMA.pillars);
    } else if (e.kind === 'turbo') {
      this.effects.softPop(e.x, e.y, 0x4fb4ff);
      this.rig.addTrauma(TRAUMA.pulse * 0.6);
    } else if (e.kind === 'decoy' || e.kind === 'phantom') {
      this.effects.softPop(e.x, e.y);
    } else if (e.kind === 'blackout') {
      this.effects.empBlast(e.x, e.y, BLACKOUT.radius);
      this.rig.addTrauma(TRAUMA.pulse);
    }
  }

  // Suburbs street furniture knocked flying: the hydrant bursts, the rest scatter bits.
  onStreetPieceHit(kind, x, y) {
    if (kind === 'hydrant') this.effects.hydrantBurst(x, y, STREET_PROPS.sprayFor);
    else if (kind === 'bush') this.effects.bitsBurst(x, y, [PALETTE.hedge, 0x6fb046, 0x3d7429], 12);
    else if (kind === 'trashcan') this.effects.bitsBurst(x, y, [0xe8e4da, 0xb8b2a6, PALETTE.trashcan], 10);
    else if (kind === 'mailbox') this.effects.bitsBurst(x, y, [0xffffff, 0xf2eee4], 8);
    else if (kind === 'fence') this.effects.bitsBurst(x, y, [PALETTE.fence], 8);
    else if (kind === 'snowman') {
      this.effects.bitsBurst(x, y, [PALETTE.snow, 0xdde7f0, PALETTE.carrot], 14);
      this.effects.dustRing(x, y, 22, 6);
    } else if (kind === 'tumbleweed') this.effects.bitsBurst(x, y, TUMBLEWEED_BITS, 14);
    else if (kind === 'barrel') this.effects.bitsBurst(x, y, [PALETTE.barrel, PALETTE.barrelBand], 8);
  }

  // Every frame: SCORCHER's fire, TURBO's afterburner and SLICK's oil (PowerFx), PHANTOM's see-through car,
  // BLACKOUT's sparks on dead police, and the DECOY's hologram.
  drawPowerExtras(time, dt) {
    const player = this.sim.player;
    const live = this.mode === 'playing';
    this.powerFx.update(this.sim, time, dt, live);
    if (player.ghost) {
      this.ghostShown = true;
      this.playerView.setAlpha(PHANTOM.alpha + 0.12 * Math.sin(time / 70));
    } else if (this.ghostShown) {
      this.ghostShown = false;
      this.playerView.setAlpha(1);
    }
    for (const police of this.sim.police) {
      if (!police.view) continue;
      const dark = police.alive && police.stalled > 0;
      police.view.setDark(dark);
      if (dark && police.view.sprite.visible && Math.random() < 0.18) this.effects.sparksAt(police.model.x, police.model.y, 2);
    }
    const decoy = this.sim.decoy;
    if (decoy.active) {
      this.decoyView.update(decoy.car, this.view, time, dt);
      this.decoyView.setAlpha(0.75 + 0.2 * Math.sin(time / 45));
    } else if (this.decoyView.sprite.visible) {
      this.decoyView.hide();
    }
  }

  // Debug toolbar: brings on one of the tactical units at once.
  summon(kind) {
    if (this.mode !== 'playing') return;
    const { sim, simView } = this;
    if (kind === 'helicopter') {
      if (!sim.helicopter.active) sim.helicopter.arrive(sim);
      sim.helicopter.nextDrop = 0.5;
    } else if (kind === 'roadblock') {
      sim.spawner.tryRoadblock(sim, simView);
    } else if (kind === 'bearcat') {
      const p = sim.player;
      const speed = Math.max(1, p.speed);
      sim.spawnPolice(p.x + (p.vx / speed) * 800, p.y + (p.vy / speed) * 800, Math.atan2(-p.vx, p.vy), {
        role: 'bearcat',
        speedFactor: BEARCAT.speedShare * 1.05,
        turnDeg: BEARCAT.turnDeg,
        aimSide: 0,
        launchShare: 1,
      });
    }
    // Sound, toasts and drawings for whatever just appeared; the next step clears the list.
    this.handleEvents(sim.events.splice(0));
  }

  // Debug toolbar: puts an item straight into the player's hands.
  givePower(kind) {
    if (this.mode !== 'playing') return;
    this.sim.powerUps.give(kind);
    this.game.events.emit('power-ready', POWERUP.names[kind]);
  }

  modelOf(police) {
    if (police.armored) return 'bearcat';
    return police.role === 'interceptor' ? 'interceptor' : 'police';
  }

  lookFor(police) {
    return this.looks[this.modelOf(police)];
  }

  wreckLookFor(police) {
    return this.looks[`${this.modelOf(police)}Wreck`];
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
      police.view.setFrozen(police.alive && police.frozen > 0);
      if (police.state === 'wreck') {
        const left = WRECK.lifetime - police.wreckTime;
        police.view.setAlpha(left < WRECK.fadeSeconds ? Math.max(0, left / WRECK.fadeSeconds) : 1);
      }
      police.view.update(police.model, this.view, time, gameDt);
    }
  }

  // Skid marks and tire smoke for every sliding car on screen; smoke and flames from wrecks.
  updateTiresAndFires(ms) {
    const driving = this.mode !== 'attract' && !this.turntable;
    if (driving && this.mode === 'playing') {
      this.tires(0, this.sim.player, ms);
      this.flatTireSmoke(this.sim.player, ms);
    } else {
      this.skids.addPoint(0, 0, 0, false);
      this.skids.addPoint(1, 0, 0, false);
    }
    for (const police of this.sim.police) {
      if (!police.view) continue;
      const onScreen = police.view.sprite.visible;
      if (police.alive && onScreen) {
        this.tires((police.id + 1) * 2, police.model, ms);
        if (police.burning > 0) this.burn(police.id, police.model, 0, ms, true);
      }
      else if (police.state === 'wreck' && onScreen && !police.model.isFalling) this.burn(police.id, police.model, police.wreckTime, ms);
    }
    if (this.sim.state === 'crashed' && !this.sim.player.isFalling) this.burn(-1, this.sim.player, this.crashClock * 2, ms);
    this.skids.update(ms);
  }

  // The flat corner throws out smoke and sparks whatever the car is doing.
  flatTireSmoke(model, ms) {
    if (model.flatTime <= 0) return;
    const clock = (this.smokeClock.get('flat') || 0) + ms;
    if (clock < FLAT_TIRE.smokeEveryMs) {
      this.smokeClock.set('flat', clock);
      return;
    }
    this.smokeClock.set('flat', 0);
    rearWheels(model, this.wheels);
    const wheel = this.wheels[model.flatSide < 0 ? 0 : 1];
    this.effects.smokePuff(wheel.x, wheel.y);
    if (model.flatness > 0.5) this.effects.rimSparks(wheel.x, wheel.y);
  }

  tires(track, model, ms) {
    const skidding = isSkidding(model);
    rearWheels(model, this.wheels);
    const flat = model.flatness > 0;
    this.skids.addPoint(track, this.wheels[0].x, this.wheels[0].y, skidding || (flat && model.flatSide < 0));
    this.skids.addPoint(track + 1, this.wheels[1].x, this.wheels[1].y, skidding || (flat && model.flatSide > 0));
    if (!skidding) return;
    const clock = (this.smokeClock.get(track) || 0) + ms;
    if (clock >= EFFECTS.smokeEveryMs) {
      this.effects.tireDust(this.wheels[0].x, this.wheels[0].y);
      this.effects.tireDust(this.wheels[1].x, this.wheels[1].y);
      this.smokeClock.set(track, 0);
    } else {
      this.smokeClock.set(track, clock);
    }
  }

  // onFire: a police car still driving while it burns (SCORCHER), whose flames PowerFx draws.
  burn(id, model, age, ms, onFire = false) {
    if (age > WRECK.lifetime - WRECK.fadeSeconds) return;
    const key = `w${id}`;
    const clock = (this.smokeClock.get(key) || 0) + ms;
    if (clock < EFFECTS.wreckSmokeEveryMs) {
      this.smokeClock.set(key, clock);
      return;
    }
    this.smokeClock.set(key, 0);
    this.effects.smokePuff(model.x, model.y, 22, true);
    if (age < 3.5 && !onFire) this.effects.flame(model.x, model.y);
  }

  // ------------------------------------------------------------------------------------------
  // The lucky die
  // ------------------------------------------------------------------------------------------

  createCrate() {
    this.dieDrawings = [];
    this.dieRoll = -1;
    this.crateGlow = this.add.image(0, 0, 'fx-glow').setTint(PALETTE.crateGlow).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.shadows + 1);
    this.crateShadow = this.add.image(0, 0, '__DEFAULT').setAlpha(RENDER.shadowAlpha).setDepth(DEPTH.shadows);
    this.crateBody = this.add.image(0, 0, '__DEFAULT');
    this.bakeCrate();
    this.hideCrate();
  }

  bakeCrate() {
    this.dieDrawings = DIE_ROLLS.map((_, roll) => bakeMesh(this, `prop:die:${roll}:${projection.key}`, luckyDie(roll), 0, projection, 'body'));
    const shadow = bakeMesh(this, `prop:die:${projection.key}:shadow`, luckyDie(0), 0, projection, 'shadow');
    this.crateBodyScale = 1 / this.dieDrawings[0].scale;
    this.crateShadowScale = 1 / shadow.scale;
    this.showDieRoll(0);
    this.crateBody.setScale(this.crateBodyScale);
    this.crateShadow.setTexture(shadow.key).setOrigin(shadow.originX, shadow.originY).setScale(this.crateShadowScale);
  }

  showDieRoll(roll) {
    if (roll === this.dieRoll) return;
    this.dieRoll = roll;
    const drawing = this.dieDrawings[roll];
    this.crateBody.setTexture(drawing.key).setOrigin(drawing.originX, drawing.originY);
  }

  hideCrate() {
    for (const image of [this.crateGlow, this.crateShadow, this.crateBody]) image.setVisible(false);
  }

  // It catches the car: from here it is only a drawing, closing in on the car and sinking into it.
  startAbsorb(e) {
    const player = this.sim.player;
    projection.toScreen(e.x, e.y, 0, screenPoint);
    const x = screenPoint.x;
    const y = screenPoint.y;
    projection.toScreen(player.x, player.y, 0, screenPoint);
    this.absorb = { t: 0, offsetX: x - screenPoint.x, offsetY: y - screenPoint.y };
  }

  updateAbsorb(dt) {
    const absorb = this.absorb;
    absorb.t += dt / POWERUP.absorbSeconds;
    if (absorb.t >= 1 || this.mode !== 'playing') {
      this.absorb = null;
      this.crateBody.setScale(this.crateBodyScale).setAlpha(1).setRotation(0);
      this.hideCrate();
      return;
    }
    const player = this.sim.player;
    const left = (1 - absorb.t) * (1 - absorb.t);
    projection.toScreen(player.x, player.y, 0, screenPoint);
    this.crateShadow.setVisible(false);
    this.crateGlow.setVisible(false);
    this.crateBody
      .setVisible(true)
      .setPosition(screenPoint.x + absorb.offsetX * left, screenPoint.y + absorb.offsetY * left - 14 * projection.lift)
      .setScale(this.crateBodyScale * (0.2 + 0.8 * left))
      .setAlpha(0.35 + 0.65 * left)
      .setRotation(0)
      .setDepth(depthAt(player.x, player.y) + 1);
  }

  updateCrate(time, dt) {
    const crate = this.sim.powerUps.crate;
    if (this.absorb) {
      this.updateAbsorb(dt);
      return;
    }
    if (!crate.active || this.mode === 'attract') {
      this.hideCrate();
      return;
    }
    projection.toScreen(crate.x, crate.y, 0, screenPoint);
    // It bounces after the car: high arcs, squashing as it lands and stretching as it leaves the road,
    // showing a new face each bounce.
    const beat = time / POWERUP.hopMs;
    const t = beat - Math.floor(beat);
    const air = 4 * t * (1 - t); // 0 on the road, 1 at the top
    const landing = Math.max(0, 1 - air * 3.5);
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    this.showDieRoll(Math.floor(beat) % DIE_ROLLS.length);
    this.crateGlow.setVisible(true).setPosition(screenPoint.x, screenPoint.y).setScale(2.2 + pulse * 0.5, (2.2 + pulse * 0.5) * projection.squash).setAlpha(0.45 + pulse * 0.25);
    this.crateShadow.setVisible(true).setPosition(screenPoint.x, screenPoint.y).setScale(this.crateShadowScale * (1 - 0.35 * air));
    this.crateBody
      .setVisible(true)
      .setPosition(screenPoint.x, screenPoint.y - air * POWERUP.hopHeight * projection.lift)
      .setScale(this.crateBodyScale * (1 + 0.2 * landing), this.crateBodyScale * (1 - 0.28 * landing + 0.08 * air))
      .setRotation(Math.sin(t * Math.PI * 2) * 0.16)
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
    this.playerView.setLook(this.sim.state === 'crashed' ? this.looks.playerWreck : this.looks.player);
    for (const police of this.sim.police) {
      if (police.view) police.view.setLook(police.alive ? this.lookFor(police) : this.wreckLookFor(police));
    }
    this.bakeCrate();
    this.helicopterView.redraw();
    this.jetView.redraw();
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
      speed: player.speed / player.handling.topSpeed,
      slip: Math.abs(player.lateralSpeed),
      sirenDistance: this.mode === 'playing' ? nearest : Infinity,
      helicopter: this.mode === 'playing' && this.sim.helicopter.active,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Debug turntable: the car turns on the spot.
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
      carScale: car.scale,
      held: this.sim.powerUps.kind,
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

}

function comboText(count) {
  if (count === 2) return 'DOUBLE WRECK!';
  if (count === 3) return 'TRIPLE WRECK!';
  return `${count}× PILE-UP!`;
}
