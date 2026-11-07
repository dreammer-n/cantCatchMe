import { BLACKOUT, DECOY, FLAMER, FREEZE, GIANT, PHANTOM, PILLARS, POWERUP, SLICK, TURBO, HELICOPTER } from '../config/tuning.js';
import { degToRad, headingOf, lerp } from '../utils/math.js';
import { CAR_REACH } from './CollisionSystem.js';

// The lucky die and what it gives. States:
//   no die -> a die chasing the player from the moment it appears -> an item is held (at most one, and
//   it fires by itself after a few seconds) -> used -> no die ...
// A new die only appears while the player isn't holding an item, ahead of the player. The bouncing is
// only drawn (GameScene.updateCrate); here it just follows the car.
// Effects that outlast the moment of use (Giant, Flamer, the pillars, Turbo, the oil, the decoy, the ghost) run in
// tick(). effect: the item now working and how long it has left, for the timer ring on screen.
export class PowerUps {
  constructor() {
    this.pillars = Array.from({ length: PILLARS.pool }, () => ({ active: false, state: 'idle', x: 0, y: 0, time: 0, shape: null }));
    this.patches = Array.from({ length: FLAMER.maxPatches }, () => ({ active: false, x: 0, y: 0, age: 0 }));
    this.puddles = Array.from({ length: SLICK.maxPuddles }, () => ({ active: false, x: 0, y: 0, age: 0, group: 0 }));
    this.slickGroup = 0; // which spill a puddle belongs to (the drawing makes one pool of each)
  }

  reset(sim) {
    this.crate = { active: false, x: 0, y: 0, age: 0 };
    this.held = false;
    this.kind = null;
    this.lastKind = null;
    this.heldTime = 0;
    this.timer = POWERUP.firstAt;
    this.giantTime = 0;
    this.flamerTime = 0;
    this.flamerGap = 0;
    this.nextPatch = 0;
    this.turboTime = 0;
    this.slickLeft = 0;
    this.slickGap = 0;
    this.nextPuddle = 0;
    this.decoyTime = 0;
    this.phantomTime = 0;
    this.effect = null;
    for (const pillar of this.pillars) this.clearPillar(sim, pillar);
    for (const patch of this.patches) patch.active = false;
    for (const puddle of this.puddles) puddle.active = false;
    sim.decoy.active = false;
    sim.player.boost = 1;
    sim.player.boostAccel = 1;
    sim.player.ghost = false;
  }

  // Puts an item straight into the player's hands.
  give(kind) {
    this.held = true;
    this.kind = kind;
    this.lastKind = kind;
    this.heldTime = 0;
  }

  // The name and countdown for the on-screen button, or null when nothing is held.
  update(sim, dt) {
    const crate = this.crate;
    const player = sim.player;
    if (crate.active) {
      crate.age += dt;
      const distance = Math.hypot(crate.x - player.x, crate.y - player.y);
      if (distance < POWERUP.collectRadius * player.scale) {
        crate.active = false;
        this.give(this.pickKind(sim.rng));
        sim.emit('pickup', { x: crate.x, y: crate.y, kind: this.kind });
      } else {
        // It follows the car's tail until it catches up.
        const step = Math.min(distance, (player.speed + POWERUP.homingSpeed) * dt);
        crate.x += ((player.x - crate.x) / Math.max(1, distance)) * step;
        crate.y += ((player.y - crate.y) / Math.max(1, distance)) * step;
      }
      return;
    }
    if (this.held) {
      this.heldTime += dt;
      if (this.heldTime >= POWERUP.autoSeconds) this.activate(sim);
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.place(sim)) {
      this.timer = POWERUP.interval;
      sim.emit('crateSpawn', { x: crate.x, y: crate.y });
    } else {
      this.timer = 1;
    }
  }

  // Weighted pick, with one re-roll if it comes up the same as last time.
  pickKind(rng) {
    const entries = Object.entries(POWERUP.kinds);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const roll = () => {
      let left = rng() * total;
      for (const [kind, weight] of entries) {
        left -= weight;
        if (left <= 0) return kind;
      }
      return entries[entries.length - 1][0];
    };
    const first = roll();
    return first === this.lastKind ? roll() : first;
  }

