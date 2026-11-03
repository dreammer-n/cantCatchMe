import { DEV_PANEL, HANDLING_PRESETS, HANDLING_PRESET_ORDER, MAPS, POWERUP, RENDER, STORAGE_KEYS } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { findView, projection } from '../render/projection.js';
import { Garage, Maps } from '../systems/ScoreSystem.js';
import { DevPanel } from './DevPanel.js';

// The debug toolbar (?debug only), wired to the UI scene: handling presets, camera views, the turntable, power-ups,
// police on demand, coins, maps. UIScene loads this file on demand, and `npm run build` leaves it out.
// Returns { update(time) }, for the readout.
export function attachDevToolbar(ui) {
  const world = ui.world;
  let nextReadoutAt = 0;

  const setView = (viewId, save) => {
    const view = findView(viewId);
    if (projection.viewId !== view.id) projection.setView(view);
    panel.setViewLabel(view.label);
    if (save) PlatformManager.setStoredValue(STORAGE_KEYS.view, view.id);
  };
  const selectPreset = (id, save = true) => {
    ui.registry.set('handlingPreset', id);
    panel.setActivePreset(id);
    if (save) PlatformManager.setStoredValue(STORAGE_KEYS.handlingPreset, id);
  };

  const panel = new DevPanel({
    presets: [...HANDLING_PRESET_ORDER.map((id) => ({ id, label: HANDLING_PRESETS[id].label })), { id: 'car', label: 'Chosen car' }],
    onSelectPreset: (id) => selectPreset(id),
    onRestart: () => ui.restartRun(),
    onCycleView: () => {
      const views = RENDER.views;
      const index = views.findIndex((view) => view.id === projection.viewId);
      setView(views[(index + 1) % views.length].id, true);
    },
    onTurntable: () => {
      world.setTurntable(!world.turntable);
      panel.setTurntable(world.turntable);
    },
    powers: Object.entries(POWERUP.names).map(([id, label]) => ({ id, label })),
    onGivePower: (kind) => world.givePower(kind),
    onSummon: (kind) => world.summon(kind),
    onCoins: () => Garage.award(50000),
    onResetGarage: () => {
      Garage.restore(0, [], null);
      Garage.save();
    },
    onAllMaps: () => {
      for (const map of MAPS) Maps.best[map.id] = Math.max(Maps.bestTime(map.id), 75);
    },
  });
  panel.setActivePreset(ui.registry.get('handlingPreset'));
  panel.setViewLabel(projection.viewLabel);
  ui.events.once('shutdown', () => panel.destroy());
  PlatformManager.getStoredValue(STORAGE_KEYS.handlingPreset, null).then((saved) => {
    if (saved && HANDLING_PRESETS[saved]) selectPreset(saved, false);
  });
  PlatformManager.getStoredValue(STORAGE_KEYS.view, null).then((viewId) => {
    if (findView(viewId)) setView(viewId, false);
  });

  const describeRun = () => {
    const state = world.getDebugState();
    if (state.turntable) {
      const deg = Math.round(((state.heading * 180) / Math.PI + 360) % 360);
      return `Turntable · facing ${deg}° (${compassName(deg)}) · hold ← → to turn · T to drive`;
    }
    return [
      HANDLING_PRESETS[state.preset]?.label ?? state.preset,
      state.mode,
      `speed ${Math.round(state.speed)}`,
      `police ${state.police}`,
      `${Math.round(ui.game.loop.actualFps)} fps`,
    ].join(' · ');
  };

  return {
    update(time) {
      if (time < nextReadoutAt) return;
      nextReadoutAt = time + DEV_PANEL.readoutRefreshMs;
      panel.setReadout(describeRun());
    },
  };
}

function compassName(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
