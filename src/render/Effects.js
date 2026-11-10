import * as Phaser from 'phaser';
import { DEPTH, EFFECTS, FLAMER, FREEZE, MAPS, PALETTE, RENDER } from '../config/tuning.js';
import { chunkPose, stepChunk, stepChunkTurn } from './Tumble.js';
import { DEBRIS, DEBRIS_KINDS, frameName, makeDebrisSheet, shardFrames } from './debrisModels.js';
import { lerp } from '../utils/math.js';
import { shadeColor } from './lowpoly.js';
import { projection } from './projection.js';
import { BLACKOUT } from '../config/tuning.js';
import { paintBlob, paintEmber, paintFireCore, paintGlow, paintPool, paintPuff, paintRing, paintScorch } from './softShapes.js';

const screen = { x: 0, y: 0 };
const CORE_SIZE = 128; // pixels across a fire core drawing
const shadowShift = { x: 0, y: 0 };
const CHUNK_KINDS = ['tire', 'door', 'hood', 'tire', 'panel', 'bumper', 'door'];
const PAINTED = new Set(['door', 'hood', 'panel']); // these are drawn pale, then tinted with the car's paint
const SCORCH_ALPHA = 0.85;

// Code-drawn particle textures (no image files). See softShapes.js.
export function makeEffectTextures(scene) {
  const make = (key, size, paint) => {
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.createCanvas(key, size, size);
    paint(texture.context, size);
    texture.refresh();
  };
  make('fx-glow', 64, paintGlow); // flashes, police lights, crate glow, soft shadows
  make('fx-pool', 128, paintPool); // light on the ground
  make('fx-puff', 64, paintPuff); // smoke and flame clouds
  make('fx-core', CORE_SIZE, paintFireCore); // the heart of an explosion
  make('fx-ember', 16, paintEmber); // sparks
  make('fx-scorch', 128, paintScorch); // burns
  make('fx-ring', 128, paintRing); // a blast's ring along the ground
  make('fx-blob', 128, paintBlob); // soft patches on the ground: oil, ice (Scenery uses it too)
  makeDebrisSheet(scene);
  makeCloudSheet(scene);
  // Frost: a small four-pointed sparkle. White, tinted when used.
  make('fx-star', 28, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const reach = i % 2 === 0 ? 14 : 4;
      ctx.lineTo(14 + Math.cos(angle) * reach, 14 + Math.sin(angle) * reach);
    }
    ctx.closePath();
    ctx.fill();
  });
}

// A crash's puffs: crisp, irregular cartoon clouds, each a few overlapping bumps of white with a light grey
// underside, in CLOUD_FRAMES shapes side by side on one sheet (frames 0, 1, 2 ...). Not blurred: the edge is sharp.
const CLOUD_SIZE = 96;
const CLOUD_FRAMES = 4;
function makeCloudSheet(scene) {
  if (scene.textures.exists('fx-cloud')) return;
  const texture = scene.textures.createCanvas('fx-cloud', CLOUD_SIZE * CLOUD_FRAMES, CLOUD_SIZE);
  const ctx = texture.context;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let f = 0; f < CLOUD_FRAMES; f += 1) {
    const cx = f * CLOUD_SIZE + CLOUD_SIZE / 2;
    const cy = CLOUD_SIZE / 2;
    const bumps = [{ x: 0, y: 0, r: 22 + rand() * 6 }];
    const count = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.8;
      const d = 12 + rand() * 8; // a bump reaches at most 20 + 20 (+4 of rim): inside the 48 of half a frame
      bumps.push({ x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85, r: 11 + rand() * 9 });
    }
    const paint = (dx, dy, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const b of bumps) {
        ctx.moveTo(cx + b.x + dx + b.r, cy + b.y + dy);
        ctx.arc(cx + b.x + dx, cy + b.y + dy, b.r, 0, Math.PI * 2);
      }
      ctx.fill();
    };
    paint(2, 4, '#d9dadd'); // the shaded underside shows as a rim below the white
    paint(-1, -1, '#ffffff');
    texture.add(f, 0, f * CLOUD_SIZE, 0, CLOUD_SIZE, CLOUD_SIZE);
  }
  texture.refresh();
}

