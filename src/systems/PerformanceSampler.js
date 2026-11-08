// Measures how smoothly the game runs during play, for Playgama's telemetry (event `performance_sample`). Frames count
// only while a run is on screen: menus, the pause menu, a platform pause and a hidden page break the chain, so a gap
// is never taken for a slow frame. About every 30 s of play it hands back one summary of timings and counts. No player
// data, messages or addresses. Pure: the caller passes the time and says whether play is active.
import { PERF_SAMPLE } from '../config/tuning.js';

/* global __GAME_VERSION__ */
const VERSION = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';

const round = (value) => Math.round(value * 10) / 10;

export class PerformanceSampler {
  constructor() {
    this.times = new Float32Array(PERF_SAMPLE.maxFrames);
    this.last = null;
    this.errors = 0;
    this.rejections = 0;
    this.contextLosses = 0;
    this.quality = 0; // the AutoQuality level the phone is on
    this.startWindow(null);
  }

  startWindow(now) {
    this.windowStart = now;
    this.activeMs = 0;
    this.frames = 0;
    this.kept = 0;
    this.longest = 0;
    this.slow = PERF_SAMPLE.slowFrameMs.map(() => 0);
  }

  // Play stopped for a moment (paused, hidden, a menu): the next frame starts a new chain.
  gap() {
    this.last = null;
  }

  // Once a frame. Returns a summary when one is due, otherwise null.
  frame(now, active) {
    if (!active) {
      this.last = null;
      return null;
    }
    if (this.windowStart === null) this.windowStart = now;
    if (this.last !== null) this.record(now - this.last);
    this.last = now;
    return this.activeMs >= PERF_SAMPLE.everyMs ? this.take(now) : null;
  }

  record(ms) {
    this.activeMs += ms;
    this.frames += 1;
    if (this.kept < this.times.length) this.times[this.kept++] = ms;
    if (ms > this.longest) this.longest = ms;
    PERF_SAMPLE.slowFrameMs.forEach((limit, i) => {
      if (ms > limit) this.slow[i] += 1;
    });
  }

  // The summary for this window, then a fresh window. Error counts are those since the last summary.
  take(now) {
    if (this.frames === 0) return null;
    const sorted = this.times.slice(0, this.kept).sort();
    const at = (share) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
    const sample = {
      target_fps: PERF_SAMPLE.targetFps,
      window_ms: Math.round(now - this.windowStart),
      active_ms: Math.round(this.activeMs),
      frame_count: this.frames,
      fps_avg: round((this.frames * 1000) / this.activeMs),
      fps_p10: round(1000 / Math.max(at(0.9), 0.1)), // the slowest tenth of frames
      frame_time_p50_ms: round(at(0.5)),
      frame_time_p95_ms: round(at(0.95)),
      frame_time_p99_ms: round(at(0.99)),
      frame_time_max_ms: round(this.longest),
      js_error_count: this.errors,
      unhandled_rejection_count: this.rejections,
      webgl_context_loss_count: this.contextLosses,
      quality_level: this.quality,
      game_version: VERSION,
    };
    PERF_SAMPLE.slowFrameMs.forEach((limit, i) => {
      sample[`frames_over_${limit}ms`] = this.slow[i];
    });
    this.errors = 0;
    this.rejections = 0;
    this.contextLosses = 0;
    this.startWindow(now);
    return sample;
  }

  // Counts (never the messages) of script errors, failed promises and a lost WebGL picture.
  watchErrors(canvas) {
    window.addEventListener('error', () => (this.errors += 1));
    window.addEventListener('unhandledrejection', () => (this.rejections += 1));
    if (canvas) canvas.addEventListener('webglcontextlost', () => (this.contextLosses += 1));
  }
}
