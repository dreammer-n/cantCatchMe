import { AUDIO } from '../config/tuning.js';
import { clamp } from '../utils/math.js';

const ASSETS = './assets/'; // relative, like everything else: no outside requests

// All game sound, every bit of it from the files in public/assets listed in AUDIO: nothing is made up in code
// (Playgama turns down a game whose sound is synthesised). A file that fails to load is simply not heard.
//   Music: the menu track is decoded and overlaps itself where it repeats, so no gap can be heard. The chase track
//   is three minutes long, about 70 MB once decoded, so it streams from an audio element instead.
//   Continuous: engine (pitch follows speed), tire squeal (follows sliding), police siren (louder when police are
//   close), helicopter.
//
// Browsers only allow sound after the player touches or presses something, so the audio
// starts in unlock(), called from the first input. The effects and the music each have their own setting, and both
// need the platform to allow audio and not to have paused the game. The pause menu is different: the music carries
// on, a little quieter, and only the sounds of the road stop.
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.soundOn = true; // in-game setting: the effects
    this.musicOn = true; // in-game setting: the music
    this.platformAllowed = true; // platform mute always wins
    this.paused = false; // in-game pause menu: the music dips
    this.platformPaused = false; // tab hidden / platform pause / an advert
    this.cooldowns = new Map();
    this.track = null; // the music wanted now: 'menu', 'chase' or null
    this.buffers = new Map();
    this.menuNextAt = 0;
    this.chase = null;
    this.chasePrimed = false;
    this.chasePriming = false;
    this.engine = null; // the engine loop, whose speed sets its pitch
    // Fetched now, so the sound is ready at the first touch; decoded once there is a context to do it with.
    this.downloads = new Map();
    const fetchFile = (name, path) => this.downloads.set(name, fetch(ASSETS + path).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
    fetchFile('menu', AUDIO.music.menu);
    for (const [name, file] of Object.entries(AUDIO.files)) fetchFile(name, file.path);
  }

  get audible() {
    return (this.soundOn || this.musicOn) && this.platformAllowed && !this.platformPaused;
  }

  unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContextClass();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended' && this.audible) this.ctx.resume().catch(() => {});
    this.primeChase();
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.audible ? AUDIO.master : 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    this.master.connect(limiter).connect(ctx.destination);
    // The two things a player can turn off on their own.
    this.effects = ctx.createGain();
    this.effects.gain.value = this.soundOn ? 1 : 0;
    this.effects.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 1 : 0;
    this.music.connect(this.master);

    // The looping effects are started when their files are ready. These hold their volumes.
    this.loops = {
      engine_loop: this.outputGain(this.effects),
      tire_squeal: this.outputGain(this.effects),
      siren: this.outputGain(this.effects),
      helicopter_loop: this.outputGain(this.effects),
    };

    // Music.
    this.menuGain = this.outputGain(this.music);
    this.chaseGain = this.outputGain(this.music);
    this.chase = new Audio(ASSETS + AUDIO.music.chase);
    this.chase.loop = true;
    this.chase.preload = 'auto';
    ctx.createMediaElementSource(this.chase).connect(this.chaseGain);
    this.setMusic(this.track);

    for (const [name, download] of this.downloads) {
      download
        .then((bytes) => (bytes ? ctx.decodeAudioData(bytes) : null))
        .then((buffer) => {
          if (!buffer) return;
          this.buffers.set(name, buffer);
          if (!this.loops[name]) return;
          const source = this.startLoop(buffer, this.loops[name]);
          if (name === 'engine_loop') this.engine = source;
        })
        .catch(() => {});
    }
    this.downloads.clear();
  }

  outputGain(bus) {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    return gain;
  }

  // Runs for good; its volume decides whether it is heard. Skips the silence an MP3 has at each end.
  startLoop(buffer, gain) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = AUDIO.loopTrim;
    source.loopEnd = buffer.duration - AUDIO.loopTrim;
    source.connect(gain);
    source.start(0, AUDIO.loopTrim);
    return source;
  }

  // A phone only lets an audio element play if it was first started by the player's own touch, and the chase track
  // starts in response to a button press that may not count. So it is started once, silently, at the first touch
  // that does count, and paused again unless it is wanted.
  primeChase() {
    if (!this.chase || this.chasePrimed || this.chasePriming) return;
    this.chasePriming = true;
    this.chase
      .play()
      .then(() => {
        this.chasePrimed = true;
        this.syncChase();
      })
      .catch(() => {})
      .finally(() => {
        this.chasePriming = false;
      });
  }

  // The chase track plays only while it can be heard, so a pause or mute stops it for real.
  syncChase() {
    if (!this.chase) return;
    if (this.track === 'chase' && this.musicOn && this.audible) this.chase.play().catch(() => {});
    else this.chase.pause();
  }

  // 'menu', 'chase' or null. The old track fades out as the new one fades in. The chase track carries on from
  // where it stopped, so that quick retries don't keep hearing its first seconds.
  setMusic(track) {
    this.track = track;
    if (!this.ctx) return;
    this.applyMusicLevels();
    clearTimeout(this.chaseStop);
    if (track === 'chase') this.syncChase();
    else this.chaseStop = setTimeout(() => this.syncChase(), AUDIO.musicFade * 5000);
  }

  applyMusicLevels() {
    const now = this.ctx.currentTime;
    const dip = this.paused ? AUDIO.musicDim : 1;
    this.menuGain.gain.setTargetAtTime(this.track === 'menu' ? AUDIO.menuMusic * dip : 0, now, AUDIO.musicFade);
    this.chaseGain.gain.setTargetAtTime(this.track === 'chase' ? AUDIO.chaseMusic * dip : 0, now, AUDIO.musicFade);
  }

  // Lays the next pass of the menu track over the end of the last one. Does nothing unless it is wanted, and
  // picks up where it left off if an earlier pass is still sounding.
  scheduleMenu(now) {
    const buffer = this.buffers.get('menu');
    if (!buffer || this.track !== 'menu' || !this.musicOn) return;
    if (this.menuNextAt < now) this.menuNextAt = now;
    if (this.menuNextAt > now + AUDIO.musicLookAhead) return;
    const at = this.menuNextAt;
    const overlap = AUDIO.menuOverlap;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + overlap);
    gain.gain.setValueAtTime(1, at + buffer.duration - overlap);
    gain.gain.linearRampToValueAtTime(0, at + buffer.duration);
    source.connect(gain).connect(this.menuGain);
    source.start(at);
    this.menuNextAt = at + buffer.duration - overlap;
  }

  setSoundOn(on) {
    this.soundOn = on;
    this.applyMaster();
  }

  setMusicOn(on) {
    this.musicOn = on;
    this.applyMaster();
  }

  setPlatformAllowed(allowed) {
    this.platformAllowed = allowed;
    this.applyMaster();
  }

  // The game stops, so the sounds of the road do too: nothing updates them while it is stopped.
  setPaused(paused) {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) this.quiet();
    this.applyMusicLevels();
  }

  setPlatformPaused(paused) {
    this.platformPaused = paused;
    this.applyMaster();
  }

  applyMaster() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.audible ? AUDIO.master : 0, now, 0.03);
    this.effects.gain.setTargetAtTime(this.soundOn ? 1 : 0, now, 0.03);
    this.music.gain.setTargetAtTime(this.musicOn ? 1 : 0, now, 0.03);
    this.syncChase();
    // Starting the audio takes a moment, so what was asked for may have changed by the time it has happened.
    if (this.audible && this.ctx.state === 'suspended') this.ctx.resume().then(() => this.suspendIfSilent()).catch(() => {});
    // Let the fade finish, then stop the audio clock entirely (saves battery while paused).
    if (!this.audible) setTimeout(() => this.suspendIfSilent(), 150);
  }

  suspendIfSilent() {
    if (!this.audible && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  // Called every frame. state: { driving, speed (share of top speed), slip (sideways units/s), sirenDistance,
  // helicopter }
  update(dt, state) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.scheduleMenu(now);

    const speed = state.driving ? clamp(state.speed, 0, 1) : 0;
    this.loops.engine_loop.gain.setTargetAtTime(state.driving ? AUDIO.engine.volume : 0, now, 0.15);
    if (this.engine) this.engine.playbackRate.setTargetAtTime(AUDIO.engine.pitch[0] + (AUDIO.engine.pitch[1] - AUDIO.engine.pitch[0]) * speed, now, 0.1);

    const slip = state.driving ? clamp((state.slip - 70) / 180, 0, 1) : 0;
    this.loops.tire_squeal.gain.setTargetAtTime(slip * AUDIO.skid, now, 0.05);

    const near = clamp(1 - state.sirenDistance / AUDIO.sirenRange, 0, 1);
    this.loops.siren.gain.setTargetAtTime(near * near * AUDIO.siren, now, 0.15);
    this.loops.helicopter_loop.gain.setTargetAtTime(state.helicopter ? AUDIO.helicopter : 0, now, 0.4);
  }

  // Stops the continuous sounds (menus, game over). The music is left to setMusic.
  quiet() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const gain of Object.values(this.loops)) gain.gain.setTargetAtTime(0, now, 0.1);
  }

  // One-shot sound effects, by their name in AUDIO.files. volume 0..1 (e.g. quieter for far-away crashes).
  // file.vary: changes the pitch a little each time, so a sound heard often doesn't get tiring.
  play(name, volume = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || volume <= 0.01) return;
    const file = AUDIO.files[name];
    const buffer = this.buffers.get(name);
    if (!file || !buffer) return;
    const now = this.ctx.currentTime;
    if (file.cooldown && now - (this.cooldowns.get(name) ?? -Infinity) < file.cooldown) return;
    this.cooldowns.set(name, now);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (file.vary) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * file.vary;
    const gain = this.ctx.createGain();
    gain.gain.value = file.volume * clamp(volume, 0, 1);
    source.connect(gain).connect(this.effects);
    source.start(now);
  }
}
