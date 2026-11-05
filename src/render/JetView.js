import * as Phaser from 'phaser';
import { AIRSTRIKE, DEPTH, PALETTE, RENDER } from '../config/tuning.js';
import { atlasMeta, ensureCarAtlas, frameFor } from './carAtlas.js';
import { JET } from './carModels.js';
import { projection } from './projection.js';

const pick = { frame: 'dir0', rotation: 0 };
const screen = { x: 0, y: 0 };
const jet = { x: 0, y: 0 };
const shift = { x: 0, y: 0 };

// Draws the airstrike: red circles on the road where each bomb will land, the jet passing high overhead with its
// shadow racing over the ground, and the bombs falling the last moment. The blasts are ordinary explosions
// (Effects). Reads entities/Airstrike.js and never changes it.
export class JetView {
  constructor(scene, layers) {
    this.scene = scene;
    this.body = scene.add.image(0, 0, ensureCarAtlas(scene, 'jet'), 'dir0').setScale(JET.modelScale / RENDER.bakeScale).setDepth(DEPTH.effects + 8).setVisible(false);
    this.shadow = scene.add.image(0, 0, 'fx-glow').setTint(RENDER.shadowColor).setVisible(false);
    layers.shadows.add(this.shadow);
    this.marks = Array.from({ length: AIRSTRIKE.bombs }, () => {
      const glow = scene.add.image(0, 0, 'fx-glow').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.target).setVisible(false);
      const ring = scene.add.image(0, 0, 'fx-ring').setBlendMode(Phaser.BlendModes.ADD).setTint(PALETTE.target).setVisible(false);
      layers.lights.add(glow);
      layers.lights.add(ring);
      return { glow, ring };
    });
    this.bombs = scene.add.graphics().setDepth(DEPTH.effects + 7);
    this.redraw();
  }

  // Called at startup and whenever the camera setup changes.
  redraw() {
    const key = ensureCarAtlas(this.scene, 'jet');
    const meta = atlasMeta.get(key);
    this.directions = meta.directions;
    this.body.setTexture(key, 'dir0').setOrigin(meta.originX, meta.originY);
  }

  hide() {
    this.body.setVisible(false);
    this.shadow.setVisible(false);
    this.bombs.clear();
    for (const mark of this.marks) {
      mark.glow.setVisible(false);
      mark.ring.setVisible(false);
    }
  }

  update(strike, time) {
    if (!strike.active) {
      this.hide();
      return;
    }
    // The jet, high up, and its shadow far off on the road.
    strike.jetPosition(jet);
    frameFor(strike.heading, projection, pick, this.directions);
    projection.toScreen(jet.x, jet.y, AIRSTRIKE.jetHeight, screen);
    this.body.setVisible(true).setFrame(pick.frame).setRotation(pick.rotation).setPosition(screen.x, screen.y);
    projection.shadowOffset(AIRSTRIKE.jetHeight * 0.35, shift);
    this.shadow
      .setVisible(true)
      .setPosition(jet.x + shift.x, jet.y + shift.y)
      .setRotation(strike.heading)
      .setScale((95 * JET.modelScale) / 64, (110 * JET.modelScale) / 64)
      .setAlpha(0.4);
    // Circles where the bombs land, pulsing, each ring closing in on its spot.
    const g = this.bombs;
    g.clear();
    const pulse = 0.65 + 0.35 * Math.sin(time / 80);
    strike.bombs.forEach((bomb, i) => {
      const mark = this.marks[i];
      if (bomb.landed) {
        mark.glow.setVisible(false);
        mark.ring.setVisible(false);
        return;
      }
      const left = Math.max(0, bomb.landAt - strike.time);
      const share = left / bomb.landAt;
      mark.glow.setVisible(true).setPosition(bomb.x, bomb.y).setScale(AIRSTRIKE.blastRadius / 40).setAlpha(0.35 * pulse);
      mark.ring.setVisible(true).setPosition(bomb.x, bomb.y).setScale(((AIRSTRIKE.blastRadius * (0.85 + 0.45 * share)) * 2) / 116).setAlpha(0.55 + 0.35 * pulse);
      // The bomb itself, in its last moments: a dark shape dropping out of the sky.
      if (left < AIRSTRIKE.fallSeconds) {
        const z = (left / AIRSTRIKE.fallSeconds) ** 2 * AIRSTRIKE.fallHeight;
        projection.toScreen(bomb.x, bomb.y, z, screen);
        g.fillStyle(PALETTE.bomb, 1);
        g.fillEllipse(screen.x, screen.y, 9, 18);
        g.fillTriangle(screen.x - 6, screen.y - 7, screen.x + 6, screen.y - 7, screen.x, screen.y - 15);
      }
    });
  }
}