  place(sim) {
    const player = sim.player;
    const travel = Math.hypot(player.vx, player.vy) > 1 ? headingOf(player.vx, player.vy) : player.heading;
    for (let i = 0; i < POWERUP.attempts; i += 1) {
      const heading = travel + (sim.rng() * 2 - 1) * degToRad(POWERUP.aheadAngleDeg);
      const distance = lerp(POWERUP.minDistance, POWERUP.maxDistance, sim.rng());
      const x = player.x + Math.sin(heading) * distance;
      const y = player.y - Math.cos(heading) * distance;
      if (sim.world.isClear(x, y, POWERUP.clearance)) {
        Object.assign(this.crate, { active: true, x, y, age: 0 });
        return true;
      }
    }
    return false;
  }

  // Uses the held item. Returns true if one was used.
  activate(sim) {
    if (!this.held) return false;
    const kind = this.kind || 'shockwave';
    this.held = false;
    this.kind = null;
    this.heldTime = 0;
    const player = sim.player;
    if (kind === 'shockwave') {
      sim.emit('pulse', { x: player.x, y: player.y, radius: POWERUP.pulseRadius });
      sim.shockwave(player.x, player.y, POWERUP.pulseRadius);
    } else if (kind === 'giant') {
      this.giantTime = GIANT.seconds;
      player.crushing = true;
      player.flatTime = 0; // too big for a spike strip to matter
      player.scaleTarget = GIANT.scale;
      player.mass = GIANT.mass;
    } else if (kind === 'freeze') {
      sim.freezePolice(player.x, player.y, FREEZE.radius, FREEZE.seconds);
    } else if (kind === 'pillars') {
      this.eruptPillars(sim);
    } else if (kind === 'flamer') {
      this.flamerTime = FLAMER.seconds;
      this.flamerGap = FLAMER.spacing;
    } else if (kind === 'turbo') {
      this.turboTime = TURBO.seconds;
      player.boost = TURBO.speedShare;
      player.boostAccel = TURBO.accelShare;
    } else if (kind === 'slick') {
      this.slickLeft = SLICK.puddles;
      this.slickGap = SLICK.spacing;
      this.slickGroup += 1;
    } else if (kind === 'decoy') {
      this.launchDecoy(sim);
    } else if (kind === 'blackout') {
      sim.stallPolice(player.x, player.y, BLACKOUT.radius, BLACKOUT.seconds);
      sim.helicopter.knockOut(sim, player.x, player.y, BLACKOUT.radius * HELICOPTER.blackoutReach);
    } else if (kind === 'phantom') {
      this.phantomTime = PHANTOM.seconds;
      player.ghost = true;
    }
    const lasts = { giant: GIANT.seconds, freeze: FREEZE.seconds, pillars: PILLARS.seconds, flamer: FLAMER.seconds, turbo: TURBO.seconds, slick: SLICK.seconds, decoy: DECOY.seconds, blackout: BLACKOUT.seconds, phantom: PHANTOM.seconds };
    this.effect = lasts[kind] ? { kind, left: lasts[kind], total: lasts[kind] } : null;
    sim.emit('power', { kind, x: player.x, y: player.y });
    return true;
  }

  // Runs every step, whatever the state of the run: effects carry on after a crash.
  tick(sim, dt) {
    const player = sim.player;
    const running = sim.state === 'running';
    player.updateScale(dt, GIANT.stiffness, GIANT.damping);
    if (this.giantTime > 0) {
      this.giantTime -= dt;
      if (this.giantTime <= 0 || !running) {
        this.giantTime = 0;
        player.scaleTarget = player.baseScale;
      }
    }
    // Still unstoppable until it has shrunk back, or it could be caught inside something.
    if (player.crushing && this.giantTime === 0 && player.scale < player.baseScale + GIANT.endScale - 1) {
      player.crushing = false;
      if (running) player.mass = sim.playerMass;
    }
    this.tickPillars(sim, dt);
    this.tickFlamer(sim, dt, running);
    this.tickTurbo(sim, dt, running);
    this.tickSlick(sim, dt, running);
    this.tickDecoy(sim, dt);
    this.tickPhantom(sim, dt, running);
    if (this.effect) {
      this.effect.left -= dt;
      if (this.effect.left <= 0) this.effect = null;
    }
  }

