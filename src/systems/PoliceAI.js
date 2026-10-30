import { POLICE } from '../config/tuning.js';
import { clamp, headingOf, lerp, wrapAngle } from '../utils/math.js';

// Pursuit steering for one police car. Cheap on purpose:
//   1. Every 0.1-0.3 s (a reaction time) pick a target point near the player:
//      chasers aim a little ahead of the player, interceptors aim where the player will be.
//      Each car aims slightly to its own side, so they don't all drive in one line.
//   2. Every frame, steer toward that point. The car's own turn rate and grip limit how fast it
//      can actually turn, so police overshoot sharp turns: that is how the player escapes.
//   3. Obstacle awareness, deliberately imperfect: at each reaction a car may glance ahead and,
//      if a prop is right in its path, swerve to the clearer side until its next reaction. Cars
//      that don't notice (or have nowhere to go) crash into it: that is what makes pile-ups.
export function steerPolice(police, player, dt, rng, world) {
  const car = police.model;
  police.retarget -= dt;
  if (police.retarget <= 0) {
    police.retarget = lerp(POLICE.retargetMin, POLICE.retargetMax, rng());
    if (rng() < 0.08) police.aimSide = rng() * 2 - 1;
    chooseTarget(police, player);
    police.avoid = world && rng() < POLICE.awareness ? swerveFrom(car, world) : 0;
  }
  if (police.avoid) {
    police.steer = police.avoid;
    return;
  }
  const desired = headingOf(police.targetX - car.x, police.targetY - car.y);
  police.steer = clamp(wrapAngle(desired - car.heading) * POLICE.steerGain, -1, 1);
}

// 0 if the way ahead is clear, otherwise -1 / 1 (steer left / right toward the clearer side).
function swerveFrom(car, world) {
  const reach = POLICE.lookAhead + car.speed * POLICE.lookAheadSeconds;
  if (probeClear(car, world, 0, reach)) return 0;
  const right = probeClear(car, world, POLICE.swerveAngle, reach);
  const left = probeClear(car, world, -POLICE.swerveAngle, reach);
  if (right === left) return 0; // boxed in, or both sides clear: keep chasing
  return right ? 1 : -1;
}

function probeClear(car, world, angle, reach) {
  const heading = car.heading + angle;
  return world.isClear(car.x + Math.sin(heading) * reach, car.y - Math.cos(heading) * reach, POLICE.probeRadius);
}

function chooseTarget(police, player) {
  const car = police.model;
  const dx = player.x - car.x;
  const dy = player.y - car.y;
  const distance = Math.hypot(dx, dy);
  let lead;
  if (distance < POLICE.ramDistance) lead = 0.12;
  else if (police.role === 'interceptor') lead = clamp(distance / Math.max(120, car.speed), 0, POLICE.predictMaxSeconds);
  else lead = 0.3;

  let tx = player.x + player.vx * lead;
  let ty = player.y + player.vy * lead;
  if (distance >= POLICE.ramDistance) {
    // Offset to this car's side of the player's path, less when close.
    const speed = Math.hypot(player.vx, player.vy) || 1;
    const side = police.aimSide * POLICE.aimJitter * clamp(distance / 600, 0, 1);
    tx += (-player.vy / speed) * side;
    ty += (player.vx / speed) * side;
  }
  police.targetX = tx;
  police.targetY = ty;
}
