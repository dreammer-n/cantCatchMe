import { SANDSTORM } from '../config/tuning.js';

// The sandstorm drawn over the whole screen (UIScene, screen space): blowing sand thick at the edges and thin
// round the car in the middle, with streaks racing across in the wind. Police far from the car are hard to see;
// the red warning arrows are drawn on top of it, so they still show.

const SIZE = 256;
const SAND = [238, 210, 160]; // paler than the desert floor, so the haze shows over it
const rgba = (a) => `rgba(${SAND[0]}, ${SAND[1]}, ${SAND[2]}, ${a})`;

function makeTextures(scene) {
  if (!scene.textures.exists('storm-haze')) {
    const texture = scene.textures.createCanvas('storm-haze', SIZE, SIZE);
    const ctx = texture.getContext();
    const middle = SIZE / 2;
    const gradient = ctx.createRadialGradient(middle, middle, SIZE * SANDSTORM.clearShare, middle, middle, middle * Math.SQRT2);
    gradient.addColorStop(0, rgba(0.2));
    gradient.addColorStop(0.35, rgba(0.82));
    gradient.addColorStop(1, rgba(1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SIZE, SIZE);
    texture.refresh();
  }
  if (!scene.textures.exists('storm-streaks')) {
    const texture = scene.textures.createCanvas('storm-streaks', SIZE, SIZE);
    const ctx = texture.getContext();
    // Fixed streaks (not random), so the tile repeats the same everywhere.
    for (let i = 0; i < 46; i += 1) {
      const x = (i * 97) % SIZE;
      const y = (i * 53) % SIZE;
      const length = 24 + ((i * 37) % 60);
      ctx.fillStyle = rgba(0.35 + ((i * 13) % 40) / 100);
      ctx.fillRect(x, y, length, 1.5 + (i % 3) * 0.6);
      if (x + length > SIZE) ctx.fillRect(x - SIZE, y, length, 1.5 + (i % 3) * 0.6);
    }
    texture.refresh();
  }
}

export class SandstormOverlay {
  constructor(scene) {
    this.scene = scene;
    makeTextures(scene);
    this.haze = scene.add.image(0, 0, 'storm-haze').setOrigin(0.5).setVisible(false);
    this.streaks = scene.add.tileSprite(0, 0, 16, 16, 'storm-streaks').setOrigin(0, 0).setVisible(false);
    this.drift = 0;
  }

  // level: 0 (none) to 1 (full). wind: the wind's angle in the world (east = 0).
  update(level, wind, width, height, dt) {
    const shown = level > 0.01;
    this.haze.setVisible(shown);
    this.streaks.setVisible(shown);
    if (!shown) return;
    this.haze.setPosition(width / 2, height / 2).setDisplaySize(width * 1.02, height * 1.02).setAlpha(level * SANDSTORM.strength);
    const scale = Math.max(1, Math.min(width, height) / 500);
    const across = Math.cos(wind) >= 0 ? 1 : -1;
    this.drift += dt * 900 * across;
    this.streaks
      .setSize(width, height)
      .setTileScale(scale, scale)
      .setTilePosition(-this.drift / scale, (-this.drift * 0.12) / scale)
      .setAlpha(level * 0.75);
  }
}
