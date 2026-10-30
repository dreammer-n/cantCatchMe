# Can't Catch Me!

An original HTML5 arcade car-chase survival game. Drive a little red coupe through a low-poly
city, dodge the police, lure them into crashing into props and each other, and survive as long
as you can. Built with Phaser 3 and Vite; all art and sound are made in code (no image or audio
files), so the whole game is well under 1 MB compressed. The city has no edge: it is generated around you as you drive.

## How to play

- Your car always drives forward. You only steer.
- Police cars spawn off screen and chase you. More of them join the longer you survive, and from
  about 12 seconds some try to cut you off from the front.
- A hard hit from a police car, a wreck, a wall or a solid prop wrecks your car. Scrapes and bumps
  from behind are fine. Getting boxed in (held almost still for 1.4 s) also ends the run.
- Parking islands and roundabouts can be driven over (they slow you a little, and the trees on them
  are still solid). Cones, lamp posts and wooden crates get knocked away.
- Watch for sinkholes and missing road sections. Drive over one and you fall in: run over. Police
  fall in too, and each one counts as wrecked.
- Police are not careful drivers: make them hit trees, blocks, barriers, each other and burning
  wrecks. Several in quick succession is a combo.
- Passing very close to a police car at speed is a **close call**.
- Teal crates hold a **Shockwave**: drive through one, then press the ⚡ button (Space on a
  keyboard) to wreck every police car close around you.
- Score = survival time. Your best time, police wrecked, close calls and best combo are saved.

| Device | Steer | Shockwave | Pause | Start / retry |
|---|---|---|---|---|
| Keyboard | ← → or A / D | Space (or ↑ / W) | Esc or P | Enter or Space (R = retry) |
| Phone / tablet | Hold the left or right half of the screen | ⚡ button | ⏸ button | Buttons |
| Mouse | Hold the left or right half of the window | ⚡ button | ⏸ button | Buttons |
| Gamepad | D-pad or left stick | A | Start | A |

## Running the game on your own computer

You only need to do steps 1–3 once.

1. **Install Node.js.** Go to https://nodejs.org, download the version marked **LTS**, and run the
   installer with all the default options.
2. **Unzip this project** somewhere easy to find, for example your Desktop. You should see a folder
   named `car-chase-game` containing `index.html` and `package.json`.
3. **Open a terminal in that folder, then install the game's tools:**
   - **Windows:** open the `car-chase-game` folder in File Explorer, click the address bar, type
     `cmd` and press Enter. A black window opens.
   - **Mac:** open the Terminal app, type `cd ` (with a space), drag the `car-chase-game` folder into
     the Terminal window, and press Enter.
   - **VS Code:** open the folder (File → Open Folder), then Terminal → New Terminal.
   - In that window, type `npm install` and press Enter. Wait until it finishes (about a minute).

Each time you want to play:

4. Type `npm run dev` and press Enter.
5. It prints a line like `Local: http://localhost:5173/`. Open that address in your browser.
6. **On your phone** (same Wi-Fi as the computer): open the address shown next to `Network:`.
7. To stop, click the terminal window and press `Ctrl + C`.

## Making the upload-ready version

1. **Add the Playgama Bridge SDK file (once).** YouTube Playables does not allow the game to
   download anything from the internet, so the SDK file must be inside the game. In the terminal
   type `npm install @playgama/bridge` and press Enter. (Alternative: download
   `playgama-bridge.js` from Playgama and put it in the `public` folder.)
2. Type `npm run build` and press Enter. The finished game appears in the `dist` folder:
   `index.html`, an `assets` folder, `playgama-bridge.js` and `playgama-bridge-config.json`.
   If the build prints `playgama-bridge.js not found`, step 1 didn't work; the game then runs in
   plain browser mode (fine for testing, not for submission).
3. Check the size: the `dist` folder should be around 1.5 MB (limit: 30 MB, target 15 MB).
4. Optional check: `npm run preview` and open the address it prints.
5. Before submitting, create the real `playgama-bridge-config.json` with Playgama's config editor
   (https://playgama.github.io/bridge-config-editor/) and replace the placeholder in `public`.
6. Zip the **contents** of `dist` (not the folder itself) and upload it in the Playgama
   developer dashboard. Use Playgama's QA tool to check pause, sound and saving.

## Checking that nothing broke

`npm test` runs the game-logic checks (collisions, crash rules, police, spawning, the Shockwave, the
driving model and the 2.5D maths) in about a second, no browser needed. `npm run balance` lets a
simple bot play 30 runs and prints survival times, crash causes and spawn fairness: useful after
changing numbers in `src/config/tuning.js`.

## Debug mode (for tuning, never shown to players)

Add `?debug` to the address (for example `http://localhost:5173/?debug`). A toolbar appears:
**1 / 2 / 3** handling presets (Grippy / Balanced / Drifty), **V** camera views (Angled / Angled
high / Angled low / North-up), **T** turntable (park the car and turn it to inspect it). Test hooks
are available as `window.__carChaseDebug` in the browser console.

## Project documents

- `CLAUDE.md` — approved decisions, file map, project status
- `GAME_DESIGN.md` — gameplay design
- `TUNING_LOG.md` — history of gameplay number changes
- `RENDERING.md` — how the 2.5D view works
- `ART_DIRECTION.md` — visual style
- `PROJECT_INSTRUCTIONS.md` — the standing development rules
