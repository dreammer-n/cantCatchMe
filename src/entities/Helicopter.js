import { HEAT_HARD, HELICOPTER } from '../config/tuning.js';
import { clamp, headingOf, lerp, smoothFactor, wrapAngle } from '../utils/math.js';

// The police helicopter, as pure logic (no Phaser; render/HelicopterView.js draws it). It flies above the player,
// keeps a searchlight on the car, and now and then swoops down to drop something into the player's path: a spike
// strip (police stingers), or a row of orange traffic barrels that block the road but can be knocked aside.
//
// It doesn't stay for ever: it runs low on fuel and flies off; it loses the player who hides under cover (a gas
// station roof, a bridge, thick trees) or turns into a PHANTOM or sends out a DECOY; and BLACKOUT close by
// knocks it out of the sky. Another comes back later.
//
// states: 'chasing' -> 'leaving' (flies up and away) or 'falling' (spins down and crashes) -> gone.
// A drop goes: 'warning' (a burning flare marks the spot, then it falls) -> spikes: handed to the simulation's
// spike strips, done; barrels: 'down' (knock-over obstacles) -> gone.
export class Helicopter {
  constructor() {
    this.drops = Array.from({ length: HELICOPTER.maxDrops }, () => ({
      active: false,
      state: 'idle',
      kind: 'spikes',
      x: 0,
      y: 0,
      heading: 0,
      warning: 1,
      time: 0,
      barrels: Array.from({ length: HELICOPTER.barrels }, () => ({ x: 0, y: 0, shape: null, hit: false, hitTime: 0, vx: 0, vy: 0, spin: 0 })),
    }));
    this.active = false;
  }

  reset(sim) {
    this.active = false;
    this.state = 'chasing';
    this.x = 0;
    this.y = 0;
    this.z = HELICOPTER.height;
    this.heading = 0;
    this.spotX = 0;
    this.spotY = 0;
    this.clock = 0;
    this.nextDrop = 0;
    this.burst = 0; // drops still to come in quick succession
    this.dive = 0; // 0..1: how far into a swoop it is
    this.stay = 0; // seconds of fuel left
    this.hidden = 0; // seconds the player has been out of its sight
    this.coverClock = 0;
    this.stateTime = 0;
    this.spin = 0;
    this.nextArrival = sim && sim.pace && sim.pace.hard ? HEAT_HARD.helicopterAt : HELICOPTER.firstAt;
    for (const drop of this.drops) this.clearDrop(sim, drop);
  }

  // Comes in from behind the player, out of sight.
  arrive(sim) {
    const player = sim.player;
    const speed = Math.max(1, player.speed);
    this.active = true;
    this.state = 'chasing';
    this.stateTime = 0;
    this.x = player.x - (player.vx / speed) * HELICOPTER.arriveDistance;
    this.y = player.y - (player.vy / speed) * HELICOPTER.arriveDistance;
    this.z = HELICOPTER.height;
    this.heading = player.heading;
    this.spotX = this.x;
    this.spotY = this.y;
    this.nextDrop = HELICOPTER.firstDropAfter;
    this.stay = lerp(HELICOPTER.stayMin, HELICOPTER.stayMax, sim.rng());
    this.hidden = 0;
    sim.emit('helicopter', {});
  }

