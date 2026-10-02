# Settlers

A private, web-based Catan-style board game for a few friends. The goal is to be **more reliable than Catan Universe**. When reliability conflicts with features, polish or speed, reliability wins.

See `SPEC.md` for what we're building and `prototype/index.html` for the original single-file prototype ("Sixfold Isle"), which is the rules reference. Read `prototype/` but don't edit it.

## Layout

```
packages/engine/   pure rules engine (TypeScript). No I/O, no Date, no Math.random.
packages/server/   Node game server: rooms, WebSocket protocol, SQLite persistence
packages/client/   browser client (Vite + React, SVG board)
e2e/               Playwright: 3 browser clients play a full game against the real server
deploy/            Caddyfile, systemd unit, provisioning + deploy scripts
prototype/         original prototype, read-only reference
```

## Commands

Run all commands from the repo root.

| What | Command |
|---|---|
| Install | `npm ci` |
| Dev (server + client, hot reload) | `npm run dev`, then open http://localhost:5173 (passphrase `dev`) |
| Typecheck | `npm run typecheck` |
| Lint + format check | `npm run lint` |
| Unit tests (all packages) | `npm test` |
| Simulator (1,000 each of classic, Heading for New Shores, C&K, C&K + Seafarers and the Fog Islands in Seafarers and Full game mode, 500 on the 3-player Heading for New Shores, 200 fog-test games, and 1,000 games with CPU players; on all CPU cores; ~28 min) | `npm run sim` |
| Simulator, one scenario / more games / fixed seed | `npm run sim -- --scenario ck --games 5000 --seed x` (scenarios: `classic`, `heading-for-new-shores`, `heading-for-new-shores-3`, `fog-test`, `fog-islands`, `fog-islands-ck`, `ck`, `ck-sea`, and `cpu-` + `classic`, `heading-for-new-shores`, `ck` or `ck-sea`) |
| Replay a failing game (the seed encodes scenario, players and house rules) | `npm run sim -- --replay <seed>` |
| Map generator check (10,000 boards per preset through the separate checker, docs/maps.md 6; ~3 min) | `npm run maps` (one preset / fewer boards: `-- --preset "Our rules" --boards 500`) |
| CPU tournaments (4-player CPU-only games: 1 Hard + 3 Medium, 1 Medium + 3 Easy, 2 Hard + 2 Medium, in every mode; not part of `check`; ~1 h for 1,000 each) | `npm run tournament -- --games 1000` (one mode / mix: `--mode ck --mix hm`) |
| End-to-end (3 browsers, real server build: classic, Seafarers, Cities & Knights, CPU, table polish, Milestone 5, maps, the pre-game table, Milestones 8, 9 and 10, moving a seat) | `npm run test:e2e` (builds first; needs Chromium: `npx playwright install chromium` once) |
| **Everything CI runs** | `npm run check` |
| Build (client to `packages/client/dist`, server bundle to `packages/server/dist`) | `npm run build` |
| Deploy | GitHub → Actions → Deploy → Run workflow, or `npm run deploy` (see `deploy/README.md`) |

## Definition of done

**Run `npm run check` before saying anything is done, fixed or working**, and report what it actually printed. If you couldn't run something (e.g. e2e), say so plainly. Don't describe untested code as working.

- For a bug: first reproduce it as a failing test, using a seed or move log where possible. Then fix it and show the test passing.
- For a rule change: add a unit test for the rule, and add or update a simulator invariant if the rule affects a conserved quantity.
- For UI changes: also check them in a browser (Playwright screenshot or the e2e test), not just by typechecking.

## Engine tests

- `packages/engine/test/simulate.ts` plays seeded random games. After every action it checks `checkInvariants` and `checkTransition`. On a sample of steps it also checks that every action from `legalActions` is accepted, that inputs aren't mutated, and that views and events leak nothing. At the end of each game it replays the whole game from the seed and compares the result.
- A failing game prints its seed. `npm run sim -- --replay <seed>` reruns it with every check on every step.
- Test helpers (`test/helpers.ts`) can rig the dice (`rigDice`), set hands, and place pieces directly, for exact rule tests.
- On sampled steps the simulator also tries random actions the legal-move list *doesn't* offer and requires the engine to reject them, so the reducer and `legalActions` can't drift apart.
- `test/golden.test.ts` replays 12 base games recorded before the expansion restructure and requires byte-identical states and events. If it fails, a change has altered how saved games replay: fix the change, don't re-record (re-record only for an intended rules change, with an `ENGINE_VERSION` bump).
- When you add a check, plant the bug it should catch and confirm it fails before trusting it.

