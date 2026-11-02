import * as Phaser from 'phaser';
import { EFFECTS, PALETTE, WARNING } from '../config/tuning.js';
import { beamGeometry } from '../systems/ThreatRadar.js';

const shape = { angle: 0, length: 0, width: 0 };
const TEXTURE_LENGTH = 256;
const TEXTURE_WIDTH = 128;

// A fan of light drawn in code: narrow at the car, wide and fading toward the far end.
export function makeBeamTexture(scene) {
  if (scene.textures.exists('fx-beam')) return;
  const texture = scene.textures.createCanvas('fx-beam', TEXTURE_LENGTH, TEXTURE_WIDTH);
  const ctx = texture.context;
  // Row by row, so the beam fades toward its sides as well as along its length: no edge shows on the road.
  const STRIPS = 96;
  for (let i = 0; i < STRIPS; i += 1) {
    const along = i / STRIPS;
    const fade = (1 - along) ** 1.6;
    const half = TEXTURE_WIDTH * (0.06 + 0.44 * along);
    const gradient = ctx.createLinearGradient(0, TEXTURE_WIDTH / 2 - half, 0, TEXTURE_WIDTH / 2 + half);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.5, `rgba(255,255,255,${fade.toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect((i / STRIPS) * TEXTURE_LENGTH, TEXTURE_WIDTH / 2 - half, TEXTURE_LENGTH / STRIPS + 1, half * 2);
  }
  texture.refresh();
}

// Before a police car comes into view, its lights get there first: a red and blue beam sweeps across
// the road from where it is toward the player. One per warning arrow (ThreatRadar), all in the
// ground-lights layer, so together they cost one blend change.
export class SirenBeams {
  constructor(scene, layer) {
    makeBeamTexture(scene);
    this.images = Array.from({ length: WARNING.maxShown }, () => {
      const image = scene.add.image(0, 0, 'fx-beam').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      layer.add(image);
      return image;
    });
  }

  update(threats, player, time) {
    for (let i = 0; i < this.images.length; i += 1) {
      const image = this.images[i];
      const threat = threats[i];
      if (!threat) {
        image.setVisible(false);
        continue;
      }
      beamGeometry(threat, player, shape);
      const red = Math.floor(time / EFFECTS.lightFlashMs + i) % 2 === 0;
      image
        .setVisible(true)
        .setPosition(threat.x, threat.y)
        .setRotation(shape.angle)
        .setScale(shape.length / TEXTURE_LENGTH, shape.width / TEXTURE_WIDTH)
        .setTint(red ? PALETTE.lightRed : PALETTE.lightBlue)
        .setAlpha(WARNING.beamAlpha * threat.level);
    }
  }
}
