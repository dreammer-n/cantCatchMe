import { WARNING } from '../config/tuning.js';
import { projection } from '../render/projection.js';

const screen = { x: 0, y: 0 };

// Which police cars deserve a warning arrow at the screen edge: those still out of sight (or only
// just in sight) and arriving fast. Tailing cars don't count, and neither do parked ones: you can
// see those coming. Reads the simulation and never changes it. UIScene draws the result.
//
// Each car's `level` eases toward its target, so arrows fade in and out instead of flickering when
// a car's approach speed wobbles around a limit.
export class ThreatRadar {
  constructor() {
    this.entries = []; // one per police car (by id), reused
    this.threats = []; // the ones to draw this frame, soonest first; at most WARNING.maxShown
  }

  clear() {
    for (const entry of this.entries) entry.level = 0;
    this.threats.length = 0;
  }

  update(sim, view, dt) {
    const player = sim.player;
    const ease = 1 - Math.exp(-WARNING.fadeRate * dt);
    const list = this.threats;
    list.length = 0;
    for (const police of sim.police) {
      const entry = this.entries[police.id] || (this.entries[police.id] = { level: 0, x: 0, y: 0, eta: Infinity });
      const target = police.alive && !police.parked && police.frozen <= 0 ? this.targetLevel(police, player, view, entry) : 0;
      entry.level += (target - entry.level) * ease;
      if (entry.level < WARNING.minLevel) {
        entry.level = target > 0 ? entry.level : 0;
        continue;
      }
      entry.x = police.model.x;
      entry.y = police.model.y;
      if (target === 0) entry.eta = Infinity;
      list.push(entry);
    }
    list.sort(soonestFirst);
    if (list.length > WARNING.maxShown) list.length = WARNING.maxShown;
  }

  // 1 = show fully, 0 = don't show.
  targetLevel(police, player, view, entry) {
    const car = police.model;
    projection.toScreen(car.x, car.y, 0, screen);
    // How far outside the view the car is, in screen units (negative = inside).
    const gap = Math.max(Math.abs(screen.x - view.cx) - view.halfW, Math.abs(screen.y - view.cy) - view.halfH);
    if (gap <= -WARNING.fadeInside) return 0;
    const dx = player.x - car.x;
    const dy = player.y - car.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const closing = ((car.vx - player.vx) * dx + (car.vy - player.vy) * dy) / distance;
    const needed = police.role === 'interceptor' || police.armored ? WARNING.closingInterceptor : WARNING.closingFast;
    if (closing < needed) return 0;
    const eta = distance / closing;
    if (eta > WARNING.maxSeconds) return 0;
    entry.eta = eta;
    return gap >= 0 ? 1 : 1 + gap / WARNING.fadeInside;
  }
}

// The siren light reaching out from an arriving car toward the player, in world units.
// threat: { x, y }. Written into out: { angle, length, width }.
export function beamGeometry(threat, player, out) {
  const dx = player.x - threat.x;
  const dy = player.y - threat.y;
  out.angle = Math.atan2(dy, dx);
  out.length = Math.min(WARNING.beamMaxLength, Math.hypot(dx, dy) * WARNING.beamReach);
  out.width = WARNING.beamWidth;
  return out;
}

function soonestFirst(a, b) {
  return a.eta - b.eta;
}