  // The item working now, with the share of its time left (1 = just used), or null.
  activeEffect() {
    return this.effect ? { kind: this.effect.kind, share: Math.max(0, this.effect.left / this.effect.total) } : null;
  }

  // ---- Turbo --------------------------------------------------------------------------------

  tickTurbo(sim, dt, running) {
    if (this.turboTime <= 0) return;
    this.turboTime = running ? this.turboTime - dt : 0;
    if (this.turboTime <= 0) {
      this.turboTime = 0;
      sim.player.boost = 1;
      sim.player.boostAccel = 1;
    }
  }

  // ---- Oil ----------------------------------------------------------------------------------

  tickSlick(sim, dt, running) {
    const player = sim.player;
    let anyPuddle = false;
    for (const puddle of this.puddles) {
      if (!puddle.active) continue;
      puddle.age += dt;
      if (puddle.age >= SLICK.seconds) puddle.active = false;
      else anyPuddle = true;
    }
    if (this.slickLeft > 0 && running) {
      this.slickGap += player.speed * dt;
      if (this.slickGap >= SLICK.spacing) {
        this.slickGap = 0;
        this.slickLeft -= 1;
        const puddle = this.puddles[this.nextPuddle];
        this.nextPuddle = (this.nextPuddle + 1) % this.puddles.length;
        const back = SLICK.behind * player.scale;
        Object.assign(puddle, { active: true, age: 0, group: this.slickGroup, x: player.x - Math.sin(player.heading) * back, y: player.y + Math.cos(player.heading) * back });
        sim.emit('puddle', { x: puddle.x, y: puddle.y });
        anyPuddle = true;
      }
    } else if (!running) this.slickLeft = 0;
    if (!anyPuddle) return;
    const reach = SLICK.radius + CAR_REACH / 2;
    for (const police of sim.police) {
      if (!police.alive || police.parked || police.spinning > 0 || police.frozen > 0) continue;
      const car = police.model;
      for (const puddle of this.puddles) {
        if (!puddle.active) continue;
        if ((car.x - puddle.x) ** 2 + (car.y - puddle.y) ** 2 < reach * reach) {
          police.spinOut(SLICK.spinSeconds, sim.rng() < 0.5 ? -1 : 1, SLICK.spinRate, SLICK.grip);
          sim.emit('spinOut', { police, x: car.x, y: car.y });
          break;
        }
      }
    }
  }

  // ---- Decoy --------------------------------------------------------------------------------

  // The copy peels off to one side and drives straight on; police close by go after it.
  launchDecoy(sim) {
    const player = sim.player;
    const decoy = sim.decoy;
    const side = sim.rng() < 0.5 ? -1 : 1;
    decoy.car.baseScale = player.baseScale;
    decoy.car.reset(player.x, player.y, player.heading + side * DECOY.turnAway);
    decoy.car.launch(Math.max(DECOY.minSpeed, player.speed));
    decoy.active = true;
    decoy.time = 0;
    this.decoyTime = DECOY.seconds;
    for (const police of sim.police) {
      if (police.alive && Math.hypot(police.model.x - player.x, police.model.y - player.y) <= DECOY.lureRadius) police.lured = true;
    }
  }

  tickDecoy(sim, dt) {
    const decoy = sim.decoy;
    if (!decoy.active) return;
    decoy.time += dt;
    decoy.car.stepFor(0, dt, 1 / 60);
    this.decoyTime -= dt;
    if (this.decoyTime > 0) return;
    decoy.active = false;
    for (const police of sim.police) police.lured = false;
    sim.emit('decoyGone', { x: decoy.car.x, y: decoy.car.y });
  }

  // ---- Phantom ------------------------------------------------------------------------------

  // It only turns solid again somewhere it fits, so it never comes back inside a wall.
  tickPhantom(sim, dt, running) {
    const player = sim.player;
    if (!player.ghost) return;
    this.phantomTime = running ? this.phantomTime - dt : -PHANTOM.extraSeconds;
    if (this.phantomTime > 0) return;
    const fits = sim.world.isClear(player.x, player.y, CAR_REACH * player.scale);
    if (fits || this.phantomTime <= -PHANTOM.extraSeconds) {
      this.phantomTime = 0;
      player.ghost = false;
    }
  }

