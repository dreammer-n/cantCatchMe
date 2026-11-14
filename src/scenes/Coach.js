import * as Phaser from 'phaser';
import { BLACKOUT, HELICOPTER, PALETTE, POLICE_HANDLING, POWERUP, SLICK, TUMBLE, TUTORIAL } from '../config/tuning.js';
import { degToRad, wrapAngle } from '../utils/math.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { difficultyAt, isOnScreen } from '../systems/SpawnSystem.js';
import { Tips } from '../systems/Tips.js';

const SIREN = [0xff3b30, 0x2f7bff];
// The lessons of the first drive, in order; each is saved once done, so one not reached carries over.
const LESSONS = ['crash', 'kaboom']; // the helicopter is taught by its hint (TUTORIAL.tips.helicopter)

// The first drive and the one-time hints, for GameScene. It watches the run and, the first time something
// happens, sends the UI a short hint ('tip': { head, body }) and lights the thing on the road with a soft pulse
// in the game's own colours (siren red and blue under a police car, amber under the die), never an arrow.
// One hint at a time; each is shown once ever (Tips).
// In the first drive it also runs the steering lesson, holds the police back until it is done, and then plays
// two lessons in which the game waits for the player and what happens follows from what they do, then YOU'RE ON
// YOUR OWN!:
//   crash    one police car closes in; the action holds on TURN SHARP! until the player turns; the police car
//            can't follow, spins out and wrecks.
//   kaboom   a die that always gives KABOOM; once it is caught three police close in from all sides; when they
//            are inside the blast the action holds on DOUBLE TAP!, and the tap blows them all away.
//   (chopper, a quiet helicopter and BLACKOUT, is still here but no longer in LESSONS.)
// While a lesson runs the police are the lesson's own (SpawnDirector.lesson), nothing else joins in, and the
// player can't be wrecked in its key moments. A prompt nobody answers acts for the player after a few seconds.
export class Coach {
  constructor(scene, layers) {
    this.scene = scene;
    this.glow = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.ring = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    layers.lights.add(this.glow);
    layers.lights.add(this.ring);
    this.touch = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    this.reset(false);
  }

  // firstDrive: a new player's first run (the steering lesson, police held back until it is done).
  // sim: the run, to hold back the die until its lesson.
  reset(firstDrive, sim = null) {
    this.firstDrive = firstDrive;
    this.freeRetries = firstDrive ? TUTORIAL.freeRetries : 0;
    this.steering = firstDrive; // the steering lesson is on
    this.steered = { left: false, right: false };
    this.steerTime = 0;
    this.queue = [];
    this.showing = 0; // seconds the hint on screen has left (plus the gap before the next)
    this.slow = 0;
    this.prompt = null; // { id, wait, age }: a prompt holding the action until the player acts
    this.hintAge = 0; // seconds the hint on screen has been up
    this.markRadius = TUTORIAL.markRadius;
    this.lessonPolice = null;
    this.target = null; // () => {x, y} or null: what the glow follows
    this.markTime = 0;
    this.markKind = null;
    this.hideMark();
    // The lessons still to do, if this player is new: the first drive, or a run soon after one.
    const lesson = LESSONS.find((id) => !Tips.has(`lesson-${id}`));
    this.lesson = (firstDrive || (Tips.has('steer') && Tips.wantsBasics())) && lesson ? lesson : null;
    this.stage = this.lesson ? 'start' : null;
    this.stageTime = 0;
    if (this.lesson && sim) {
      sim.powerUps.timer = Infinity; // the die comes when its lesson is due
      this.setPolice(sim, 0); // and the police when theirs is
    }
  }

  // How many police the lesson wants on the map (null: the usual police again).
  setPolice(sim, count, speedFactor = TUTORIAL.lessonPoliceSpeed, around = undefined) {
    const now = sim.spawner.lesson;
    if (count === null) sim.spawner.lesson = null;
    else if (!now || now.police !== count) {
      sim.spawner.lesson = { police: count, interval: 0.3, speedFactor, around, placed: 0 };
      if (Number.isFinite(sim.spawner.cooldown)) sim.spawner.cooldown = Math.min(sim.spawner.cooldown, 0.3);
    }
  }

