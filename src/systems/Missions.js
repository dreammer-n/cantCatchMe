import { MAPS, MISSIONS, STORAGE_KEYS, UNITS_PER_METER } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Maps } from './ScoreSystem.js';

// Three missions at a time (MISSIONS). A mission is { kind, target, reward, map?, progress, done }: "run" kinds
// must be done within one run (wreck 5 police in one run), the others add up over runs (use 10 power-ups).
// Done in a run: paid at once (GameScene), shown on the results, then replaced by a new one, a little harder
// as more are done. Saved through PlatformManager.
export const Missions = {
  active: [],
  done: 0, // missions done so far, which sets how hard new ones are
  run: null, // this run: { map, powers, choppers, completed: [] }

  async load() {
    this.restore(await PlatformManager.getStoredValue(STORAGE_KEYS.missions, null));
  },

  // Saved data could be edited or come from an older version: only what makes sense is kept.
  restore(saved, rng = Math.random) {
    const data = saved && typeof saved === 'object' ? saved : {};
    const done = Number(data.done);
    this.done = Number.isInteger(done) && done >= 0 ? done : 0;
    const list = Array.isArray(data.active) ? data.active : [];
    this.active = list.filter((m) => m && MISSIONS.kinds[m.kind] && Number.isFinite(m.target) && Number.isFinite(m.reward)).slice(0, MISSIONS.active);
    for (const m of this.active) {
      m.progress = Number.isFinite(m.progress) ? m.progress : 0;
      m.done = false;
      if (m.kind === 'map' && !MAPS.some((map) => map.id === m.map)) m.map = MAPS[0].id;
    }
    this.fill(rng);
  },

  save() {
    PlatformManager.setStoredValue(STORAGE_KEYS.missions, { done: this.done, active: this.active });
  },

  tier() {
    return Math.min(MISSIONS.kinds.wrecks.targets.length - 1, Math.floor(this.done / MISSIONS.perTier));
  },

  // Tops the list up to MISSIONS.active, never two of the same kind.
  fill(rng = Math.random) {
    while (this.active.length < MISSIONS.active) {
      const tier = this.tier();
      const kinds = Object.entries(MISSIONS.kinds).filter(([kind, def]) => !this.active.some((m) => m.kind === kind) && tier >= (def.minTier || 0));
      const [kind, def] = kinds[Math.floor(rng() * kinds.length)];
      const mission = { kind, target: def.targets[tier], reward: def.reward[tier], progress: 0, done: false };
      if (kind === 'map') {
        const open = MAPS.filter((map) => Maps.isUnlocked(map));
        mission.map = open[Math.floor(rng() * open.length)].id;
      }
      this.active.push(mission);
    }
    this.save();
  },

  // What it says on screen.
  describe(m) {
    const def = MISSIONS.kinds[m.kind];
    const text = m.target > 1 && def.plural ? def.plural : def.text;
    const map = m.map ? (MAPS.find((entry) => entry.id === m.map) || MAPS[0]).name : '';
    return text.replace('{n}', String(m.target)).replace('{map}', map);
  },

  // For the ones that add up over runs: "7/15". Null for the one-run kinds.
  progressText(m) {
    if (MISSIONS.kinds[m.kind].run) return null;
    return `${Math.min(m.target, Math.floor(m.progress))}/${m.target}`;
  },

  startRun(mapId) {
    this.run = { map: mapId, powers: 0, choppers: 0, completed: [] };
    for (const m of this.active) m.done = false;
  },

  // The run's events (GameScene.handleEvents).
  onEvent(e) {
    if (!this.run) return;
    if (e.type === 'power') this.run.powers += 1;
    else if (e.type === 'helicopterDown') this.run.choppers += 1;
  },

  // How far a mission has got, counting this run. stats: the run's RunStats.
  value(m, stats) {
    const run = this.run || { map: null, powers: 0, choppers: 0 };
    switch (m.kind) {
      case 'wrecks':
        return stats.wrecks;
      case 'survive':
        return stats.time;
      case 'combo':
        return stats.bestCombo;
      case 'nearMiss':
        return stats.nearMisses;
      case 'distance':
        return stats.distance / UNITS_PER_METER;
      case 'map':
        return run.map === m.map ? stats.time : 0;
      case 'powers':
        return m.progress + run.powers;
      case 'totalWrecks':
        return m.progress + stats.wrecks;
      case 'chopper':
        return m.progress + run.choppers;
      default:
        return 0;
    }
  },

  // Every frame of a run: the missions done just now (each to be paid once).
  check(stats) {
    if (!this.run) return [];
    const now = [];
    for (const m of this.active) {
      if (m.done || this.value(m, stats) < m.target) continue;
      m.done = true;
      this.run.completed.push(m);
      now.push(m);
    }
    return now;
  },

  // The run is over: missions that add up keep their progress; done ones go, and new ones take their place.
  // Returns the missions done in this run.
  endRun(stats) {
    if (!this.run) return [];
    for (const m of this.active) {
      if (!m.done && !MISSIONS.kinds[m.kind].run) m.progress = this.value(m, stats);
    }
    const completed = this.run.completed;
    this.done += completed.length;
    this.active = this.active.filter((m) => !m.done);
    this.run = null;
    this.fill();
    return completed;
  },
};