// Soft smoke, fireballs and embers, solid flying wreckage, flames, burns and rings. Every effect has a fixed
// budget (EFFECTS) so a big pile-up can't slow a phone down.
// Particles live in screen space (positions come through the projection); scorch marks and the
// shockwave ring lie flat on the ground (ground layer, world coordinates).
export class Effects {
  constructor(scene, layers) {
    this.scene = scene;
    makeEffectTextures(scene);
    const base = { emitting: false };
    // Puffs swell quickly, hold, and then fade: thick cartoon cloud, not haze.
    this.smoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 460, max: 820 },
        speedX: { min: -16, max: 16 },
        speedY: { min: -30, max: -8 },
        scale: { start: 0.28, end: 0.95, ease: 'Quad.easeOut' },
        alpha: { start: 0.9, end: 0, ease: 'Cubic.easeIn' },
        rotate: { min: 0, max: 360 },
        tint: PALETTE.smoke,
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    // Tire smoke the colour of each map's ground (MAPS tireDust), and what the tires throw up with it: grains of
    // sand, clods of mud (snow uses the COLD SNAP flakes).
    this.tireSmokes = new Map(
      MAPS.map((map) => [
        map.id,
        // Crisp, bright little clouds like a crash's puffs (fx-cloud), in the ground's colour.
        scene.add
          .particles(0, 0, 'fx-cloud', {
            ...base,
            frame: Array.from({ length: CLOUD_FRAMES }, (_, f) => f),
            lifespan: { min: 520, max: 900 },
            speedX: { min: -18, max: 18 },
            speedY: { min: -30, max: -8 },
            scale: { start: 0.16, end: 0.62, ease: 'Quad.easeOut' },
            alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' },
            tint: map.tireDust.tint,
            maxAliveParticles: EFFECTS.maxSmoke,
          })
          .setDepth(DEPTH.effects),
      ]),
    );
    const grains = (tint) =>
      scene.add
        .particles(0, 0, 'fx-ember', {
          ...base,
          lifespan: { min: 300, max: 600 },
          speed: { min: 60, max: 170 },
          angle: { min: 200, max: 340 },
          gravityY: 700,
          scale: { start: 0.4, end: 0.25 },
          tint,
          maxAliveParticles: EFFECTS.maxGrains,
        })
        .setDepth(DEPTH.effects + 1);
    this.grains = { sand: grains([0xd8b27a, 0xb88a52]), mud: grains([0x5f4630, 0x7a5b3b, 0x4a3a28]) };
    // Tiny flecks of snow thrown up by tires on Winter.
    this.snowBits = scene.add
      .particles(0, 0, 'fx-ember', {
        ...base,
        lifespan: { min: 260, max: 520 },
        speed: { min: 40, max: 140 },
        angle: { min: 200, max: 340 },
        gravityY: 520,
        scale: { start: 0.32, end: 0.12 },
        tint: [0xffffff, 0xf2f8ff],
        maxAliveParticles: EFFECTS.maxGrains,
      })
      .setDepth(DEPTH.effects + 1);
    this.ground = null;
    // A crash's burst: crisp white cartoon puffs that pop out round the fireball, swell and are gone in half a
    // second. Not turned, so the grey underside stays underneath.
    this.blastSmoke = scene.add
      .particles(0, 0, 'fx-cloud', {
        ...base,
        frame: Array.from({ length: CLOUD_FRAMES }, (_, f) => f),
        lifespan: { min: 480, max: 820 },
        delay: { min: 40, max: 120 }, // the fireball shows first, then the puffs pop out round it
        speed: { min: 12, max: 55 }, // close together: one rounded cloud, not separate lumps
        angle: { min: 0, max: 360 },
        gravityY: -40,
        scale: { start: 0.45, end: 1.05, ease: 'Back.easeOut' },
        alpha: { start: 1, end: 0, ease: 'Expo.easeIn' },
        x: { min: -12, max: 12 },
        y: { min: -10, max: 10 },
        tint: EFFECTS.blastSmokeTints,
        maxAliveParticles: EFFECTS.maxBlastSmoke,
      })
      .setDepth(DEPTH.effects + 2);
    this.darkSmoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 1000, max: 1800 },
        delay: { min: 120, max: 380 }, // a blast's smoke comes as its flames die down
        speedX: { min: -24, max: 24 },
        speedY: { min: -78, max: -28 },
        scale: { start: 0.5, end: 2, ease: 'Quad.easeOut' },
        alpha: { start: 0.85, end: 0, ease: 'Quad.easeIn' },
        rotate: { min: 0, max: 360 },
        x: { min: -22, max: 22 },
        y: { min: -18, max: 18 },
        tint: [0xb9bbc0, 0xa3a6ac, 0xcfd1d5], // light grey: bright, never soot
        maxAliveParticles: EFFECTS.maxSmoke,
      })
      .setDepth(DEPTH.effects);
    // Thin smoke trailing off flying wreckage.
    this.chunkSmoke = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 260, max: 460 },
        speedY: { min: -18, max: -4 },
        scale: { start: 0.2, end: 0.5 },
        alpha: { start: 0.5, end: 0 },
        rotate: { min: 0, max: 360 },
        tint: [0xd0d2d6, 0xb8bbc0],
        maxAliveParticles: EFFECTS.maxChunkSmoke,
      })
      .setDepth(DEPTH.effects + 1);
    // Flame clouds: each starts white hot, turns yellow and orange, and burns out dark red.
    this.fireball = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 380, max: 700 }, // quick: the burst is over in well under a second
        x: { min: -26, max: 26 }, // spread at the start, or together they make a hard disc
        y: { min: -22, max: 22 },
        speed: { min: 18, max: 120 },
        angle: { min: 0, max: 360 },
        gravityY: -120,
        scale: { start: 0.7, end: 2.1, ease: 'Quad.easeOut' },
        alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' },
        rotate: { min: 0, max: 360 },
        color: [0xffffff, 0xfff6d0, 0xffd23a, 0xff8a1e, 0xffe9c8], // bright: white-hot, yellow, orange, then cream
        maxAliveParticles: EFFECTS.maxFireball,
      })
      .setDepth(DEPTH.effects + 1.5); // over the cores, so that its lumps are what shows
    // Embers thrown out of a blast: they fly, fall and burn out.
    this.fire = scene.add
      .particles(0, 0, 'fx-ember', {
        ...base,
        lifespan: { min: 320, max: 900 },
        speed: { min: 90, max: 380 },
        angle: { min: 0, max: 360 },
        gravityY: 300,
        scale: { start: 0.62, end: 0.05 },
        blendMode: Phaser.BlendModes.ADD,
        tint: [0xffffff, 0xfff1c0, 0xffd23a, 0xff9a2e],
        maxAliveParticles: EFFECTS.maxFire,
      })
      .setDepth(DEPTH.effects + 3); // with the flashes: light drawn together costs one blend change
    this.debris = scene.add
      .particles(0, 0, makeDebrisSheet(scene), {
        ...base,
        frame: shardFrames(),
        lifespan: { min: 350, max: 600 },
        speed: { min: 130, max: 300 },
        angle: { min: 200, max: 340 },
        gravityY: 1500,
        rotate: { start: 0, end: 540 },
        scale: { start: 0.62, end: 0.42 },
        tint: [0x9aa0a8, 0xc0c5cc, PALETTE.policeBody],
        maxAliveParticles: EFFECTS.maxDebris,
      })
      .setDepth(DEPTH.effects + 1);
    this.flames = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 300, max: 560 },
        speedX: { min: -12, max: 12 },
        speedY: { min: -90, max: -45 },
        scale: { start: 0.5, end: 0.1 },
        color: [0xfff1a0, 0xffb52e, 0xff7a18, 0xe8501c],
        maxAliveParticles: EFFECTS.maxFire,
      })
      .setDepth(DEPTH.effects + 1);

    this.flashes = Array.from({ length: 6 }, () =>
      scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.effects + 4).setVisible(false),
    );
    this.nextFlash = 0;

    this.bursts = Array.from({ length: EFFECTS.maxBursts }, () => scene.add.image(0, 0, 'fx-core').setDepth(DEPTH.effects + 1).setVisible(false));
    this.nextBurst = 0;

    this.chunks = Array.from({ length: EFFECTS.maxChunks }, () => ({
      image: scene.add.image(0, 0, makeDebrisSheet(scene), frameName(DEBRIS_KINDS[0], 0)).setScale(1 / DEBRIS.scale).setDepth(DEPTH.effects + 2).setVisible(false),
      // Without a shadow, nothing shows how high a piece is: from this camera it would seem to float.
      shadow: this.makeChunkShadow(scene, layers),
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
      angle: 0,
      age: 0,
    }));
    this.nextChunk = 0;

    this.rings = Array.from({ length: EFFECTS.maxRings }, () => {
      const ring = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lights.add(ring);
      return ring;
    });
    this.nextRing = 0;

    // The glow a blast throws across the ground, for a moment.
    this.blastGlows = Array.from({ length: EFFECTS.maxRings }, () => {
      const glow = scene.add.image(0, 0, 'fx-pool').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layers.lights.add(glow);
      return glow;
    });
    this.nextBlastGlow = 0;

    this.scorches = Array.from({ length: EFFECTS.maxScorch }, () => {
      const mark = scene.add.image(0, 0, 'fx-scorch').setTint(PALETTE.scorch).setVisible(false);
      layers.ground.add(mark);
      return { mark, age: 0 };
    });
    this.nextScorch = 0;

    // The wave a power-up sends out: a soft ring with a little light inside it.
    this.pulseFill = scene.add.image(0, 0, 'fx-pool').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.pulseRing = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    layers.lights.add(this.pulseFill);
    layers.lights.add(this.pulseRing);
    this.pulse = null;

    this.frost = scene.add
      .particles(0, 0, 'fx-star', {
        ...base,
        lifespan: { min: 320, max: 680 },
        speed: { min: 60, max: 260 },
        angle: { min: 0, max: 360 },
        rotate: { start: 0, end: 160 },
        scale: { start: 1.1, end: 0.1 },
        tint: [0xffffff, PALETTE.frost, PALETTE.ice],
        maxAliveParticles: EFFECTS.maxFrost,
      })
      .setDepth(DEPTH.effects + 1);

    // COLD SNAP: snowflakes flung out and drifting down, and clouds of powder snow.
    this.snow = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 1200, max: 2400 },
        speed: { min: 30, max: 300 },
        angle: { min: 0, max: 360 },
        gravityY: 55,
        scale: { start: 0.2, end: 0.07 },
        alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' },
        tint: [0xffffff, 0xf0f8ff, 0xd6ecfa],
        maxAliveParticles: EFFECTS.maxSnow,
      })
      .setDepth(DEPTH.effects + 1);
    // COLD SNAP's snow rides out on the ring: flakes and puffs of powder, each at its own share of the ring's
    // reach, gone when the ring is.
    this.ringSnow = Array.from({ length: EFFECTS.ringFlakes + EFFECTS.ringClouds }, (_, i) => ({
      image: scene.add.image(0, 0, 'fx-puff').setVisible(false).setDepth(DEPTH.effects + 1),
      cloud: i >= EFFECTS.ringFlakes,
      angle: 0,
      share: 1,
      z: 0,
      size: 1,
      alpha: 1,
    }));
    this.snowBlast = null;
    // BLACKOUT: electric sparks crackling over dead police cars.
    this.sparks = scene.add
      .particles(0, 0, 'fx-ember', {
        ...base,
        lifespan: { min: 160, max: 420 },
        speed: { min: 60, max: 280 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.7, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        tint: [0xffffff, 0xbfe9ff, PALETTE.emp],
        maxAliveParticles: EFFECTS.maxSparks,
      })
      .setDepth(DEPTH.effects + 3);
    // STONEWALL: lumps of road thrown up as the pillars burst through.
    this.rocks = scene.add
      .particles(0, 0, makeDebrisSheet(scene), {
        ...base,
        frame: shardFrames(),
        lifespan: { min: 500, max: 850 },
        speed: { min: 160, max: 380 },
        angle: { min: 205, max: 335 },
        gravityY: 1500,
        rotate: { start: 0, end: 420 },
        scale: { start: 0.9, end: 0.6 },
        tint: [0xc4beb3, 0xaaa499, 0xdcd6ca],
        maxAliveParticles: EFFECTS.maxRocks,
      })
      .setDepth(DEPTH.effects + 1);
    // A burst hydrant's fountain, and leaves, paper and splinters from things knocked flying.
    this.water = scene.add
      .particles(0, 0, 'fx-puff', {
        ...base,
        lifespan: { min: 550, max: 900 },
        speedX: { min: -70, max: 70 },
        speedY: { min: -340, max: -200 },
        gravityY: 760,
        scale: { start: 0.26, end: 0.12 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xffffff, PALETTE.water, 0x9fd4ff],
        maxAliveParticles: EFFECTS.maxWater,
      })
      .setDepth(DEPTH.effects);
    this.bits = scene.add
      .particles(0, 0, makeDebrisSheet(scene), {
        ...base,
        frame: shardFrames(),
        lifespan: { min: 400, max: 800 },
        speed: { min: 80, max: 240 },
        angle: { min: 200, max: 340 },
        gravityY: 900,
        rotate: { start: 0, end: 540 },
        scale: { start: 0.5, end: 0.3 },
        maxAliveParticles: EFFECTS.maxBits,
      })
      .setDepth(DEPTH.effects + 1);
    this.sprays = [];
    this.wetPatches = Array.from({ length: 6 }, () => {
      const image = scene.add.image(0, 0, 'fx-blob').setTint(PALETTE.wet).setVisible(false);
      layers.ground.add(image);
      return { image, age: 0 };
    });
    this.nextWet = 0;
    // COLD SNAP: ice spreading over the road.
    this.ice = Array.from({ length: EFFECTS.maxIce }, () => {
      const image = scene.add.image(0, 0, 'fx-blob').setTint(PALETTE.frost).setVisible(false);
      layers.ground.add(image);
      return { image, age: 0, seconds: 0, alpha: 0 };
    });

    // And one glow on the road per patch, all in the ground-lights layer.
    this.firePatches = Array.from({ length: FLAMER.maxPatches }, () => {
      const glow = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.fireGlow).setVisible(false);
      layers.lights.add(glow);
      return glow;
    });
  }

  // The map being driven: which tire smoke to use.
  setGround(map) {
    this.ground = map;
  }

  // Smoke and bits off a skidding tire, the colour of the ground.
  tireDust(x, y) {
    const map = this.ground || MAPS[0];
    projection.toScreen(x, y, 4, screen);
    this.tireSmokes.get(map.id).emitParticleAt(screen.x, screen.y, 1);
    const bits = map.tireDust.bits;
    if (!bits || Math.random() > EFFECTS.tireBitsChance) return;
    if (bits === 'snow') this.snowBits.emitParticleAt(screen.x, screen.y - 2, 3);
    else this.grains[bits].emitParticleAt(screen.x, screen.y, 2);
  }

  smokePuff(x, y, z = 4, dark = false) {
    projection.toScreen(x, y, z, screen);
    (dark ? this.darkSmoke : this.smoke).emitParticleAt(screen.x, screen.y, 1);
  }

  flame(x, y) {
    projection.toScreen(x, y, 18, screen);
    this.flames.emitParticleAt(screen.x + (Math.random() - 0.5) * 26, screen.y, 2);
  }

  // paint: the colour of the car that went up.
  explosion(x, y, big = false, paint = 0xffffff) {
    projection.toScreen(x, y, 14, screen);
    // A white flash, then a rolling ball of fire made of several overlapping cores and clouds that burn from
    // white to dark red, embers flying out, thick smoke climbing as the fire dies. The ground lights up, a ring
    // runs out along it, solid wreckage flies, and the road keeps a burn.
    const size = big ? EFFECTS.burstBig : EFFECTS.burstWreck;
    this.flash(screen.x, screen.y, big ? 8.5 : 6);
    this.burst(screen.x, screen.y, size * 0.8, 0, EFFECTS.coreFadeMs);
    for (let i = 0; i < EFFECTS.coresAround; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const reach = (size * CORE_SIZE) * (0.18 + Math.random() * 0.2);
      this.burst(screen.x + Math.cos(angle) * reach, screen.y + Math.sin(angle) * reach * 0.8 - reach * 0.2, size * (0.3 + Math.random() * 0.2), 40 + i * 60, EFFECTS.coreFadeMs, EFFECTS.coreOuterTint);
    }
    this.fireball.emitParticleAt(screen.x, screen.y, big ? 36 : 24);
    this.fire.emitParticleAt(screen.x, screen.y, big ? 30 : 20);
    this.debris.emitParticleAt(screen.x, screen.y, big ? 7 : 4);
    this.smokeCloud(x, y, big);
    this.blastGlow(x, y, big ? EFFECTS.ringRadiusBig * 1.5 : EFFECTS.ringRadius * 1.5);
    this.groundRing(x, y, big ? EFFECTS.ringRadiusBig : EFFECTS.ringRadius);
    this.throwChunks(x, y, big ? EFFECTS.chunksBig : EFFECTS.chunksSmall, paint);
    // No burn mark: a dark patch on the ground reads as black smoke (the owner wants no black after a crash).
  }

  // The big white cloud of a crash: a thick ball where it happened, and puffs rolling out along the ground.
  smokeCloud(x, y, big = false, scale = 1) {
    projection.toScreen(x, y, 16, screen);
    this.blastSmoke.emitParticleAt(screen.x, screen.y, Math.round((big ? EFFECTS.blastSmokeBig : EFFECTS.blastSmoke) * scale));
    const ring = Math.round(EFFECTS.blastRing * scale);
    const reach = (big ? 26 : 20) * Math.max(1, scale); // the ring's puffs overlap the middle ones
    for (let i = 0; i < ring; i += 1) {
      const a = (i / ring) * Math.PI * 2 + Math.random() * 0.4;
      projection.toScreen(x + Math.cos(a) * reach, y + Math.sin(a) * reach, 4, screen);
      this.blastSmoke.emitParticleAt(screen.x, screen.y, 1);
    }
  }

  // ---- Things knocked flying ----

  // A hydrant knocked over: water fountains up for a few seconds, and the road around gets wet.
  hydrantBurst(x, y, seconds) {
    this.sprays.push({ x, y, left: seconds });
    const wet = this.wetPatches[this.nextWet];
    this.nextWet = (this.nextWet + 1) % this.wetPatches.length;
    wet.age = 0;
    wet.image.setVisible(true).setPosition(x, y).setScale(0.6).setRotation(Math.random() * 6).setAlpha(0);
  }

  // Bits flying off something knocked: leaves, paper, splinters. colors: the tints to use.
  bitsBurst(x, y, colors, count = 10) {
    projection.toScreen(x, y, 10, screen);
    this.bits.setParticleTint(colors[Math.floor(Math.random() * colors.length)]);
    this.bits.emitParticleAt(screen.x, screen.y, count);
  }

  // A car goes into a river: a fountain of water and a ring of spray.
  splash(x, y) {
    projection.toScreen(x, y, 4, screen);
    this.water.emitParticleAt(screen.x, screen.y, 40);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      projection.toScreen(x + Math.cos(a) * 34, y + Math.sin(a) * 34, 2, screen);
      this.water.emitParticleAt(screen.x, screen.y, 2);
    }
  }

  // A car lands off a ramp.
  landing(x, y) {
    this.dustRing(x, y, 40, 8);
  }

  // ---- Power-ups ----

  // KABOOM: a bigger shockwave, a second ring behind it, the ground lit up, dust thrown round its edge, debris.
  kaboom(x, y, radius, seconds) {
    this.shockwave(x, y, radius, seconds);
    this.groundRing(x, y, radius * 1.15);
    this.blastGlow(x, y, radius * 1.3, PALETTE.pulse);
    this.dustRing(x, y, radius * 0.45, 14);
    this.smokeCloud(x, y, false, 0.8);
    projection.toScreen(x, y, 10, screen);
    this.flash(screen.x, screen.y, 7);
    this.debris.emitParticleAt(screen.x, screen.y, 16);
    this.fire.emitParticleAt(screen.x, screen.y, 28);
  }

  // TITAN: the car grows with a stamp: dust all round it, a ring, bits of road.
  titanStomp(x, y) {
    this.groundRing(x, y, 220);
    this.dustRing(x, y, 70, 12);
    projection.toScreen(x, y, 6, screen);
    this.debris.emitParticleAt(screen.x, screen.y, 10);
  }

  // Puffs of dust in a circle.
  dustRing(x, y, radius, count) {
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      projection.toScreen(x + Math.cos(a) * radius, y + Math.sin(a) * radius, 4, screen);
      this.smoke.emitParticleAt(screen.x, screen.y, 1);
    }
  }

  // COLD SNAP: ice over the road round the blast, melting when the cars thaw.
  iceField(x, y, radius, seconds) {
    this.ice.forEach((slot, i) => {
      const a = Math.random() * Math.PI * 2;
      const reach = i === 0 ? 0 : radius * Math.sqrt(Math.random()) * 0.9;
      const size = i === 0 ? radius * 0.9 : 60 + Math.random() * 90;
      slot.age = 0;
      slot.seconds = seconds;
      slot.alpha = 0.32 + Math.random() * 0.25;
      slot.image.setPosition(x + Math.cos(a) * reach, y + Math.sin(a) * reach).setScale(size / 64, (size * (0.6 + Math.random() * 0.5)) / 64).setRotation(Math.random() * 6).setAlpha(0).setVisible(true);
    });
  }

  // STONEWALL: each pillar bursts through the road, throwing lumps of it.
  pillarBurst(x, y) {
    this.pillarDust(x, y);
    this.groundRing(x, y, 90);
    projection.toScreen(x, y, 6, screen);
    this.rocks.emitParticleAt(screen.x, screen.y, 8);
  }

  // BLACKOUT: an electric ring and a burst of sparks.
  empBlast(x, y, radius) {
    this.shockwave(x, y, radius, BLACKOUT.ringSeconds, PALETTE.emp);
    projection.toScreen(x, y, 12, screen);
    this.sparks.emitParticleAt(screen.x, screen.y, 30);
  }

  // Sparks crackling over a dead police car.
  sparksAt(x, y, count) {
    projection.toScreen(x, y, 22, screen);
    this.sparks.emitParticleAt(screen.x + (Math.random() - 0.5) * 30, screen.y, count);
  }

  // TURBO, DECOY and PHANTOM: a soft pop of light, and nothing more.
  softPop(x, y, tint = 0xffffff) {
    projection.toScreen(x, y, 14, screen);
    this.flash(screen.x, screen.y, 2, tint);
  }

  blastGlow(x, y, radius, tint = 0xff8a2a) {
    const glow = this.blastGlows[this.nextBlastGlow];
    this.nextBlastGlow = (this.nextBlastGlow + 1) % this.blastGlows.length;
    this.scene.tweens.killTweensOf(glow);
    glow.setPosition(x, y).setScale(radius / 64).setRotation(Math.random() * 6).setAlpha(1).setTint(tint).setVisible(true);
    this.scene.tweens.add({ targets: glow, alpha: 0, duration: EFFECTS.blastGlowMs, ease: 'Quad.easeIn', onComplete: () => glow.setVisible(false) });
  }

  groundRing(x, y, radius) {
    const ring = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    this.scene.tweens.killTweensOf(ring);
    ring.setPosition(x, y).setScale(0.25).setAlpha(0.8).setTint(0xffd9a0).setVisible(true);
    this.scene.tweens.add({ targets: ring, scale: radius / 60, alpha: 0, duration: EFFECTS.ringMs, ease: 'Quad.easeOut', onComplete: () => ring.setVisible(false) });
  }

  // Tires, bumpers and panels fly out and drop; friction stops them where they land, and tires roll on.
  makeChunkShadow(scene, layers) {
    const shadow = scene.add.image(0, 0, 'fx-glow').setTint(RENDER.shadowColor).setVisible(false);
    layers.shadows.add(shadow);
    return shadow;
  }

  throwChunks(x, y, count, paint) {
    for (let i = 0; i < count; i += 1) {
      const chunk = this.chunks[this.nextChunk];
      this.nextChunk = (this.nextChunk + 1) % this.chunks.length;
      const angle = ((i + Math.random() * 0.8) / count) * Math.PI * 2;
      const speed = lerp(EFFECTS.chunkSpeed[0], EFFECTS.chunkSpeed[1], Math.random());
      const kind = CHUNK_KINDS[i % CHUNK_KINDS.length];
      const tire = kind === 'tire';
      Object.assign(chunk, {
        x,
        y,
        z: 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: lerp(EFFECTS.chunkLift[0], EFFECTS.chunkLift[1], Math.random()),
        spin: (Math.random() - 0.5) * (tire ? 5 : 12), // turning flat on screen; most of its motion is the tumble
        kind,
        tire,
        angle: Math.random() * 6,
        age: 0,
        trail: 0,
        tumble: Math.random() * 6,
        tumbleSpeed: 10 + Math.random() * 10,
        bounce: tire ? EFFECTS.tireBounce : EFFECTS.chunkBounce,
        grip: tire ? EFFECTS.tireGrip : EFFECTS.chunkGrip,
        seconds: tire ? EFFECTS.tireSeconds : EFFECTS.chunkSeconds,
      });
      if (PAINTED.has(kind)) chunk.image.setTint(shadeColor(paint, 0.55 + Math.random() * 0.45));
      else chunk.image.clearTint();
      chunk.image.setFrame(frameName(kind, 0)).setAlpha(1).setVisible(true);
      chunk.shadow.setVisible(true);
    }
  }

  // A smaller hit: a little burst of fire and a few embers, no scorch mark.
  impact(x, y, size) {
    projection.toScreen(x, y, 14, screen);
    this.fire.emitParticleAt(screen.x, screen.y, Math.round(4 + size * 10));
    this.burst(screen.x, screen.y, size * 0.8, 0, EFFECTS.burstFadeMs);
  }

  // A ball of fire: swells fast, holds for a moment, and burns out. Real time, so it still plays during a
  // hit-stop, which is when it should be seen. size: 1 = 160 screen units across.
  burst(sx, sy, size, delay, fadeMs, tint = 0xffffff) {
    const image = this.bursts[this.nextBurst];
    this.nextBurst = (this.nextBurst + 1) % this.bursts.length;
    const full = (size * 160) / CORE_SIZE;
    this.scene.tweens.killTweensOf(image);
    image
      .setPosition(sx, sy)
      .setRotation(Math.random() * Math.PI * 2)
      .setScale(full * 0.25)
      .setAlpha(1)
      .setTint(tint)
      .setVisible(delay === 0);
    this.scene.tweens.add({ targets: image, scale: full, delay, duration: EFFECTS.burstPopMs, ease: 'Cubic.easeOut', onStart: () => image.setVisible(true) });
    this.scene.tweens.add({
      targets: image,
      alpha: 0,
      scale: full * 1.18,
      delay: delay + EFFECTS.burstPopMs + EFFECTS.burstHoldMs,
      duration: fadeMs,
      ease: 'Quad.easeIn',
      onComplete: () => image.setVisible(false),
    });
  }

  flash(sx, sy, size, tint = 0xfff1c8) {
    const flash = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % this.flashes.length;
    this.scene.tweens.killTweensOf(flash);
    flash.setPosition(sx, sy).setScale(size * 0.4).setAlpha(1).setVisible(true).setTint(tint);
    this.scene.tweens.add({ targets: flash, scale: size, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => flash.setVisible(false) });
  }

  scorch(x, y) {
    const slot = this.scorches[this.nextScorch];
    this.nextScorch = (this.nextScorch + 1) % this.scorches.length;
    slot.age = 0;
    slot.mark.setPosition(x, y).setScale(EFFECTS.scorchRadius / 64).setRotation(Math.random() * 6).setAlpha(SCORCH_ALPHA).setVisible(true);
  }

  // Shockwave: a ring that sweeps out over the ground.
  shockwave(x, y, radius, seconds, color = PALETTE.pulse) {
    this.pulse = { x, y, radius, seconds, age: 0, color };
    projection.toScreen(x, y, 10, screen);
    this.flash(screen.x, screen.y, 6);
  }

  // Freeze: the same kind of ring in frost colours, and a burst of sparkles.
  // COLD SNAP going off: the ring, and snow flung out with it: flakes and powder racing out at the ring's own
  // pace, most just behind its edge, all fading and gone as the ring is.
  freezeBlast(x, y) {
    this.shockwave(x, y, FREEZE.radius, FREEZE.ringSeconds, PALETTE.frost);
    this.snowBlast = { x, y, radius: FREEZE.radius, seconds: FREEZE.ringSeconds, age: 0 };
    for (const flake of this.ringSnow) {
      flake.angle = Math.random() * Math.PI * 2;
      flake.share = flake.cloud ? 0.55 + Math.random() * 0.4 : 0.35 + Math.sqrt(Math.random()) * 0.7;
      flake.z = flake.cloud ? 6 + Math.random() * 10 : 4 + Math.random() * 34;
      flake.size = flake.cloud ? 0.9 + Math.random() * 0.8 : 0.1 + Math.random() * 0.14;
      flake.alpha = flake.cloud ? 0.6 : 0.95;
      flake.image.setVisible(true).setTint(Math.random() < 0.5 ? 0xffffff : 0xe2f2fc).setRotation(Math.random() * 6);
    }
  }

  updateSnowBlast(dt) {
    const blast = this.snowBlast;
    if (!blast) return;
    blast.age += dt;
    const t = Math.min(1, blast.age / blast.seconds);
    const reach = blast.radius * (1 - (1 - t) * (1 - t)); // the ring's own growth (updatePulse)
    for (const flake of this.ringSnow) {
      const d = reach * flake.share;
      projection.toScreen(blast.x + Math.cos(flake.angle) * d, blast.y + Math.sin(flake.angle) * d, flake.z * (1 - 0.5 * t), screen);
      flake.image
        .setPosition(screen.x, screen.y)
        .setScale(flake.size * (1 + (flake.cloud ? 1.2 : 0.3) * t))
        .setAlpha(flake.alpha * (1 - t * t));
    }
    if (t >= 1) {
      this.snowBlast = null;
      for (const flake of this.ringSnow) flake.image.setVisible(false);
    }
  }

  // A frozen car smashed to bits: ice and panels, but no fire.
  shatter(x, y, paint) {
    projection.toScreen(x, y, 14, screen);
    this.flash(screen.x, screen.y, 2.5);
    this.frost.emitParticleAt(screen.x, screen.y, 40);
    this.throwChunks(x, y, 6, paint);
  }

  // The bare rim scraping along the road.
  rimSparks(x, y) {
    projection.toScreen(x, y, 3, screen);
    this.fire.emitParticleAt(screen.x, screen.y, 3);
  }

  // Bits of road crumbling away as a car goes over the edge of a hole. (x, y) is where it went over:
  // only chips at the car itself, because a dust cloud there would hide the fall.
  holeCrumble(x, y, edgeX, edgeY) {
    projection.toScreen(x, y, 4, screen);
    this.debris.emitParticleAt(screen.x, screen.y, 7);
    projection.toScreen(edgeX, edgeY, 2, screen);
    this.smoke.emitParticleAt(screen.x, screen.y, 2);
  }

  // Dust rising out of a hole, once the car has gone.
  holeDust(x, y) {
    projection.toScreen(x, y, 2, screen);
    this.darkSmoke.emitParticleAt(screen.x, screen.y, 4);
  }

  // Stone dust where a pillar breaks through the road, or crumbles back into it.
  pillarDust(x, y) {
    projection.toScreen(x, y, 6, screen);
    this.smoke.emitParticleAt(screen.x, screen.y, 5);
    this.debris.emitParticleAt(screen.x, screen.y, 6);
  }

  // A police car catching fire.
  ignite(x, y) {
    projection.toScreen(x, y, 14, screen);
    this.flash(screen.x, screen.y, 3.2);
    this.fire.emitParticleAt(screen.x, screen.y, 10);
    this.darkSmoke.emitParticleAt(screen.x, screen.y - 10, 6);
    this.blastGlow(x, y, 90);
  }

  // The Flamer's trail lights the road: one glow under each patch (the flames themselves are render/PowerFx.js).
  syncPatches(patches) {
    const size = (FLAMER.patchRadius * 1.5) / 32;
    for (let i = 0; i < patches.length; i += 1) {
      const patch = patches[i];
      const glow = this.firePatches[i];
      if (!patch.active) {
        glow.setVisible(false);
        continue;
      }
      const life = 1 - patch.age / FLAMER.patchSeconds;
      glow.setVisible(true).setPosition(patch.x, patch.y).setScale(size).setAlpha(EFFECTS.firePatchAlpha * Math.min(1, life * 2));
    }
  }

  update(dt) {
    for (let i = this.sprays.length - 1; i >= 0; i -= 1) {
      const spray = this.sprays[i];
      spray.left -= dt;
      if (spray.left <= 0) {
        this.sprays.splice(i, 1);
        continue;
      }
      projection.toScreen(spray.x, spray.y, 10, screen);
      this.water.emitParticleAt(screen.x, screen.y, 2);
    }
    for (const wet of this.wetPatches) {
      if (!wet.image.visible) continue;
      wet.age += dt;
      const grow = Math.min(1, wet.age / 2);
      const fade = Math.min(1, (EFFECTS.wetSeconds - wet.age) / 2);
      if (fade <= 0) wet.image.setVisible(false);
      else wet.image.setScale(0.6 + grow * 1.6).setAlpha(0.55 * Math.min(1, wet.age * 3) * fade);
    }
    for (const slot of this.ice) {
      if (!slot.image.visible) continue;
      slot.age += dt;
      const t = slot.age / slot.seconds;
      if (t >= 1) slot.image.setVisible(false);
      else slot.image.setAlpha(slot.alpha * Math.min(1, slot.age / 0.3) * Math.min(1, (slot.seconds - slot.age) / 1));
    }
    for (const slot of this.scorches) {
      if (!slot.mark.visible) continue;
      slot.age += dt;
      const t = slot.age / EFFECTS.scorchSeconds;
      if (t >= 1) slot.mark.setVisible(false);
      else slot.mark.setAlpha(SCORCH_ALPHA * (1 - t * t * t));
    }
    for (const chunk of this.chunks) {
      if (!chunk.image.visible || dt === 0) continue;
      chunk.age += dt;
      stepChunk(chunk, dt, EFFECTS.chunkGravity, chunk.bounce, chunk.grip);
      stepChunkTurn(chunk, dt);
      projection.toScreen(chunk.x, chunk.y, chunk.z, screen);
      const left = chunk.seconds - chunk.age;
      const alpha = Math.min(1, left * 3);
      // Smoke trails off it while it is new and high.
      chunk.trail -= dt;
      if (chunk.trail <= 0 && chunk.z > 12 && chunk.age < EFFECTS.chunkTrailSeconds) {
        chunk.trail = EFFECTS.chunkTrailEvery;
        this.chunkSmoke.emitParticleAt(screen.x, screen.y, 1);
      }
      chunk.image
        .setFrame(frameName(chunk.kind, chunkPose(chunk.tumble, DEBRIS.poses)))
        .setPosition(screen.x, screen.y)
        .setRotation(chunk.angle)
        .setScale(1 / DEBRIS.scale)
        .setAlpha(alpha)
        .setDepth(chunk.z > 3 ? DEPTH.effects + 2 : DEPTH.objects + projection.depthOf(chunk.x, chunk.y));
      projection.shadowOffset(chunk.z, shadowShift);
      const high = Math.min(1, chunk.z / 260);
      chunk.shadow
        .setPosition(chunk.x + shadowShift.x, chunk.y + shadowShift.y)
        .setScale((EFFECTS.chunkShadowRadius * (1 - 0.4 * high)) / 32)
        .setAlpha(EFFECTS.chunkShadowAlpha * (1 - 0.5 * high) * alpha);
      if (left <= 0) {
        chunk.image.setVisible(false);
        chunk.shadow.setVisible(false);
      }
    }
    this.updateSnowBlast(dt);
    const p = this.pulse;
    if (!p) return;
    p.age += dt;
    const t = Math.min(1, p.age / p.seconds);
    const r = p.radius * (1 - (1 - t) * (1 - t));
    this.pulseRing.setVisible(true).setPosition(p.x, p.y).setScale(r / 60).setTint(p.color).setAlpha(0.95 * (1 - t));
    this.pulseFill.setVisible(true).setPosition(p.x, p.y).setScale((r * 1.1) / 64).setTint(p.color).setAlpha(0.4 * (1 - t));
    if (t >= 1) this.stopPulse();
  }

  stopPulse() {
    this.pulse = null;
    this.pulseRing.setVisible(false);
    this.pulseFill.setVisible(false);
  }

  clear() {
    for (const emitter of [this.smoke, this.darkSmoke, this.chunkSmoke, this.fireball, this.fire, this.debris, this.flames, this.frost, this.snow, ...this.tireSmokes.values(), this.grains.sand, this.grains.mud, this.sparks, this.rocks, this.water, this.bits, this.snowBits]) emitter.killAll();
    this.sprays.length = 0;
    this.snowBlast = null;
    for (const flake of this.ringSnow) flake.image.setVisible(false);
    for (const wet of this.wetPatches) wet.image.setVisible(false);
    for (const slot of this.ice) slot.image.setVisible(false);
    for (const glow of this.firePatches) glow.setVisible(false);
    for (const chunk of this.chunks) {
      chunk.image.setVisible(false);
      chunk.shadow.setVisible(false);
    }
    for (const ring of this.rings) {
      this.scene.tweens.killTweensOf(ring);
      ring.setVisible(false);
    }
    for (const flash of this.flashes) flash.setVisible(false);
    for (const image of this.bursts) {
      this.scene.tweens.killTweensOf(image);
      image.setVisible(false);
    }
    for (const slot of this.scorches) slot.mark.setVisible(false);
    for (const glow of this.blastGlows) {
      this.scene.tweens.killTweensOf(glow);
      glow.setVisible(false);
    }
    this.stopPulse();
  }
}