  update(sim, dt) {
    const player = sim.player;
    this.updateDrops(sim, dt);
    if (!this.active) {
      if (sim.state === 'running' && sim.time >= this.nextArrival) this.arrive(sim);
      else return;
    }
    this.clock += dt;
    this.stateTime += dt;
    if (this.state === 'leaving') {
      this.flyAway(sim, dt);
      return;
    }
    if (this.state === 'falling') {
      this.fallDown(sim, dt);
      return;
    }

    // It flies to a point ahead of the car, weaving a little from side to side.
    const speed = Math.max(1, player.speed);
    const sway = Math.sin(this.clock * HELICOPTER.swaySpeed) * HELICOPTER.sway;
    const targetX = player.x + player.vx * HELICOPTER.leadSeconds + (-player.vy / speed) * sway;
    const targetY = player.y + player.vy * HELICOPTER.leadSeconds + (player.vx / speed) * sway;
    const k = smoothFactor(HELICOPTER.followSharpness, dt);
    const moveX = (targetX - this.x) * k;
    const moveY = (targetY - this.y) * k;
    this.x += moveX;
    this.y += moveY;
    if (Math.hypot(moveX, moveY) > 0.05) {
      const turn = wrapAngle(headingOf(moveX, moveY) - this.heading);
      this.heading = wrapAngle(this.heading + turn * smoothFactor(HELICOPTER.turnSharpness, dt));
    }

    // The searchlight always lags a little behind the car.
    const spotK = smoothFactor(HELICOPTER.spotSharpness, dt);
    this.spotX += (player.x - this.spotX) * spotK;
    this.spotY += (player.y - this.spotY) * spotK;

    // It swoops low while it has a drop under way.
    const dropping = this.drops.some((drop) => drop.active && drop.state === 'warning');
    this.dive = clamp(this.dive + (dropping ? dt : -dt) / HELICOPTER.swoopSeconds, 0, 1);
    this.z = lerp(HELICOPTER.height + Math.sin(this.clock * 0.9) * 14, HELICOPTER.swoopHeight, this.dive * this.dive * (3 - 2 * this.dive));

    if (sim.state !== 'running') return;
    // Out of fuel; or it has lost the player.
    this.stay -= dt;
    if (this.stay <= 0) {
      this.leave(sim, 'fuel');
      return;
    }
    if (player.ghost || sim.decoy.active) {
      this.leave(sim, 'lost');
      return;
    }
    this.coverClock -= dt;
    if (this.coverClock <= 0) {
      this.coverClock = HELICOPTER.coverCheckEvery;
      this.covered = sim.playerUnderCover();
    }
    this.hidden = this.covered ? this.hidden + dt : 0;
    if (this.hidden >= HELICOPTER.loseSeconds) {
      this.leave(sim, 'lost');
      return;
    }

    this.nextDrop -= dt;
    if (this.nextDrop <= 0) {
      const placed = this.tryDrop(sim);
      if (!placed) this.nextDrop = 1;
      else if (this.burst > 0) {
        this.burst -= 1;
        this.nextDrop = lerp(HELICOPTER.burstGap[0], HELICOPTER.burstGap[1], sim.rng());
      } else {
        this.nextDrop = lerp(HELICOPTER.dropEveryMin, HELICOPTER.dropEveryMax, sim.rng());
        // Sometimes the next one is the start of a quick run of two or three.
        if (sim.rng() < HELICOPTER.burstChance) this.burst = 1 + Math.floor(sim.rng() * 2);
      }
    }
  }

  // Off it goes: whatever it was about to drop is called off.
  leave(sim, reason) {
    this.state = 'leaving';
    this.stateTime = 0;
    for (const drop of this.drops) if (drop.active && drop.state === 'warning') this.clearDrop(sim, drop);
    sim.emit('helicopterLeaves', { reason });
  }

  flyAway(sim, dt) {
    this.x += Math.sin(this.heading) * HELICOPTER.leaveSpeed * dt;
    this.y -= Math.cos(this.heading) * HELICOPTER.leaveSpeed * dt;
    this.z += HELICOPTER.leaveClimb * dt;
    if (this.stateTime >= HELICOPTER.leaveSeconds) this.gone(sim, lerp(HELICOPTER.returnMin, HELICOPTER.returnMax, sim.rng()));
  }

  // BLACKOUT close by: the engine dies and it comes down.
  knockOut(sim, x, y, radius) {
    if (!this.active || this.state !== 'chasing') return false;
    if (Math.hypot(this.x - x, this.y - y) > radius) return false;
    this.state = 'falling';
    this.stateTime = 0;
    this.fallZ = this.z;
    this.spin = (sim.rng() < 0.5 ? -1 : 1) * HELICOPTER.fallSpin;
    for (const drop of this.drops) if (drop.active && drop.state === 'warning') this.clearDrop(sim, drop);
    sim.emit('helicopterHit', { x: this.x, y: this.y });
    return true;
  }

  fallDown(sim, dt) {
    const t = this.stateTime / HELICOPTER.fallSeconds;
    this.heading = wrapAngle(this.heading + this.spin * dt);
    this.x += Math.sin(this.heading) * HELICOPTER.fallDrift * dt;
    this.y -= Math.cos(this.heading) * HELICOPTER.fallDrift * dt;
    this.z = Math.max(0, this.fallZ * (1 - t * t));
    if (t < 1) return;
    sim.helicopterDown(this.x, this.y);
    this.gone(sim, HELICOPTER.returnMax);
  }

  gone(sim, returnAfter) {
    this.active = false;
    this.state = 'chasing';
    this.nextArrival = sim.time + returnAfter;
  }

