import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Playgama Bridge SDK, bundled LOCALLY next to index.html (YouTube Playables allows no external
// requests). The game loads ./playgama-bridge.js at start; when the file is missing it simply
// runs in local browser mode.
// Where the file comes from (first one found):
//   1. public/playgama-bridge.js      (a copy you put there yourself; Vite copies public/ as is)
//   2. node_modules/@playgama/bridge  (after `npm install @playgama/bridge`)
const BRIDGE_FILE = 'playgama-bridge.js';

function playgamaBridgeLocal() {
  let source = null;
  return {
    name: 'playgama-bridge-local',
    configResolved(config) {
      source = null;
      if (existsSync(resolve(config.root, 'public', BRIDGE_FILE))) return; // option 1: nothing to do
      const fromPackage = resolve(config.root, 'node_modules/@playgama/bridge/dist', BRIDGE_FILE);
      if (existsSync(fromPackage)) source = fromPackage;
      else config.logger.warn(`[playgama] ${BRIDGE_FILE} not found: the game will run in local browser mode. See README.`);
    },
    configureServer(server) {
      // Dev server: serve the package copy, or a clean 404 (never the index.html fallback).
      server.middlewares.use(`/${BRIDGE_FILE}`, (req, res, next) => {
        if (existsSync(resolve(server.config.root, 'public', BRIDGE_FILE))) return next();
        if (!source) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(source));
      });
    },
    generateBundle() {
      if (source) this.emitFile({ type: 'asset', fileName: BRIDGE_FILE, source: readFileSync(source) });
    },
  };
}

export default defineConfig({
  // Relative paths: required by YouTube Playables and most HTML5 portals,
  // which host the game in a sub-folder.
  base: './',
  plugins: [playgamaBridgeLocal()],
  server: {
    // Lets a phone on the same Wi-Fi open the dev server for testing.
    host: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    // Phaser alone is ~1.2 MB minified; don't warn about it.
    chunkSizeWarningLimit: 1600,
  },
});
