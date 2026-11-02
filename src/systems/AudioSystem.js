import { AUDIO } from '../config/tuning.js';
import { clamp } from '../utils/math.js';

const ASSETS = './assets/'; // relative, like everything else: no outside requests

// All game sound. Music and the bigger effects are files in public/assets, listed in AUDIO; the small
// everyday ones (bumps, clicks, near misses, pickups, tire squeal, explosions) are synthesised with the Web Audio
// API. A file that fails to load falls back to a synthesised sound, so the game always plays.
//   Music: the menu track is decoded and overlaps itself where it repeats, so no gap can be heard. The chase track
//   is three minutes long, about 70 MB once decoded, so it streams from an audio element instead.
//   Continuous: tire squeal (follows sliding), police siren (louder when police are close), helicopter.
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
    this.platformPaused = false; // tab hidden / platform pause
    this.cooldowns = new Map();
    this.track = null; // the music wanted now: 'menu', 'chase' or null
    this.buffers = new Map();
    this.menuNextAt = 0;
    this.chase = null;
    this.chasePrimed = false;
    this.chasePriming = false;
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

    // White noise, shared by the squeal, crashes and whooshes.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    // Tire squeal: band-passed noise.
    const squeal = ctx.createBufferSource();
    squeal.buffer = this.noise;
    squeal.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1700;
    band.Q.value = 1.2;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    squeal.connect(band).connect(this.skidGain).connect(this.effects);
    squeal.start();

    // The looping effects are started when their files are ready. These hold their volumes.
    this.sirenGain = this.outputGain(this.effects);
    this.helicopterGain = this.outputGain(this.effects);

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
          if (name === 'siren') this.startLoop(buffer, this.sirenGain);
          if (name === 'helicopter_loop') this.startLoop(buffer, this.helicopterGain);
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

  // Called every frame. state: { driving, slip (sideways units/s), sirenDistance, helicopter }
  update(dt, state) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.scheduleMenu(now);

    const slip = state.driving ? clamp((state.slip - 70) / 180, 0, 1) : 0;
    this.skidGain.gain.setTargetAtTime(slip * AUDIO.skid, now, 0.05);

    const near = clamp(1 - state.sirenDistance / AUDIO.sirenRange, 0, 1);
    this.sirenGain.gain.setTargetAtTime(near * near * AUDIO.siren, now, 0.15);
    this.helicopterGain.gain.setTargetAtTime(state.helicopter ? AUDIO.helicopter : 0, now, 0.4);
  }

  // Stops the continuous sounds (menus, game over). The music is left to setMusic.
  quiet() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const gain of [this.skidGain, this.sirenGain, this.helicopterGain]) gain.gain.setTargetAtTime(0, now, 0.1);
  }

  // One-shot sound effects. volume 0..1 (e.g. quieter for far-away explosions).
  play(name, volume = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || volume <= 0.01) return;
    const file = AUDIO.files[name];
    const buffer = this.buffers.get(name);
    if (file && !buffer) {
      if (file.fallback) this.play(file.fallback, volume); // not loaded, or it failed to
      return;
    }
    const limit = file ? file.cooldown || 0 : SOUND_COOLDOWNS[name] || 0;
    const now = this.ctx.currentTime;
    if (limit && now - (this.cooldowns.get(name) ?? -Infinity) < limit) return;
    this.cooldowns.set(name, now);
    const v = clamp(volume, 0, 1);
    if (file) {
      this.playFile(file, buffer, now, v);
      return;
    }
    switch (name) {
      case 'explosion':
        this.noiseHit(now, 0.7 * v, 1600, 120, 0.7);
        this.tone(now, 'sine', 95, 38, 0.45 * v, 0.5);
        break;
      case 'crash':
        this.noiseHit(now, 0.9 * v, 2400, 150, 0.9);
        this.tone(now, 'sine', 80, 30, 0.6 * v, 0.7);
        this.tone(now + 0.35, 'triangle', 520, 300, 0.12 * v, 0.6); // descending "busted" tone
        break;
      case 'bump':
        this.noiseHit(now, 0.35 * v, 700, 200, 0.14);
        break;
      case 'cone':
        this.tone(now, 'triangle', 540, 360, 0.18 * v, 0.07);
        break;
      case 'nearMiss':
        this.noiseSweep(now, 0.3 * v, 3200, 700, 0.35);
        break;
      case 'pickup':
        this.tone(now, 'sine', 660, 660, 0.22 * v, 0.09);
        this.tone(now + 0.08, 'sine', 990, 990, 0.22 * v, 0.14);
        break;
      case 'pulse':
        this.tone(now, 'sine', 900, 110, 0.4 * v, 0.55);
        this.noiseSweep(now, 0.35 * v, 1800, 200, 0.6);
        break;
      case 'start':
        this.tone(now, 'square', 440, 440, 0.07 * v, 0.1);
        this.tone(now + 0.12, 'square', 660, 660, 0.07 * v, 0.16);
        break;
      case 'click':
        this.tone(now, 'square', 1100, 900, 0.05 * v, 0.04);
        break;
      default:
        break;
    }
  }

  // file.vary: changes the pitch a little each time, so a sound heard often doesn't get tiring.
  playFile(file, buffer, now, v) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (file.vary) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * file.vary;
    const gain = this.ctx.createGain();
    gain.gain.value = file.volume * v;
    source.connect(gain).connect(this.effects);
    source.start(now);
  }

  tone(at, type, from, to, volume, seconds) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + seconds);
    const gain = this.envelope(at, volume, seconds);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }

  noiseHit(at, volume, from, to, seconds) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);
    source.connect(filter).connect(this.envelope(at, volume, seconds));
    source.start(at, Math.random() * 0.5);
    source.stop(at + seconds + 0.05);
  }

  noiseSweep(at, volume, from, to, seconds) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);
    source.connect(filter).connect(this.envelope(at, volume, seconds, 0.05));
    source.start(at, Math.random() * 0.5);
    source.stop(at + seconds + 0.05);
  }

  // Quick attack, smooth decay. Returns the gain node (already connected to the output).
  envelope(at, volume, seconds, attack = 0.005) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    gain.connect(this.effects);
    return gain;
  }
}

// Minimum seconds between two of the same sound (stops a pile-up from becoming noise).
const SOUND_COOLDOWNS = { bump: 0.15, cone: 0.06, explosion: 0.07, nearMiss: 0.3 };
