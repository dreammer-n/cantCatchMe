// Checks for the WANTED level, missions, the player's level and the upgrades.
import { readFileSync } from 'node:fs';
import { LEVELS, MISSIONS, UNITS_PER_METER, UPGRADES, WANTED, MAPS } from '../src/config/tuning.js';
import { Missions } from '../src/systems/Missions.js';
import { Progress, wantedAt, wantedCall, xpForLevel } from '../src/systems/Progress.js';
import { Garage, RunStats, coinsForRun } from '../src/systems/ScoreSystem.js';
import { createRng } from '../src/utils/math.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

// ---- WANTED ----
check('a run starts at one star', wantedAt(0) === 1 && wantedAt(0, true) === 1);
check('a star for each new kind of trouble, one every 30 s from 1 minute', wantedAt(59.9) === 1 && wantedAt(60) === 2 && wantedAt(90) === 3 && wantedAt(120) === 4 && wantedAt(150) === 5 && wantedAt(999) === 5);
check('HARD START brings them at the same times', [0, 60, 90, 120, 150].every((t) => wantedAt(t, true) === wantedAt(t)));
check('each new star says what joins the chase', [2, 3, 4, 5].every((n) => typeof wantedCall(n) === 'string') && wantedCall(1) === null);
check('there are five stars', WANTED.normal.length === 5 && WANTED.hard.length === 5);

// ---- Level ----
Garage.restore(0, [], 'coupe');
Progress.restore(null);
check('a new player is level 1 with no upgrades', Progress.level === 1 && Progress.xp === 0 && Progress.tier('coins') === 0 && Progress.tier('engine') === 0 && Object.keys(Progress.cars).length === 0);
check('each level needs a little more XP', xpForLevel(2) > xpForLevel(1) && xpForLevel(1) === LEVELS.first);
const reached = Progress.addXp(xpForLevel(1) + xpForLevel(2) + 5);
check('XP raises the level, more than one at once if earned', reached.join() === '2,3' && Progress.level === 3 && Progress.xp === 5, `${reached} ${Progress.level} ${Progress.xp}`);
check('a level-up pays coins', Garage.coins === (2 + 3) * LEVELS.coinsPerLevel, String(Garage.coins));
Progress.restore({ level: -4, xp: 'lots', upgrades: { coins: 99, nonsense: 3 }, cars: { coupe: { engine: 99, handling: -1 }, junk: 'x' } });
check('a strange save is cleaned up', Progress.level === 1 && Progress.xp === 0 && Progress.tier('coins') === UPGRADES.prices.length && Progress.tier('engine', 'coupe') === UPGRADES.prices.length && Progress.tier('handling', 'coupe') === 0 && !('nonsense' in Progress.upgrades) && !('junk' in Progress.cars));
// An older save had ENGINE and HANDLING for every car at once: they go to each car owned, so nothing is lost.
Progress.restore({ level: 4, upgrades: { engine: 2, handling: 1, coins: 1 } });
Progress.adopt(['coupe', 'pickup']);
check('upgrades from an older save go to every car owned', Progress.tier('engine', 'coupe') === 2 && Progress.tier('engine', 'pickup') === 2 && Progress.tier('handling', 'pickup') === 1 && Progress.tier('engine', 'hypercar') === 0 && Progress.tier('coins') === 1);

