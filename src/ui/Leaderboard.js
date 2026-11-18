import { LEADERBOARD } from '../config/tuning.js';
import { PlatformManager } from '../platform/PlatformManager.js';
import { Records } from '../systems/ScoreSystem.js';
import { Settings } from '../systems/Settings.js';
import { LeaderboardScreen } from './Screens.js';

// The HARD START leaderboard, opened from the title or the results (owner, 2026-11-18: Playgama's moderators could
// not find it, as a new player starts on the road and only reaches the title after a run). Where the platform has
// its own window (native_popup) that opens; otherwise the game's own screen, over the one it was opened from.
let screen = null;
let afterClose = null;

// Is there a leaderboard to show on this platform?
export function boardAvailable() {
  const mode = PlatformManager.leaderboardMode();
  return mode === 'in_game' || mode === 'native_popup';
}

export function boardOpen() {
  return Boolean(screen && !screen.node.hidden);
}

// under: the Screen it opens over (hidden meanwhile, shown again by BACK); onClosed: called after BACK.
export async function openLeaderboard({ under, audio, onClosed = null }) {
  audio.unlock();
  audio.play('click');
  if (PlatformManager.leaderboardMode() === 'native_popup') {
    PlatformManager.showLeaderboard(LEADERBOARD.id);
    return;
  }
  if (!screen) {
    screen = new LeaderboardScreen({
      onClose: () => closeLeaderboard(),
      onHardStart: () => {
        if (!Settings.hardStart) Settings.setHardStart(true);
        screen.setHardOn(true);
      },
    });
  }
  afterClose = () => {
    audio.play('click');
    under.node.hidden = false;
    if (onClosed) onClosed();
  };
  under.hide();
  screen.showLoading(Records.hardBest, Settings.hardStart);
  const entries = await PlatformManager.leaderboardEntries(LEADERBOARD.id);
  if (!screen.node.hidden) screen.showEntries(entries, LEADERBOARD.shown);
}

function closeLeaderboard() {
  screen.hide();
  const done = afterClose;
  afterClose = null;
  if (done) done();
}