  // ---- Pillars ------------------------------------------------------------------------------

  // A row of stone blocks across the player's path, a little way behind the car.
  eruptPillars(sim) {
    const player = sim.player;
    const speed = Math.hypot(player.vx, player.vy);
    const dirX = speed > 1 ? player.vx / speed : Math.sin(player.heading);
    const dirY = speed > 1 ? player.vy / speed : -Math.cos(player.heading);
    const middleX = player.x - dirX * PILLARS.distance;
    const middleY = player.y - dirY * PILLARS.distance;
    for (let i = 0; i < PILLARS.count; i += 1) {
      const pillar = this.pillars.find((candidate) => !candidate.active);
      if (!pillar) return;
      const across = (i - (PILLARS.count - 1) / 2) * PILLARS.spacing;
      pillar.active = true;
      pillar.state = 'up';
      pillar.time = 0;
      pillar.x = middleX - dirY * across;
      pillar.y = middleY + dirX * across;
      pillar.shape = sim.world.add({
        kind: 'pillar',
        isPillar: true,
        pillar,
        x: pillar.x,
        y: pillar.y,
        heading: 0,
        collider: { type: 'box', hw: PILLARS.halfSize, hl: PILLARS.halfSize },
        breakable: false,
      });
    }
  }

  // It stops being solid at once, then sinks out of sight.
  crumblePillar(sim, pillar) {
    if (pillar.state !== 'up') return;
    sim.world.remove(pillar.shape);
    pillar.shape = null;
    pillar.state = 'sinking';
    pillar.time = 0;
    sim.emit('pillarCrumble', { x: pillar.x, y: pillar.y });
  }

  clearPillar(sim, pillar) {
    if (pillar.shape) sim.world.remove(pillar.shape);
    pillar.shape = null;
    pillar.active = false;
    pillar.state = 'idle';
  }

  tickPillars(sim, dt) {
    for (const pillar of this.pillars) {
      if (!pillar.active) continue;
      pillar.time += dt;
      if (pillar.state === 'up' && pillar.time >= PILLARS.seconds) this.crumblePillar(sim, pillar);
      else if (pillar.state === 'sinking' && pillar.time >= PILLARS.sinkSeconds) this.clearPillar(sim, pillar);
    }
  }

  // ---- Flamer -------------------------------------------------------------------------------

  tickFlamer(sim, dt, running) {
    const player = sim.player;
    let anyPatch = false;
    for (const patch of this.patches) {
      if (!patch.active) continue;
      patch.age += dt;
      if (patch.age >= FLAMER.patchSeconds) patch.active = false;
      else anyPatch = true;
    }
    if (this.flamerTime > 0) {
      this.flamerTime = running ? this.flamerTime - dt : 0;
      this.flamerGap += player.speed * dt;
      if (running && this.flamerGap >= FLAMER.spacing) {
        this.flamerGap = 0;
        const patch = this.patches[this.nextPatch];
        this.nextPatch = (this.nextPatch + 1) % this.patches.length;
        const back = FLAMER.behind * player.scale;
        patch.active = true;
        patch.age = 0;
        patch.x = player.x - Math.sin(player.heading) * back;
        patch.y = player.y + Math.cos(player.heading) * back;
        anyPatch = true;
      }
    }
    if (anyPatch) this.igniteOnPatches(sim);
  }

  igniteOnPatches(sim) {
    const reach = FLAMER.patchRadius + FLAMER.tireReach;
    for (const police of sim.police) {
      if (!police.alive || police.burning > 0) continue;
      const car = police.model;
      for (const patch of this.patches) {
        if (!patch.active) continue;
        const dx = car.x - patch.x;
        const dy = car.y - patch.y;
        if (dx * dx + dy * dy < reach * reach) {
          police.ignite(FLAMER.burnSeconds, sim.rng() < 0.5 ? -1 : 1);
          sim.emit('ignite', { police, x: car.x, y: car.y });
          break;
        }
      }
    }
  }
}
