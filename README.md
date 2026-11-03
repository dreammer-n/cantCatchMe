# Can't Catch Me!

An original HTML5 arcade car-chase survival game. Drive a little red coupe through a low-poly
city, dodge the police, lure them into crashing into props and each other, and survive as long
as you can. Built with Phaser 3 and Vite; all art and sound are made in code (no image or audio
files), so the whole game is well under 1 MB compressed. The city has no edge: it is generated around you as you drive.

## How to play

- Your car always drives forward. You only steer.
- Police cars arrive at speed from off screen, along the roads. More join the longer you survive.
  White cruisers tail you. From 15 seconds, faster black-and-white interceptors aim for where you are
  going and come at you from the side streets.
- A red arrow at the screen edge, with red and blue light sweeping across the road, means a car is
  arriving fast from that direction.
- Giant word statues are solid: drift round them.
- From 30 seconds, parked police cars block crossings ahead. Go round them, or lure the chasers into them.
- A hard hit from a police car, a wreck, a wall or a solid prop wrecks your car. Scrapes and bumps
  from behind are fine. Getting boxed in (held almost still for 1.4 s) also ends the run.
- Parking islands and roundabouts can be driven over (they slow you a little, and the trees on them
  are still solid). Cones, lamp posts, wooden crates and parked cars get knocked away; parked cars
  cost you real speed.
- Now and then there is a sinkhole or a missing road section. Drive over one and you fall in: run
  over. Police fall in too, and each one counts as wrecked.
- Police are not careful drivers: make them hit trees, blocks, barriers, each other and burning
  wrecks. Several in quick succession is a combo.
- Passing very close to a police car at speed is a **close call**.
- A dark amber lucky die bounces after you and sinks into your car, giving you a random power-up.
  Double tap anywhere (Space on a keyboard) to use it, or it fires by itself after 2.5 seconds:
  - **Kaboom:** wrecks every police car close around you.
  - **Titan:** 7 seconds at 3.2 × size. Nothing can hurt you, and you flatten police and scenery alike.
  - **Cold Snap:** police nearby freeze solid for 4.5 seconds. Others crash into them, and you can smash straight through them.
  - **Stonewall:** three stone blocks erupt behind you and wreck whatever hits them. They last 6 seconds.
  - **Scorcher:** 5 seconds of burning trail. Police that touch it spin out and explode a second later.
- The longer you last, the harder it gets:
  - **From 15 seconds:** black-and-white interceptors cut you off at corners and crossings.
  - **From 30 seconds:** dark grey **SWAT Bearcats**. Touching one ends your run, unless you are a Titan or it is frozen. They are slow to
    turn, so make them overshoot. They ram through cones, lamps and parked cars without slowing down.
  - **From 35 seconds:** **roadblocks**: two parked cruisers and a spike strip. Drive over the spikes and a tire goes flat
    for 3 seconds: the car lurches, drags hard toward that side and loses speed. Steer against it to hold it straight.
    A Titan ignores spikes, and mends a flat tire.
  - **From 45 seconds:** a **police helicopter** keeps its searchlight on you. A red flare and a ring on the road mark
    where it will drop a concrete block, just over a second later. Steer around it. Blocks wreck police too.
- Every run pays coins: 2 a second, 5 per police car wrecked, 10 per step of your best combo. On the results
  screen you can double them by watching an ad, if you choose to.
- Each map's best run gives you 1 to 5 stars, at 10, 20, 35, 50 and 75 seconds. Stars add up and unlock new maps:
  Winter at 3, Desert at 6, Woods at 9.
- Spend them in the **Garage**: 19 cars, up to 100,000 coins, each with its own speed, acceleration, handling and durability, shown as blocks.
  The heavy ones go straight through cones, lamps and parked cars.
- Score = survival time. Your best time, police wrecked, close calls and best combo are saved.

| Device | Steer | Power-up | Pause | Start / retry |
|---|---|---|---|---|
| Keyboard | ← → or A / D | Space (or ↑ / W) | P | Enter or Space (R = retry) |
| Phone / tablet | Hold the left or right half of the screen | Double tap, or it goes off by itself | PAUSE button | Buttons |
| Mouse | Hold the left or right half of the window | Space, or it goes off by itself | PAUSE button | Buttons |
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

1. The Playgama Bridge SDK is already part of the project (`@playgama/bridge` in `package.json`; `npm install`
   fetches it). YouTube Playables does not allow the game to download anything from the internet, so the SDK file
   goes inside the game, and the build puts it first on the page, as Playgama requires.
2. Make the real `playgama-bridge-config.json` with Playgama's config editor
   (https://playgama.github.io/bridge-config-editor/) and put it in the `public` folder in place of the one there
   (that one only sets the advert placements, `game_over` and `double_coins`, and 60 seconds between adverts).
3. Type `npm run build` and press Enter. The finished game appears in the `dist` folder:
   `index.html`, an `assets` folder, `playgama-bridge.js` and `playgama-bridge-config.json`.
   If the build prints `playgama-bridge.js not found`, run `npm install` first.
4. Check the size: the `dist` folder should be around 7 MB (limit: 30 MB, target 15 MB).
5. Optional check: `npm run preview` and open the address it prints.
6. Zip the **contents** of `dist` (not the folder itself) and upload it in the Playgama
   developer dashboard. Use Playgama's QA tool to check pause, sound, adverts and saving.

## Checking that nothing broke

`npm test` runs the game-logic checks (collisions, crash rules, police, spawning, the power-ups, the
driving model and the 2.5D maths) in about a second, no browser needed. `npm run balance` lets a
simple bot play 30 runs and prints survival times, crash causes and spawn fairness: useful after
changing numbers in `src/config/tuning.js`.

## Debug mode (for tuning, never shown to players)

Add `?debug` to the address (for example `http://localhost:5173/?debug`). It works with `npm run dev` and with
`npm run build:test` (a build in `dist-test`, for testing); `npm run build`, the version players get, leaves it out
entirely. A toolbar appears:
**1 / 2 / 3** handling presets (Grippy / Balanced / Drifty), **V** camera views (Angled / Angled
high / Angled low / North-up), **T** turntable (park the car and turn it to inspect it), and one
button per power-up, to try any of them without waiting for a die, and **SWAT**, **ROADBLOCK** and
**CHOPPER** buttons to bring those on at once, **+50K COINS**, **RESET GARAGE** and **ALL MAPS** for trying things out, and
**4 Chosen car**, which goes back to the selected car's own handling after using 1, 2 or 3. Test hooks
are available as `window.__carChaseDebug` in the browser console.

## Project documents

- `CLAUDE.md` — approved decisions, file map, project status
- `GAME_DESIGN.md` — gameplay design
- `TUNING_LOG.md` — history of gameplay number changes
- `RENDERING.md` — how the 2.5D view works
- `ART_DIRECTION.md` — visual style
- `PROJECT_INSTRUCTIONS.md` — the standing development rules
