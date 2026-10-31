import { AUDIO } from '../config/tuning.js';
import { clamp } from '../utils/math.js';

// All game sound is synthesised with the Web Audio API: no audio files to download.
// Continuous sounds: engine (pitch follows speed), tire squeal (follows sliding), police siren
// (louder when police are close). One-shots: crashes, explosions, pickups, menu clicks ...
//
// Browsers only allow sound after the player touches or presses something, so the audio
// starts in unlock(), called from the first input. Sound plays only when the in-game setting
// is on AND the platform allows audio AND the game isn't paused.
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.soundOn = true; // in-game setting
    this.platformAllowed = true; // platform mute always wins
    this.paused = false; // in-game pause menu
    this.platformPaused = false; // tab hidden / platform pause
    this.cooldowns = new Map();
    this.sirenPhase = 0;
  }

  get audible() {
    return this.soundOn && this.platformAllowed && !this.paused && !this.platformPaused;
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
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.audible ? AUDIO.master : 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    this.master.connect(limiter).connect(ctx.destination);

    // White noise, shared by the squeal, crashes and whooshes.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    // Engine: two detuned oscillators through a low-pass filter.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOscs = ['sawtooth', 'square'].map((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60;
      osc.detune.value = i * 9;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.6 : 0.25;
      osc.connect(g).connect(this.engineFilter);
      osc.start();
      return osc;
    });

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
    squeal.connect(band).connect(this.skidGain).connect(this.master);
    squeal.start();

    // Siren: a triangle wave whose pitch wails up and down.
    this.siren = ctx.createOscillator();
    this.siren.type = 'triangle';
    this.siren.frequency.value = 700;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.siren.connect(this.sirenGain).connect(this.master);
    this.siren.start();
  }

  setSoundOn(on) {
    this.soundOn = on;
    this.applyMaster();
  }

  setPlatformAllowed(allowed) {
    this.platformAllowed = allowed;
    this.applyMaster();
  }

  setPaused(paused) {
    this.paused = paused;
    this.applyMaster();
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
    if (this.audible && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this.audible && this.ctx.state === 'running') {
      // Let the fade finish, then stop the audio clock entirely (saves battery while paused).
      setTimeout(() => {
        if (!this.audible && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
      }, 150);
    }
  }

  // Called every frame. state: { driving, speed (units/s), slip (sideways units/s), sirenDistance }
  update(dt, state) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const speed = clamp(state.speed / 330, 0, 1.2);
    const engineLevel = state.driving ? AUDIO.engine * (0.55 + 0.45 * speed) : 0;
    this.engineGain.gain.setTargetAtTime(engineLevel, now, 0.08);
    for (const osc of this.engineOscs) osc.frequency.setTargetAtTime(48 + speed * 95, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(380 + speed * 900, now, 0.08);

    const slip = state.driving ? clamp((state.slip - 70) / 180, 0, 1) : 0;
    this.skidGain.gain.setTargetAtTime(slip * AUDIO.skid, now, 0.05);

    this.sirenPhase += dt / AUDIO.sirenCycle;
    const wail = 0.5 - 0.5 * Math.cos(this.sirenPhase * Math.PI * 2);
    this.siren.frequency.setTargetAtTime(620 + wail * 380, now, 0.05);
    const near = clamp(1 - state.sirenDistance / AUDIO.sirenRange, 0, 1);
    this.sirenGain.gain.setTargetAtTime(near * near * AUDIO.siren, now, 0.15);
  }

  // Stops the continuous sounds (menus, game over).
  quiet() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const gain of [this.engineGain, this.skidGain, this.sirenGain]) gain.gain.setTargetAtTime(0, now, 0.1);
  }

  // One-shot sound effects. volume 0..1 (e.g. quieter for far-away explosions).
  play(name, volume = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || volume <= 0.01) return;
    const limit = SOUND_COOLDOWNS[name] || 0;
    const now = this.ctx.currentTime;
    if (limit && now - (this.cooldowns.get(name) || -1) < limit) return;
    this.cooldowns.set(name, now);
    const v = clamp(volume, 0, 1);
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
      case 'combo':
        this.tone(now, 'square', 520, 520, 0.08 * v, 0.07);
        this.tone(now + 0.07, 'square', 780, 780, 0.08 * v, 0.1);
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
    gain.connect(this.master);
    return gain;
  }
}

// Minimum seconds between two of the same sound (stops a pile-up from becoming noise).
const SOUND_COOLDOWNS = { bump: 0.15, cone: 0.06, explosion: 0.07, nearMiss: 0.3, combo: 0.2 };
