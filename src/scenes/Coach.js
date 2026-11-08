import * as Phaser from 'phaser';
import { PALETTE, TUTORIAL } from '../config/tuning.js';
import { isOnScreen } from '../systems/SpawnSystem.js';
import { Tips } from '../systems/Tips.js';

const SIREN = [0xff3b30, 0x2f7bff];

// The first drive and the one-time hints, for GameScene. It watches the run and, the first time something
// happens, sends the UI a short hint ('tip': { head, body }) and lights the thing on the road with a soft pulse
// in the game's own colours (siren red and blue under a police car, amber under the die), never an arrow.
// One hint at a time; each is shown once ever (Tips). In the first drive it also runs the steering lesson
// and holds the police back until it is done.
export class Coach {
  constructor(scene, layers) {
    this.scene = scene;
    this.glow = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.ring = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    layers.lights.add(this.glow);
    layers.lights.add(this.ring);
    this.reset(false);
  }

  // firstDrive: a new player's first run (the steering lesson, police held back until it is done).
  reset(firstDrive) {
    this.firstDrive = firstDrive;
    this.freeRetries = firstDrive ? TUTORIAL.freeRetries : 0;
    this.steering = firstDrive; // the steering lesson is on
    this.steered = { left: false, right: false };
    this.steerTime = 0;
    this.queue = [];
    this.showing = 0; // seconds the hint on screen has left (plus the gap before the next)
    this.slow = 0;
    this.target = null; // () => {x, y} or null: what the glow follows
    this.markTime = 0;
    this.markKind = null;
    this.hideMark();
  }

  // Whether this crash is forgiven (an early one in the first drive); uses one up if so.
  takeFreeRetry(runSeconds) {
    if (this.freeRetries <= 0 || runSeconds >= TUTORIAL.freeRetrySeconds) return false;
    this.freeRetries -= 1;
    this.queue.length = 0;
    this.showing = 0;
    this.target = null;
    this.hideMark();
    this.scene.game.events.emit('tip', { head: 'OOPS!', body: 'TRY AGAIN' });
    this.showing = TUTORIAL.tipSeconds + TUTORIAL.tipGap;
    return true;
  }

  // The line on the results about why a new player crashed, once per kind of crash; null if none is due.
  crashTip(cause) {
    const text = TUTORIAL.crashTips[cause];
    const id = `crash-${cause === 'wreck' ? 'obstacle' : cause}`;
    if (!text || !Tips.wantsBasics() || Tips.has(id)) return null;
    Tips.mark(id);
    return text;
  }

  hideMark() {
    this.glow.setVisible(false);
    this.ring.setVisible(false);
  }

  // How much of its speed the action keeps this frame (the slow moment when the first police car shows).
  get timeShare() {
    return this.slow > 0 ? TUTORIAL.slowShare : 1;
  }

  tip(id, target = null, markKind = null) {
    if (Tips.has(id) || this.queue.some((entry) => entry.id === id)) return;
    const tip = TUTORIAL.tips[id];
    if (!tip || (tip.basic && !Tips.wantsBasics())) return;
    Tips.mark(id); // seen as soon as it is due, so a crash a moment later doesn't bring it back next run
    this.queue.push({ id, target, markKind });
  }

  // Every frame of play. command: the player's steering this frame.
  update(dt, command, sim, view) {
    this.slow = Math.max(0, this.slow - dt);
    if (this.steering) this.updateSteering(dt, command, sim);
    else this.watch(sim, view);
    this.showing -= dt;
    if (this.showing <= 0 && this.queue.length > 0) this.show(this.queue.shift());
    this.drawMark(dt);
  }

  // The lesson ends once the car has been steered both ways, or after a while; then the police may come.
  updateSteering(dt, command, sim) {
    this.steerTime += dt;
    if (command.steer < 0) this.steered.left = true;
    if (command.steer > 0) this.steered.right = true;
    if ((this.steered.left && this.steered.right) || this.steerTime >= TUTORIAL.steerSeconds) {
      this.steering = false;
      Tips.mark('steer');
      this.scene.game.events.emit('steer-hint', false);
      sim.spawner.cooldown = TUTORIAL.policeAfter;
    }
  }

  // Things that are worth a hint the first time they come on screen.
  watch(sim, view) {
    for (const police of sim.police) {
      if (!police.active || !police.alive || !isOnScreen(police.model.x, police.model.y, view, -40)) continue;
      const follow = () => police.model;
      if (police.role === 'bearcat') this.tip('bearcat', follow, 'siren');
      else if (police.role === 'roadblock') this.tip('roadblock', follow, 'siren');
      else if (!Tips.has('police') && Tips.wantsBasics()) {
        this.slow = TUTORIAL.slowSeconds; // a moment to see it
        this.tip('police', follow, 'siren');
      }
    }
    const crate = sim.powerUps.crate;
    if (crate.active && isOnScreen(crate.x, crate.y, view, -40)) this.tip('die', () => (crate.active ? crate : null), 'amber');
  }

  // The run's events (GameScene.handleEvents).
  onEvent(e) {
    if (this.steering) return;
    if (e.type === 'wreck' && Tips.has('police')) this.tip('wreck');
    else if (e.type === 'pickup') this.tip('use');
    else if (e.type === 'flat') this.tip('flat');
    else if (e.type === 'helicopter') this.tip('helicopter');
    else if (e.type === 'airstrike') this.tip('jets');
  }

  show(entry) {
    const tip = TUTORIAL.tips[entry.id];
    this.scene.game.events.emit('tip', { head: tip.head, body: tip.body });
    this.showing = TUTORIAL.tipSeconds + TUTORIAL.tipGap;
    this.target = entry.target;
    this.markKind = entry.markKind;
    this.markTime = 0;
  }

  // A soft light pulsing on the road under what the hint is about, fading out with the hint.
  drawMark(dt) {
    if (!this.target || this.showing <= TUTORIAL.tipGap) {
      this.target = null;
      this.hideMark();
      return;
    }
    const point = this.target();
    if (!point) {
      this.hideMark();
      return;
    }
    this.markTime += dt;
    const left = this.showing - TUTORIAL.tipGap;
    const fade = Math.min(1, left / 0.5, this.markTime / 0.25);
    const pulse = 0.5 + 0.5 * Math.sin(this.markTime * 9);
    const r = TUTORIAL.markRadius * (1 + 0.18 * pulse);
    const tint = this.markKind === 'siren' ? SIREN[Math.floor(this.markTime * 4) % 2] : PALETTE.crateGlow;
    this.glow.setVisible(true).setPosition(point.x, point.y).setTint(tint).setScale((r * 1.6) / 32).setAlpha(0.55 * fade);
    this.ring.setVisible(true).setPosition(point.x, point.y).setTint(tint).setScale((r * 2) / 116).setAlpha((0.55 + 0.4 * pulse) * fade);
  }
}