## Server and client tests

- `packages/server/test/rooms.test.ts` drives `Rooms` with fake connections: full games through the server, restart and replay, hidden info in every message sent, failed saves, reset and seat takeover rules. `options.test.ts` covers room options and a full Seafarers game through the server. `cpu.test.ts` covers CPU seats in the lobby and a full game with CPUs on a fake clock, including a restart mid-pause.
- `e2e/cpu.spec.ts`: two people and a CPU play a full game; the CPU is added, renamed and recoloured in the lobby and declines a trade offered through the UI (the server runs with `CPU_DELAY_MS` to speed it up).
- `e2e/cpu-levels.spec.ts` (Milestone 7): the CPU page (Easy, Medium and Hard side by side, a custom CPU made with the sliders, the page on a phone); one CPU made Hard and another the custom CPU from the seat menus; the CPU trading switches; a full game where both CPUs answer a trade offered through the UI. `packages/server/test/cpuLevels.test.ts` covers levels and custom CPUs in the lobby (a seat keeps the personality it picked), stats under a custom CPU's name, the 1–3 s pace, offers nobody answers, trading switched off, and whole games with Medium and Hard across a restart.
- `e2e/polish.spec.ts` (Milestone 4) plays a full game in two desktop browsers and an emulated phone: mode picker and colours in the lobby, placement ghosts with Confirm/Cancel by mouse and touch, every confirmation setting both on and off, settings surviving a rejoin by name on a new device, table rules changed mid-game, and the dice handed back (in setup, refused, and unasked). The test hook `botStep(['end', …])` returns `skip:<type>` for moves the test makes through the UI. Existing specs press Confirm via `confirmPlace()` in `e2e/table.ts`.
- `e2e/m5.spec.ts` (Milestone 5) plays a full game on a laptop, a tablet and a phone (reduced motion): profiles made in the lobby, undo approved and denied by clicking, a tap while zoomed lands where aimed, rolls by clicking the dice and the button (every screen lands on the server's dice; the dice sound respects the switch), the turn sound only for whoever must act, score breakdowns and pieces left on every screen, every display size on every device without overflow, Save and quit then Resume, confetti (calm with reduced motion), end-screen and Stats-page stats. `SHOTS=<dir>` saves screenshots.
- `packages/server/test/m5.test.ts`: profiles and merging, the one-time migration, server dice saved with every roll, stats rebuilt from the log equal the live ones (and only finished games with 2+ people count), saved games across a restart, undo, CPU chatter limits. `dice.test.ts` rolls the dice function 1,000,000 times.
- `packages/client/test/colors.test.ts` checks every piece colour against every other and every tile (CIEDE2000, with simulated colorblindness). `npx tsx packages/client/scripts/colorsheet.ts out.png` draws the pieces in every colour on every tile for a visual check.
- `e2e/pregame.spec.ts` (Milestone 6): three browsers share the pre-game table (the same board everywhere, rerolls, Back/Forward and edits seen live with who made them, Ready cleared by a change, seating and a roll for first), then play a full game on a generated board and another on a custom map, each starting on exactly the table's board in the chosen turn order; the table on a phone. `packages/server/test/table.test.ts` covers the Joe/Alex/Sam example, the setup snake for 2–4 players, roll-off ties (rigged dice through `RoomsOptions.luck`), random and pick, Ready, the board history, locks across rerolls, watchers, saved maps and modes, and restarts.
- `e2e/maps.spec.ts` (Milestone 6) drives the map list and editor: tiles, numbers and harbors placed by clicking, a drag that swaps tiles, locks, fill the rest, undo/redo by button and keyboard, reshaping, save, rename, duplicate, export, import (and a bad file refused), delete with two confirmations, and the editor on a phone.
- `packages/engine/test/maps.test.ts` covers every editor action, undo/redo after each, the checker (a planted break for each rule), the generator (same seed, same board; every test preset; the Seafarers shape; a game starting on the board) and the settings that can't work. `packages/server/test/maps.test.ts` covers saving, loading, renaming, duplicating, importing and deleting maps, and presets.
- `e2e/m8.spec.ts` (Milestone 8) plays a Knights game on a 1366×768 laptop, a tablet and a phone: the Bank cards setting changed live in the lobby, points to win on every screen, hover labels on the laptop and press-and-hold on the phone (which never places a piece), the trade buttons, the log (it fits beside the board, follows, stops when scrolled up with "N new ↓", never moves the page; past 150 rows it still follows, and rows being read stay put even with the browser's scroll anchoring off), Keep playing to an overtime win and the Stats page. The log is drawn on every update in every browser, so it works out each entry's lines once and shows only the newest 150 rows (`LOG_PAGE`) until asked: a slower log made the long browser games time out on CI. The Smith runs on a made-up view in one browser (`__settlers.stage(view)`: moves are recorded, not sent, until a reload), because a real game rarely deals it. `SHOTS=<dir>` saves screenshots.
- `e2e/m9.spec.ts` (Milestone 9b) plays a Knights game on a laptop, a tablet and a phone: one player changes sounds on the Sounds page (saved on the profile, nobody else's change), every browser plays the sounds for what happens by its own switches (`__settlers.sounds()`), table talk ticks for everyone but the sender, and the dice pinned from the dice sheet are dragged to another corner, shrunk, kept through a reload and the whole game, and shown as a strip on the phone. `packages/client/test/sound.test.ts` checks every sound's defaults, switches and the event-to-sound mapping (the sad tune only for whoever lost a city).
- `e2e/m10.spec.ts` (Milestone 10) builds a Seafarers map in the editor (sea, fog, the start area, island points, the pirate's start, gold added to the fog stack, a region with gold in its own tile set, undo/redo, Fill the rest, save), then three browsers pick it at the table in Seafarers mode and play it to the end on exactly the table's board; then the Fog Islands, picked in the lobby, played to the end. The no-fog-leak check covers game frames only: before a game, the table's map may list what fog can hide, as the map file does.
- `e2e/seat-move.spec.ts`: a seat held by a screen that's still connected moves to another browser when its player picks their name and confirms (lobby and mid-game), and the old screen just watches; `polish.test.ts` covers the same on the server.
- `e2e/cities-knights.spec.ts` plays a full C&K game: C&K picked in the lobby (the Knights mode), knights built and activated, improvements bought and owed choices answered through the UI.
- `e2e/seafarers.spec.ts` plays a full Seafarers game in 3 browsers: options picked in the lobby, a setup ship placed by clicking, gold picked through the gold sheet, a reload mid-game. Shared steps are in `e2e/table.ts`.
- `e2e/full-game.spec.ts` runs the production build (`packages/server/dist/server.mjs` serving `packages/client/dist`). Three browsers log in and set up a room by clicking. They play setup, a roll and an end turn through the UI, and the rest with `window.__settlers.botStep()`, the engine bot playing from that browser's own view. Mid-game it reloads a page and kills the server with SIGKILL, then checks every WebSocket frame for leaks.

## Engine conventions

- **Pure and deterministic.** `applyAction(state, seat, action)` returns either a new state plus events, or a typed error, and never mutates its input. All randomness comes from the PRNG state stored in the game state. The same seed and the same actions must always give the same game.
- The engine must not import from `server` or `client`, and must not touch the clock, network, filesystem or `Math.random`.
- **Turn order:** games started at the pre-game table carry `config.order: 'given'` and keep the seats in the order the table chose; older games shuffle from the seed (docs/pregame.md 2.4).
- **Every move goes through the engine.** The client may call `legalActions` to highlight valid spots, but the server re-validates everything. The client never decides an outcome.
- **Hidden information goes through `viewFor(state, seat)` only.** The server never sends raw state or raw events to a client. If you add a field to the state, decide whether it is public, private to one seat, or server-only, and update `viewFor` plus its test.
- **Events drive the UI.** Every action emits structured events (dice rolled, resources produced, card stolen, trade done…). The client animates these, and the text log is secondary. Events are redacted per seat just like state.
- **Maps and scenarios are JSON data** in `packages/engine/maps/` (format: `src/map.ts`, documented in `docs/rules/seafarers.md` Appendix A), validated on load. The classic board is `maps/classic.json`. A game's config stores a copy of its map, so saved games never depend on a file changing. Never reorder the hexes of a published map.
- **Expansions are rule modules** (`src/modules/`), plugged in through the hooks in `src/modules/api.ts`; a game lists its modules in `config.modules`. Base rules never check `if (seafarers)`; add a hook instead. Expansion state lives under its own key (`state.sea`, `state.ck`) so base games' state is unchanged.
- A classic game's config must stay exactly `{ winVP: 10 }` (house rules and options only add fields when used), so old games replay unchanged.
- Rules for an expansion are written down first in `docs/rules/<expansion>.md`, agreed, then implemented exactly; decisions are recorded there.
- Hands hold resources plus, with C&K, commodities in the same `res` record; iterate `cardKinds(s)`, not `RES`, when a rule is about cards in hand.
- `test/citiesKnights.test.ts` covers each C&K rule and progress card; `checkInvariants(s, prev)` reuses route lengths when no piece moved (the simulator passes `prev`).
- **CPU players** decide from their own view only: `cpuMove(view, rng, memo, brain, opts)`, where `brain` is `'easy'` (`src/cpu.ts`, rules in `docs/bot.md`) or a `Persona` (Medium, Hard or custom: `src/cpu/`, design in `docs/bot-medium-hard.md`), and `opts` are the room's CPU trading switches. Never let a CPU see more: its memory (`CpuMemo`; Hard's card counting in `cpu/track.ts`) is fed only through `cpuObserve(memo, viewFor(s, seat), eventsFor(events, seat))`, and `test/cpuSmart.test.ts` fails if a CPU file imports `viewFor`, the rules or the game's random numbers. `test/cpuSim.ts` checks every CPU move: Easy's rules about humans (no player trades, robber tiers, no nasty cards), Medium/Hard trading (one offer a turn, never with someone about to win, nothing with trading off), the hand limit, and, on a sample of moves, the same move when everything hidden is scrambled. The simulator's `cpu-*` scenarios cycle Easy, Medium, Hard and a custom CPU. The server makes CPU moves (`Rooms.scheduleCpu`) after a 1–3 s pause (`CPU_DELAY_MS` overrides it); a CPU waiting on answers to its offer gives up after 20 s; a rejected Medium/Hard move falls back to Easy's move once. `npm run tournament` plays CPU-only games and reports win rates (docs/bot-medium-hard.md §4.3).
- `src/bot.ts` is the test bot, not the CPU player. Neither ever picks `TABLE_TALK` moves (undo, the dice back, rule changes).
- **Dice come from the server** (SPEC 5.3): `packages/server/src/dice.ts` rolls every die with `crypto.randomInt` and puts them in the roll move (`{ type: 'roll', dice }`), which is saved; the engine uses them in order and only rolls from its PRNG for old saved rolls without dice. Players can't send dice (the zod schema refuses them).
- **Maps** (docs/maps.md): `src/mapkit.ts` is the editor (pure edits, undo/redo, the tile set), `src/mapcheck.ts` the rules checker, `src/mapgen.ts` the generator. The generator is a seeded search bounded by a step count, never the clock, so a seed always gives the same board; only the spot rules may be eased, and only when the strict search runs long (D7). `npm run maps` checks 10,000 boards per preset with the separate checker.
- **Log notes** (`src/lognotes.ts`, SPEC 8.10): lines the log shows that a move's events don't carry ("The robber blocked 1 Brick from Joe"), worked out from the state after the move. They are not game events, so saved games replay with exactly their saved events; the server adds them live and when it rebuilds a game. The client's log lines (`packages/client/src/text.ts`) are parts (names, cards, hidden cards, warnings), and `test/log.test.ts` checks every text colour for 4.5:1 contrast.
- **Stats** (`src/stats.ts`) are always worked out by replaying moves (`StatsFold`, `statsFromLog`); every change to a hand must be explained by an event, or the simulator fails the game. `vpBreakdown` and `piecesLeft` feed the score breakdowns and supply counts and are checked after every simulated move.

## Server conventions

- Write every accepted action to SQLite (one transaction) **before** broadcasting it. A move a player has seen must survive a crash.
- On startup, rebuild each game from its latest snapshot plus the actions after it.
- Every saved game records the engine version. Never change rules in a way that breaks replaying a saved game without a migration.
- Validate every incoming message with zod and reject anything unknown.
- Secrets (the site passphrase, the cookie signing key) come from environment variables on the server. Never commit them.

## Style

- TypeScript `strict`. No `any` without a comment saying why.
- Keep dependencies minimal. Adding one needs a reason in the commit message.
- Player-facing error messages are short and plain ("Roll the dice first"), as in the prototype.
- Match the surrounding code's naming and comment density.
