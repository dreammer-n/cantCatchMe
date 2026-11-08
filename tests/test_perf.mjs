// Checks for the frame-rate report (performance_sample): only play counts, gaps are never slow frames, the summary
// has every field Playgama's guide asks for, and its numbers are right.
import { PerformanceSampler } from '../src/systems/PerformanceSampler.js';
import { PERF_SAMPLE, QUALITY } from '../src/config/tuning.js';
import { AutoQuality } from '../src/systems/AutoQuality.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (ok) pass += 1;
  else fail += 1;
}

// Plays frames of the given lengths; returns the summaries handed back.
function play(sampler, start, frames, active = true) {
  let now = start;
  const samples = [];
  sampler.frame(now, active);
  for (const ms of frames) {
    now += ms;
    const sample = sampler.frame(now, active);
    if (sample) samples.push(sample);
  }
  return { now, samples };
}

{
  const sampler = new PerformanceSampler();
  const { samples } = play(sampler, 1000, new Array(1700).fill(1000 / 60));
  check('nothing is sent before 30 s of play', samples.length === 0);
  sampler.gap(); // a pause of ~70 s (the game loop asleep), then more play
  const more = play(sampler, 1e5, new Array(200).fill(1000 / 60));
  check('one summary after 30 s of play', more.samples.length === 1);
  const s = more.samples[0];
  const fields = [
    'target_fps', 'window_ms', 'active_ms', 'frame_count', 'fps_avg', 'fps_p10', 'frame_time_p50_ms', 'frame_time_p95_ms',
    'frame_time_p99_ms', 'frame_time_max_ms', 'frames_over_50ms', 'frames_over_100ms', 'frames_over_250ms',
    'frames_over_500ms', 'frames_over_1000ms', 'game_version', 'js_error_count', 'unhandled_rejection_count',
    'webgl_context_loss_count',
  ];
  check('the summary has every field', fields.every((f) => f in s), fields.filter((f) => !(f in s)).join(','));
  check('values are flat numbers or strings', Object.values(s).every((v) => typeof v === 'number' || typeof v === 'string'));
  check('a steady 60 fps reads as 60', Math.abs(s.fps_avg - 60) < 0.5 && Math.abs(s.fps_p10 - 60) < 0.5, `${s.fps_avg} ${s.fps_p10}`);
  check('the gap between the two stretches is not a slow frame', s.frames_over_50ms === 0 && s.frame_time_max_ms < 17, `max ${s.frame_time_max_ms}`);
  check('active time is play only, the window is wall-clock', s.active_ms >= 30000 && s.active_ms < 31000 && s.window_ms > 90000, `${s.active_ms} ${s.window_ms}`);
  check('the target is 60', s.target_fps === PERF_SAMPLE.targetFps);
}

{
  const sampler = new PerformanceSampler();
  // 30 s with hitches: one 120 ms, one 600 ms, 2% of frames at 40 ms.
  const frames = [];
  for (let i = 0; i < 1750; i += 1) frames.push(i % 50 === 0 ? 40 : 1000 / 60);
  frames.splice(500, 0, 120);
  frames.splice(900, 0, 600);
  const { samples } = play(sampler, 0, frames);
  const s = samples[0];
  check('slow frames are counted at each limit', s.frames_over_50ms === 2 && s.frames_over_100ms === 2 && s.frames_over_250ms === 1 && s.frames_over_500ms === 1 && s.frames_over_1000ms === 0, JSON.stringify([s.frames_over_50ms, s.frames_over_100ms, s.frames_over_250ms, s.frames_over_500ms]));
  check('the longest frame is reported', s.frame_time_max_ms === 600);
  check('the median stays at a 60 fps frame', Math.abs(s.frame_time_p50_ms - 16.7) < 0.1, `${s.frame_time_p50_ms}`);
  check('p99 shows the 40 ms frames', s.frame_time_p99_ms === 40, `${s.frame_time_p99_ms}`);
  check('the average is lower than 60', s.fps_avg < 58, `${s.fps_avg}`);
}

{
  const sampler = new PerformanceSampler();
  play(sampler, 0, new Array(600).fill(1000 / 60)); // 10 s of play
  sampler.frame(20000, false); // a menu
  sampler.frame(40000, false);
  sampler.gap();
  const { samples } = play(sampler, 50000, new Array(1250).fill(1000 / 60)); // 20.8 s more
  check('play is added up across runs, menus left out', samples.length === 1 && samples[0].frames_over_1000ms === 0 && samples[0].active_ms < 31000);
}

{
  const sampler = new PerformanceSampler();
  sampler.errors = 2;
  sampler.rejections = 1;
  const first = play(sampler, 0, new Array(1810).fill(1000 / 60)).samples[0];
  const second = play(sampler, 1e6, new Array(1810).fill(1000 / 60)).samples[0];
  check('error counts are per window', first.js_error_count === 2 && first.unhandled_rejection_count === 1 && second.js_error_count === 0);
}

{
  const sampler = new PerformanceSampler();
  const { samples } = play(sampler, 0, new Array(10100).fill(3)); // 333 fps: more frames than are kept
  check('very fast screens are still summed right', samples.length === 1 && samples[0].frame_count >= 10000 && samples[0].fps_avg > 330, JSON.stringify(samples.map((s) => [s.frame_count, s.fps_avg])));
}

// AutoQuality: only a slow phone steps down, one level per check, never past the last.
function drive(q, frameMs, seconds, start = 0) {
  const levels = [];
  let now = start;
  q.frame(now, true);
  for (let t = 0; t < seconds * 1000; t += frameMs) {
    now += frameMs;
    const level = q.frame(now, true);
    if (level !== null) levels.push(level);
  }
  return levels;
}
{
  const fast = new AutoQuality(0);
  check('a phone at 60 fps is never touched', drive(fast, 1000 / 60, 60).length === 0 && fast.level === 0);
  const fine = new AutoQuality(0);
  check('nor one at 50 fps', drive(fine, 20, 60).length === 0);
  const slow = new AutoQuality(0);
  const steps = drive(slow, 1000 / 30, 9);
  check('at 30 fps it steps down after one check', steps.length === 1 && steps[0] === 1, JSON.stringify(steps));
  slow.gap();
  const more = drive(slow, 1000 / 30, 60, 1e6);
  check('and once more if still slow, then stops at the last level', more.length === 1 && slow.level === QUALITY.levels.length - 1, JSON.stringify(more));
  const hitches = new AutoQuality(0);
  let now = 0;
  hitches.frame(now, true);
  let stepped = false;
  for (let i = 0; i < 600; i += 1) {
    now += i % 60 === 0 ? 900 : 1000 / 60; // a long one-off frame every second
    if (hitches.frame(now, true) !== null) stepped = true;
  }
  check('one-off hitches are not taken for a slow phone', !stepped);
  const crawling = new AutoQuality(0);
  check('a phone crawling at 3 fps steps down too', drive(crawling, 330, 10).length === 1);
  const menus = new AutoQuality(0);
  menus.frame(0, true);
  menus.frame(16, false);
  check('menus and pauses are not measured', menus.frame(60000, true) === null && menus.ms === 0);
  check('a saved level is kept, within range', new AutoQuality(2).level === 2 && new AutoQuality(9).level === QUALITY.levels.length - 1);
  check('the first level is as designed', QUALITY.levels[0].pixelRatio === 2 && QUALITY.levels[0].effects === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
