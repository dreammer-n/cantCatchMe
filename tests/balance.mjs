// Bot playtests: survival time distribution, crash causes, fairness and simulation cost.
import { SCREENS, T, newSim, playRun } from './simkit.mjs';
const overrides = JSON.parse(process.argv[5] || '{}');
for (const [group, values] of Object.entries(overrides)) Object.assign(T[group], values);

const runs = Number(process.argv[2] || 40);
const screenName = process.argv[3] || 'portrait';
const skill = Number(process.argv[4] || 1);
const sim = newSim();
const results = [];
for (let i = 0; i < runs; i += 1) results.push(playRun(sim, { seed: 100 + i, screen: SCREENS[screenName], skill }));

const times = results.map((r) => r.time).sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
const avg = (f) => results.reduce((s, r) => s + f(r), 0) / results.length;
const causes = {};
for (const r of results) causes[r.cause] = (causes[r.cause] || 0) + 1;
const allSpawns = results.flatMap((r) => r.spawns);
const onScreen = allSpawns.filter((s) => s.onScreen).length;
const fresh = results.filter((r) => r.cause === 'police' && r.policeAge !== null && r.policeAge < 1.5).length;
console.log(`screen ${screenName}, bot skill ${skill}, ${runs} runs ${JSON.stringify(overrides)}`);
const wc = {}; 
console.log(`survival  p10 ${q(0.1).toFixed(1)}  p25 ${q(0.25).toFixed(1)}  median ${q(0.5).toFixed(1)}  p75 ${q(0.75).toFixed(1)}  p90 ${q(0.9).toFixed(1)}  max ${times[times.length - 1].toFixed(1)} s`);
console.log(`causes    ${JSON.stringify(causes)}`);
console.log(`per run   wrecks ${avg((r) => r.wrecks).toFixed(1)}  close calls ${avg((r) => r.nearMisses).toFixed(1)}  best combo ${avg((r) => r.combo).toFixed(1)}  peak police ${avg((r) => r.maxAlive).toFixed(1)}`);
console.log(`fairness  spawns ${allSpawns.length}, on screen ${onScreen}, closest ${Math.min(...allSpawns.map((s) => s.distance)).toFixed(0)}; busted by a police car < 1.5 s old: ${fresh}`);
console.log(`cost      ${avg((r) => r.msPerSimSecond).toFixed(1)} ms of CPU per second of game (incl. bot)`);