  // Marks a spot on or beside the player's path, far enough ahead to steer round it.
  tryDrop(sim) {
    const player = sim.player;
    const speed = player.speed;
    const drop = this.drops.find((candidate) => !candidate.active);
    if (!drop || speed < HELICOPTER.minTargetSpeed || player.isFalling) return false;
    const rng = sim.rng;
    const ahead = lerp(HELICOPTER.aheadSeconds[0], HELICOPTER.aheadSeconds[1], rng());
    const side = rng() < HELICOPTER.centreShare ? 0 : (rng() < 0.5 ? -1 : 1) * lerp(HELICOPTER.sideOffset[0], HELICOPTER.sideOffset[1], rng());
    const fx = player.vx / speed;
    const fy = player.vy / speed;
    const x = player.x + player.vx * ahead - fy * side;
    const y = player.y + player.vy * ahead + fx * side;
    if (!sim.chunks.contains(x, y) || !sim.world.isClear(x, y, HELICOPTER.clearRadius)) return false;
    drop.active = true;
    drop.state = 'warning';
    drop.kind = rng() < HELICOPTER.spikeShare ? 'spikes' : 'barrels';
    drop.time = 0;
    drop.x = x;
    drop.y = y;
    // Across the car's path, give or take.
    drop.heading = player.heading + (rng() - 0.5) * 2 * ((HELICOPTER.angleJitterDeg * Math.PI) / 180);
    // It always lands a moment before the car could get there, so it is never dropped right in front of it.
    drop.warning = Math.min(lerp(HELICOPTER.warningSeconds[0], HELICOPTER.warningSeconds[1], rng()), ahead - HELICOPTER.landsBefore);
    sim.emit('flare', { x, y });
    return true;
  }

  updateDrops(sim, dt) {
    for (const drop of this.drops) {
      if (!drop.active) continue;
      drop.time += dt;
      if (drop.state === 'warning' && drop.time >= drop.warning) this.land(sim, drop);
      else if (drop.state === 'down') {
        for (const barrel of drop.barrels) if (barrel.hit) barrel.hitTime += dt;
        if (drop.time >= HELICOPTER.barrelSeconds) this.clearDrop(sim, drop);
      }
    }
  }

  land(sim, drop) {
    const player = sim.player;
    // Never right on top of the car: nobody could have dodged that.
    if (Math.hypot(player.x - drop.x, player.y - drop.y) < HELICOPTER.safeDistance * player.scale) {
      this.clearDrop(sim, drop);
      return;
    }
    sim.emit('dropLand', { x: drop.x, y: drop.y, kind: drop.kind });
    if (drop.kind === 'spikes') {
      sim.addSpikeStrip(drop.x, drop.y, drop.heading);
      drop.active = false;
      drop.state = 'idle';
      return;
    }
    // A row of barrels across the path.
    drop.state = 'down';
    drop.time = 0;
    const rx = Math.cos(drop.heading);
    const ry = Math.sin(drop.heading);
    drop.barrels.forEach((barrel, i) => {
      const offset = (i - (drop.barrels.length - 1) / 2) * HELICOPTER.barrelSpacing + (sim.rng() - 0.5) * 8;
      barrel.x = drop.x + rx * offset;
      barrel.y = drop.y + ry * offset;
      barrel.hit = false;
      barrel.hitTime = 0;
      barrel.shape = sim.world.add({
        kind: 'barrel',
        isDropBarrel: true,
        barrel,
        x: barrel.x,
        y: barrel.y,
        heading: 0,
        collider: { type: 'circle', r: HELICOPTER.barrelRadius },
        breakable: true,
      });
    });
  }

  // A car drives into a barrel: it goes flying and the car loses some speed.
  knockBarrel(sim, barrel, car) {
    if (barrel.hit) return;
    barrel.hit = true;
    barrel.hitTime = 0;
    barrel.vx = car.vx * HELICOPTER.barrelKnock + (sim.rng() - 0.5) * 120;
    barrel.vy = car.vy * HELICOPTER.barrelKnock + (sim.rng() - 0.5) * 120;
    barrel.spin = (sim.rng() - 0.5) * 16;
    if (barrel.shape) sim.world.remove(barrel.shape);
    barrel.shape = null;
    car.vx *= HELICOPTER.barrelSlowdown;
    car.vy *= HELICOPTER.barrelSlowdown;
    sim.emit('barrelHit', { x: barrel.x, y: barrel.y, player: car === sim.player });
  }

  clearDrop(sim, drop) {
    for (const barrel of drop.barrels) {
      if (barrel.shape && sim) sim.world.remove(barrel.shape);
      barrel.shape = null;
      barrel.hit = false;
    }
    drop.active = false;
    drop.state = 'idle';
  }
}
