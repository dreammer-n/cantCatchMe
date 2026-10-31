import { COLLISION, FLAMER, FREEZE, GIANT, PILLARS, POWERUP } from '../config/tuning.js';
import { degToRad, headingOf, lerp } from '../utils/math.js';

// The lucky die and what it gives. States:
//   no die -> a die chasing the player from the moment it appears -> an item is held (at most one, and
//   it fires by itself after a few seconds) -> used -> no die ...
// A new die only appears while the player isn't holding an item, ahead of the player. The bouncing is
// only drawn (GameScene.updateCrate); here it just follows the car.
// Effects that outlast the moment of use (Giant, Flamer, the pillars) run in tick().
export class PowerUps {
  constructor() {
    this.pillars = Array.from({ length: PILLARS.pool }, () => ({ active: false, state: 'idle', x: 0, y: 0, time: 0, shape: null }));
    this.patches = Array.from({ length: FLAMER.maxPatches }, () => ({ active: false, x: 0, y: 0, age: 0 }));
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
    for (const pillar of this.pillars) this.clearPillar(sim, pillar);
    for (const patch of this.patches) patch.active = false;
  }

  // Puts an item straight into the player's hands.
  give(kind) {
    this.held = true;
    this.kind = kind;
    this.lastKind = kind;
    this.heldTime = 0;
  }

  // The name and countdown for the on-screen button, or null when nothing is held.
  get label() {
    if (!this.held) return null;
    const name = POWERUP.names[this.kind || 'shockwave'];
    return `${name} ${Math.max(1, Math.ceil(POWERUP.autoSeconds - this.heldTime))}`;
  }

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
    }
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
        player.scaleTarget = 1;
      }
    }
    // Still unstoppable until it has shrunk back, or it could be caught inside something.
    if (player.crushing && this.giantTime === 0 && player.scale < GIANT.endScale) {
      player.crushing = false;
      if (running) player.mass = COLLISION.playerMass;
    }
    this.tickPillars(sim, dt);
    this.tickFlamer(sim, dt, running);
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