// ---- Upgrades ----
Progress.restore({ level: 1, xp: 0, cars: {}, freeUsed: true }); // the free one is checked at the end
Garage.restore(10000, ['coupe', 'pickup'], 'coupe');
check('the first tier needs only coins', Progress.canUpgrade('engine') && Progress.upgrade('engine') && Progress.tier('engine') === 1 && Garage.coins === 10000 - UPGRADES.prices[0]);
check('it is that car\'s own: the others are as they were', Progress.tier('engine', 'pickup') === 0);
check('a car not owned can\'t be upgraded', !Progress.canUpgrade('engine', 'hypercar') && !Progress.upgrade('engine', 'hypercar'));
check('the next tier waits for the level', !Progress.canUpgrade('engine') && Progress.next('engine').level === UPGRADES.levels[1]);
Progress.restore({ level: 20, xp: 0, cars: { coupe: { engine: 1 } } });
Garage.restore(100, ['coupe'], 'coupe');
check('and for the coins', !Progress.upgrade('engine') && Progress.tier('engine') === 1 && Garage.coins === 100);
Progress.restore({ level: 20, upgrades: { coins: 5 }, cars: { coupe: { engine: 2, handling: 3 } } });
const base = { topSpeed: 300, acceleration: 400, maxTurnRateDeg: 180, gripTurning: 5, other: 7 };
const tuned = Progress.handling(base, 'coupe');
check('another car drives as it was', Progress.handling(base, 'pickup').topSpeed === 300);
check('engine raises speed and pull', Math.abs(tuned.topSpeed - 300 * (1 + 2 * UPGRADES.kinds.engine.topSpeed)) < 1e-9 && tuned.acceleration > 400);
check('handling raises turning and grip', tuned.maxTurnRateDeg > 180 && tuned.gripTurning > 5 && tuned.other === 7 && base.topSpeed === 300);
check('a maxed upgrade has no next tier', Progress.next('coins') === null && !Progress.canUpgrade('coins'));
check('the top engine stays modest (police keep their speed)', 1 + UPGRADES.prices.length * UPGRADES.kinds.engine.topSpeed <= 1.15);
const coins = coinsForRun({ time: 60, wrecks: 4, combo: 2 }, false, Progress.coinBonus());
check('the coin upgrade adds its share', coins.upgrade === Math.round((coins.total - coins.upgrade) * 5 * UPGRADES.kinds.coins.coins) && coins.upgrade > 0);
check('with no upgrade nothing is added', coinsForRun({ time: 60, wrecks: 4, combo: 2 }).upgrade === 0);

// ---- The Hypercar challenge ----
Garage.restore(0, ['coupe'], 'coupe');
check('the Hypercar is not won short of the times', Garage.checkChallenges(359, 179).length === 0 && !Garage.owns('hypercar'));
check('6 minutes on a normal run wins it', Garage.checkChallenges(361, 0).map((c) => c.id).join() === 'hypercar' && Garage.owns('hypercar') && Garage.coins === 0);
Garage.restore(0, ['coupe'], 'coupe');
check('3 minutes with HARD START wins it too', Garage.checkChallenges(100, 180).length === 1 && Garage.owns('hypercar'));
check('and only once', Garage.checkChallenges(999, 999).length === 0);

// ---- Missions ----
const rng = createRng(7);
Missions.restore(null, rng);
check('three missions, all different', Missions.active.length === MISSIONS.active && new Set(Missions.active.map((m) => m.kind)).size === MISSIONS.active);
check('a new player gets no chopper mission', Missions.active.every((m) => m.kind !== 'chopper'));
check('every mission says what to do', Missions.active.every((m) => /\d/.test(Missions.describe(m)) && !Missions.describe(m).includes('{')));
// A run: wreck 5, survive 50 s.
Missions.restore({ done: 0, active: [{ kind: 'wrecks', target: 5, reward: 100 }, { kind: 'totalWrecks', target: 12, reward: 70, progress: 7 }, { kind: 'distance', target: 300, reward: 50 }] }, rng);
Missions.startRun(MAPS[0].id);
const stats = new RunStats();
for (let i = 0; i < 4; i += 1) stats.addWreck();
check('one wreck short: not done yet', Missions.check(stats).length === 0);
stats.addWreck();
const now = Missions.check(stats);
check('done the moment it is reached, both kinds', now.length === 2 && now.some((m) => m.kind === 'wrecks') && now.some((m) => m.kind === 'totalWrecks'));
check('and only once', Missions.check(stats).length === 0);
stats.distance = 299 * UNITS_PER_METER;
const done = Missions.endRun(stats);
check('the run reports what was done', done.length === 2 && Missions.done === 2);
check('done missions are replaced, the rest stay', Missions.active.length === 3 && Missions.active.some((m) => m.kind === 'distance'));
// Missions that add up keep their progress over runs.
Missions.restore({ done: 0, active: [{ kind: 'powers', target: 4, reward: 100, progress: 0 }] }, rng);
Missions.startRun(MAPS[0].id);
Missions.onEvent({ type: 'power' });
Missions.onEvent({ type: 'power' });
Missions.endRun(new RunStats());
const powers = Missions.active.find((m) => m.kind === 'powers');
check('progress over runs is kept', powers && powers.progress === 2 && Missions.progressText(powers) === '2/4');
// A map mission only counts on its map.
Missions.restore({ done: 0, active: [{ kind: 'map', target: 20, reward: 70, map: MAPS[1].id }] }, rng);
Missions.startRun(MAPS[0].id);
const long = new RunStats();
long.time = 60;
check('a map mission does not count on another map', Missions.check(long).length === 0);
Missions.endRun(long);
Missions.restore({ done: 0, active: [{ kind: 'map', target: 20, reward: 70, map: MAPS[1].id }] }, rng);
Missions.startRun(MAPS[1].id);
check('and counts on its own', Missions.check(long).some((m) => m.kind === 'map'));
// They get harder.
Missions.restore({ done: MISSIONS.perTier * 3, active: [] }, rng);
check('more missions done, harder new ones', Missions.tier() === 3 && Missions.active.every((m) => m.target === MISSIONS.kinds[m.kind].targets[3]));
check('a strange save is cleaned up', (Missions.restore({ done: 'x', active: [{ kind: 'nope', target: 1, reward: 1 }, null] }, rng), Missions.done === 0 && Missions.active.length === 3 && Missions.active.every((m) => MISSIONS.kinds[m.kind])));
// Every text in the game's lettering.
const font = readFileSync(new URL('../src/ui/displayFont.js', import.meta.url), 'utf8');
const drawable = (text) => [...text].every((c) => c === ' ' || /[A-Z0-9]/.test(c) || font.includes(`'${c}': [`) || font.includes(`"${c}": [`));
const texts = [];
for (const [kind, def] of Object.entries(MISSIONS.kinds)) {
  def.targets.forEach((target) => MAPS.forEach((map) => texts.push(Missions.describe({ kind, target, map: map.id }))));
}
for (const step of [...WANTED.normal, ...WANTED.hard]) if (step.call) texts.push(step.call, 'WANTED LEVEL 5!');
texts.push('LEVEL UP! LEVEL 12 · +600 COINS', 'MISSION DONE! +100', 'DONE: X', 'MAX', 'LEVEL 3', 'UPGRADES', 'CARS', 'MISSIONS');
for (const def of Object.values(UPGRADES.kinds)) texts.push(def.name);
const bad = texts.filter((t) => !drawable(t.replace(/·/g, '')));
check('every new text can be drawn in the game\'s lettering', bad.length === 0, bad.slice(0, 3).join(' | '));