  // Whether this crash is forgiven (an early one in the first drive); uses one up if so.
  takeFreeRetry(runSeconds) {
    if (this.scene.sim && this.stage === 'gather') {
      this.scene.sim.player.boost = 1;
      this.scene.sim.sturdyPolice = 1;
    }
    if (this.freeRetries <= 0 || runSeconds >= TUTORIAL.freeRetrySeconds) return false;
    this.freeRetries -= 1;
    this.queue.length = 0;
    if (this.prompt) {
      this.endPrompt();
      // The prompt comes again after the retry (for the items, the one held is still held).
      this.stage = this.lesson === 'crash' ? 'start' : 'holding';
      this.stageTime = 0;
    }
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

  // How much of its speed the action keeps this frame (slow motion for a lesson).
  get timeShare() {
    if (this.prompt) return this.prompt.id === 'turn' ? TUTORIAL.turnShare : TUTORIAL.tapShare;
    return this.slow > 0 ? TUTORIAL.slowShare : 1;
  }

  tip(id, target = null, markKind = null) {
    if (Tips.has(id) || this.queue.some((entry) => entry.id === id)) return;
    const tip = TUTORIAL.tips[id];
    if (!tip || (tip.basic && !Tips.wantsBasics())) return;
    Tips.mark(id); // seen as soon as it is due, so a crash a moment later doesn't bring it back next run
    this.queue.push({ id, target, markKind });
  }

  // Every frame of play. command: the player's steering this frame. dt: real seconds.
  update(dt, command, sim, view) {
    this.slow = Math.max(0, this.slow - dt);
    this.hintAge += dt;
    if (this.steering) this.updateSteering(dt, command, sim);
    else {
      this.watch(sim, view);
      if (this.lesson) this.updateLesson(dt, sim, view);
    }
    if (this.prompt) this.updatePrompt(dt, sim, command);
    else {
      this.showing -= dt;
      if (this.showing <= 0 && this.queue.length > 0) this.show(this.queue.shift());
    }
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
      PlatformManager.sendEvent('tutorial_step', { step: 'steer' });
      this.scene.game.events.emit('steer-hint', false);
      if (this.lesson === 'crash') this.setPolice(sim, 1);
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
    if (crate.active && isOnScreen(crate.x, crate.y, view, -40) && !Tips.has('die') && Tips.wantsBasics()) {
      this.slow = TUTORIAL.slowSeconds;
      const follow = () => (crate.active ? crate : null);
      if (this.lesson) this.urgent('die', follow, 'amber'); // now, while it is still coming
      else this.tip('die', follow, 'amber');
    }
  }

  // ---- The lessons ----

  nextLesson(sim) {
    sim.player.boost = 1; // the KABOOM lesson's easing off, if it was on
    sim.sturdyPolice = 1;
    if (this.lesson === 'chopper' && sim.helicopter.active && sim.helicopter.state === 'chasing') {
      // Still flying (out of reach, or the tap came too early): from now on it is a normal helicopter.
      sim.helicopter.nextDrop = HELICOPTER.firstDropAfter;
      sim.helicopter.stay = HELICOPTER.stayMin;
    }
    Tips.mark(`lesson-${this.lesson}`);
    PlatformManager.sendEvent('tutorial_step', { step: `${this.lesson}_done` });
    this.calmPolice(sim);
    this.lesson = LESSONS.find((id) => !Tips.has(`lesson-${id}`)) || null;
    this.stage = this.lesson ? 'start' : null;
    this.stageTime = 0;
    this.lessonPolice = null;
    if (this.lesson !== 'crash' && this.lesson !== 'kaboom') this.setPolice(sim, null); // the usual police again
    if (!this.lesson) {
      sim.powerUps.timer = POWERUP.interval; // the dice come as they normally do from now on
      this.tip('done'); // the lessons are over: the goal, in a line
    }
  }

  // A lesson's police come in fast (TUTORIAL.lessonPoliceSpeed, kaboomPoliceSpeed) so they arrive together; the ones
  // still chasing when it ends drop back to the speed police have at this point of a normal run.
  calmPolice(sim) {
    const speed = POLICE_HANDLING.topSpeed * difficultyAt(sim.stats.time, sim.pace).speedFactor;
    for (const police of sim.police) {
      if (police.active && police.alive && !police.parked && !police.armored) police.model.handling.topSpeed = Math.min(police.model.handling.topSpeed, speed);
    }
  }

  updateLesson(dt, sim, view) {
    this.stageTime += dt;
    const player = sim.player;
    if (this.lesson === 'crash') this.crashLesson(sim, view);
    else if (this.lesson === 'kaboom') this.kaboomLesson(sim);
    else if (this.lesson === 'chopper') {
      const heli = sim.helicopter;
      if (this.stage === 'start') {
        if (this.stageTime < TUTORIAL.chopperAfter) return;
        if (!heli.active) {
          heli.arrive(sim);
          this.scene.handleEvents(sim.events.splice(0)); // its arrival: the radio, and the CHOPPER! hint
        }
        // While it is the lesson, it only watches: nothing dropped, and it doesn't run out of fuel.
        heli.nextDrop = Infinity;
        heli.stay = Infinity;
        this.stage = 'waiting';
        this.stageTime = 0;
      } else if (this.stage === 'waiting') this.offerDie(sim, 'blackout', TUTORIAL.blackoutDieAfter);
      else if (this.stage === 'holding' && !sim.powerUps.held) this.nextLesson(sim);
      else if (this.stage === 'holding' && this.stageTime > TUTORIAL.readSeconds) {
        const reach = BLACKOUT.radius * HELICOPTER.blackoutReach * 0.85;
        const near = heli.active && Math.hypot(heli.x - player.x, heli.y - player.y) < reach;
        if (near || !heli.active || this.stageTime > TUTORIAL.kaboomWaitSeconds[2]) this.startPrompt('blackout', () => (heli.active ? heli : null), 'siren');
      }
    }
  }

  // One police car closes in; TURN SHARP! holds until the player turns; it can't follow, spins out and wrecks.
  crashLesson(sim, view) {
    const player = sim.player;
    if (this.stage === 'prompt') return;
    if (this.stage === 'start') {
      this.setPolice(sim, 1);
      if (this.stageTime > TUTORIAL.crashLessonSeconds) {
        this.nextLesson(sim);
        return;
      }
      // Once POLICE! has had a moment, and the car is close.
      const police = this.closestPolice(sim, view);
      const seen = Tips.has('police') && this.queue.length === 0 && (this.showing <= TUTORIAL.tipGap || this.hintAge > 1.2);
      if (seen && police && Math.hypot(police.model.x - player.x, police.model.y - player.y) < TUTORIAL.closeRange) {
        this.lessonPolice = police;
        this.startPrompt('turn', () => (police.alive ? police.model : null), 'siren');
        this.prompt.heading = player.heading;
      }
      return;
    }
    sim.safeTime = Math.max(sim.safeTime, 0.3); // the lesson's moment is the player's
    const police = this.lessonPolice;
    if (this.stage === 'turning') {
      const turned = Math.abs(wrapAngle(player.heading - this.turnFrom)) >= degToRad(TUTORIAL.turnDeg);
      if (!turned && !this.turnAuto && this.stageTime < TUTORIAL.turnSeconds) return;
      // It can't follow: it loses its grip and spins.
      if (police && police.alive) {
        police.spinOut(TUTORIAL.spinSeconds, wrapAngle(player.heading - this.turnFrom) > 0 ? -1 : 1, SLICK.spinRate, SLICK.grip);
        sim.emit('spinOut', { x: police.model.x, y: police.model.y });
        this.scene.handleEvents(sim.events.splice(0));
      }
      this.stage = 'spinning';
      this.stageTime = 0;
    } else if (this.stage === 'spinning' && this.stageTime >= TUTORIAL.spinSeconds) {
      // Spinning that fast it catches a wheel and flips over, end over end; it crashes as it comes down.
      if (police && police.alive) {
        police.spinOut(TUMBLE.flipSeconds + 0.2, 1, SLICK.spinRate, SLICK.grip);
        if (police.view) police.view.startFlip();
        this.stage = 'flipping';
        this.stageTime = 0;
      } else this.nextLesson(sim);
    } else if (this.stage === 'flipping' && this.stageTime >= TUMBLE.flipSeconds) {
      if (police && police.alive) {
        sim.wreckPolice(police, 'obstacle');
        this.scene.handleEvents(sim.events.splice(0)); // the wreck: NICE!, and on to the next lesson (onEvent)
      } else this.nextLesson(sim);
    }
  }

  // A die that gives KABOOM; once it is caught, three police close in from three sides (ahead left, ahead right,
  // behind), starting just out of sight; one that reaches the car keeps pace with it, boxing it in. DOUBLE TAP!
  // comes when all three are inside the blast. One that crashes on the way is replaced, so there are always three.
  kaboomLesson(sim) {
    const power = sim.powerUps;
    if (this.stage === 'start') {
      this.setPolice(sim, 0);
      this.offerDie(sim, 'shockwave', TUTORIAL.dieAfter);
    } else if (this.stage === 'holding') {
      if (!power.held) this.nextLesson(sim); // used before being asked
      else if (this.stageTime > TUTORIAL.readSeconds) {
        this.setPolice(sim, TUTORIAL.kaboomPolice, TUTORIAL.kaboomPoliceSpeed, TUTORIAL.kaboomAround.map(degToRad));
        this.stage = 'gather';
        this.stageTime = 0;
      }
    } else if (this.stage === 'gather') {
      if (!power.held) {
        sim.player.boost = 1;
        sim.sturdyPolice = 1;
        this.nextLesson(sim);
        return;
      }
      sim.player.boost = TUTORIAL.kaboomEase; // the car eases off, so they really close in
      sim.sturdyPolice = TUTORIAL.kaboomSturdy; // and they don't wreck on the way
      sim.safeTime = Math.max(sim.safeTime, 0.3); // they close in, but the moment is the player's
      const player = sim.player;
      const reach = POWERUP.pulseRadius * TUTORIAL.kaboomRange;
      const rush = POLICE_HANDLING.topSpeed * TUTORIAL.kaboomPoliceSpeed;
      const keepPace = Math.max(TUTORIAL.kaboomHoldMin, Math.hypot(player.vx, player.vy) * TUTORIAL.kaboomHoldShare);
      let close = 0;
      for (const police of sim.police) {
        if (!police.active || !police.alive || police.parked) continue;
        const near = Math.hypot(police.model.x - player.x, police.model.y - player.y) < reach;
        if (near) close += 1;
        // Rushing in from out of sight; once beside the car, only a little faster than it, so it stays there.
        police.model.handling.topSpeed = near ? keepPace : rush;
      }
      if (close >= TUTORIAL.kaboomPolice || this.stageTime > TUTORIAL.kaboomLastResort) {
        // The ring on the road is the blast: everything inside it goes.
        // The car stays eased off and they keep pace until the tap, so all three are still inside it then.
        sim.sturdyPolice = 1;
        this.startPrompt('kaboom', () => sim.player, 'amber', POWERUP.pulseRadius);
      }
    }
  }

  // The lesson's die, with its item chosen and waiting for the player.
  offerDie(sim, kind, after) {
    const power = sim.powerUps;
    if (power.held || power.crate.active) return; // one already in play: its turn first
    power.nextKind = kind;
    power.waitToFire = true;
    power.timer = after;
    this.stage = 'die';
    this.stageTime = 0;
  }

  closestPolice(sim, view) {
    let best = null;
    let bestDistance = Infinity;
    for (const police of sim.police) {
      if (!police.active || !police.alive || police.parked || !isOnScreen(police.model.x, police.model.y, view)) continue;
      const distance = Math.hypot(police.model.x - sim.player.x, police.model.y - sim.player.y);
      if (distance < bestDistance) {
        best = police;
        bestDistance = distance;
      }
    }
    return best;
  }

  // A hint shown now, ahead of any waiting.
  urgent(id, target, markKind) {
    const tip = TUTORIAL.tips[id];
    Tips.mark(id);
    this.queue = this.queue.filter((entry) => entry.id !== id);
    this.show({ id, target, markKind });
    return tip;
  }

  // TURN SHARP!, DOUBLE TAP! (PRESS SPACE! with keys): the action nearly stops until the player does it, or for a
  // few seconds. radius: of the ring on the road (the blast, for KABOOM).
  startPrompt(id, target, markKind, radius = TUTORIAL.markRadius) {
    const tip = TUTORIAL.tips[id];
    Tips.mark(id);
    PlatformManager.sendEvent('tutorial_step', { step: id });
    this.queue.length = 0;
    this.prompt = { id, wait: TUTORIAL.tapWaitSeconds, age: 0 };
    this.scene.game.events.emit('tip', {
      head: this.touch ? tip.head : tip.keysHead || tip.head,
      body: this.touch ? tip.body : tip.keysBody || tip.body,
      hold: true,
      sides: id === 'turn', // the two halves of the screen glow: hold one
    });
    this.target = target;
    this.markKind = markKind;
    this.markRadius = radius;
    this.markTime = 0;
    this.showing = Infinity;
    this.stage = 'prompt';
  }

  updatePrompt(dt, sim, command) {
    const power = sim.powerUps;
    this.prompt.wait -= dt;
    this.prompt.age += dt;
    sim.safeTime = Math.max(sim.safeTime, 0.3);
    if (this.prompt.id === 'turn') {
      // Held for a moment even if the wheel is already over, so the words are seen.
      const steering = command.steer !== 0 && this.prompt.age > 0.6;
      if (!steering && this.prompt.wait > 0) return;
      this.turnFrom = this.prompt.heading;
      this.turnAuto = !steering; // nobody turned: the police car spins out anyway
      this.endPrompt();
      this.stage = 'turning';
      this.stageTime = 0;
      return;
    }
    if (power.held) return; // it waits for the player's tap
    this.endPrompt();
    this.nextLesson(sim);
  }

  endPrompt() {
    if (!this.prompt) return;
    this.prompt = null;
    this.showing = TUTORIAL.tipGap;
    this.target = null;
    this.markRadius = TUTORIAL.markRadius;
    this.scene.game.events.emit('tip', null);
  }

  // The run's events (GameScene.handleEvents).
  onEvent(e) {
    if (this.steering) return;
    if (e.type === 'wreck' && this.lesson === 'crash') {
      // The player's turn did it: NICE!. One that wrecked itself before that doesn't count; another comes.
      if (this.stage === 'turning' || this.stage === 'spinning' || this.stage === 'flipping') {
        this.slow = TUTORIAL.slowSeconds;
        this.urgent('wreck');
        this.nextLesson(this.scene.sim);
      } else if (this.prompt && e.police === this.lessonPolice) {
        this.endPrompt();
        this.stage = 'start';
      }
    } else if (e.type === 'wreck' && Tips.has('police')) this.tip('wreck');
    else if (e.type === 'pickup') {
      if (this.lesson && this.stage === 'die') {
        this.stage = 'holding';
        this.stageTime = 0;
      } else if (!this.lesson) this.tip('use');
    } else if (e.type === 'flat') this.tip('flat');
    else if (e.type === 'helicopter') this.tip('helicopter');
    else if (e.type === 'airstrike') this.tip('jets');
  }

  show(entry) {
    const tip = TUTORIAL.tips[entry.id];
    if (tip.basic) PlatformManager.sendEvent('tutorial_step', { step: entry.id });
    this.scene.game.events.emit('tip', { head: this.touch ? tip.head : tip.keysHead || tip.head, body: this.touch ? tip.body : tip.keysBody || tip.body });
    this.showing = TUTORIAL.tipSeconds + TUTORIAL.tipGap;
    this.hintAge = 0;
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
    const r = this.markRadius * (1 + (this.markRadius > TUTORIAL.markRadius ? 0.04 : 0.18) * pulse);
    const tint = this.markKind === 'siren' ? SIREN[Math.floor(this.markTime * 4) % 2] : PALETTE.crateGlow;
    this.glow.setVisible(true).setPosition(point.x, point.y).setTint(tint).setScale((r * 1.6) / 32).setAlpha(0.55 * fade);
    this.ring.setVisible(true).setPosition(point.x, point.y).setTint(tint).setScale((r * 2) / 116).setAlpha((0.55 + 0.4 * pulse) * fade);
  }
}