// ---- Skid marks: a car put somewhere else never draws a strip across the map ----
{
  const { SkidMarks } = await import('../src/systems/SkidMarks.js');
  const { SKIDS } = await import('../src/config/tuning.js');
  const made = [];
  const fakeMark = () => {
    const mark = { w: 0, visible: false };
    for (const name of ['setPosition', 'setRotation', 'setFillStyle', 'setAlpha']) mark[name] = () => mark;
    mark.setSize = (w) => ((mark.w = w), mark);
    mark.setVisible = (v) => ((mark.visible = v), mark);
    made.push(mark);
    return mark;
  };
  const skids = new SkidMarks({ add: { rectangle: fakeMark } }, { add() {} });
  skids.addPoint(0, 0, 0, true);
  skids.addPoint(0, 20, 0, true);
  check('a sliding tire leaves a mark', made.length === 1 && Math.abs(made[0].w - 21) < 1e-9);
  skids.addPoint(0, 2000, 900, true); // revived far away, still sliding
  check('a jump across the map leaves none', made.length === 1);
  skids.addPoint(0, 2020, 900, true);
  check('and the marks carry on from the new place', made.length === 2 && made[1].w < SKIDS.maxSegmentLength);
}

// The one free upgrade (GUIDE, UPGRADES.free): the first ENGINE tier of a car owned, once, even with no coins.
Progress.restore({ level: 1, xp: 0 });
Garage.restore(0, ['coupe', 'pickup'], 'coupe');
check('a new player has a free engine upgrade', Progress.isFree('engine', 'coupe') && Progress.canUpgrade('engine', 'coupe') && !Progress.isFree('handling', 'coupe'));
check('not on a car not owned', !Progress.isFree('engine', 'hypercar'));
check('it costs nothing', Progress.upgrade('engine', 'coupe') && Progress.tier('engine', 'coupe') === 1 && Garage.coins === 0);
check('and it is only once', !Progress.isFree('engine', 'pickup') && !Progress.canUpgrade('engine', 'pickup'));
Progress.restore(JSON.parse(JSON.stringify({ level: 1, freeUsed: Progress.freeUsed })));
check('it stays used after a reload', !Progress.isFree('engine', 'pickup'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
