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
| Simulator (1,000 each of classic, Heading for New Shores, C&K and C&K + Seafarers, 200 fog-test games, and 1,000 games with CPU players; on all CPU cores; ~12 min) | `npm run sim` |
| Simulator, one scenario / more games / fixed seed | `npm run sim -- --scenario ck --games 5000 --seed x` (scenarios: `classic`, `heading-for-new-shores`, `fog-test`, `ck`, `ck-sea`, and `cpu-` + any of the first four but fog-test) |
| Replay a failing game (the seed encodes scenario, players and house rules) | `npm run sim -- --replay <seed>` |
| End-to-end (3 browsers, real server build: classic, Seafarers, Cities & Knights) | `npm run test:e2e` (builds first; needs Chromium: `npx playwright install chromium` once) |
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
- `e2e/cities-knights.spec.ts` plays a full C&K game: C&K switched on in the lobby, knights built and activated, improvements bought and owed choices answered through the UI.
- `e2e/seafarers.spec.ts` plays a full Seafarers game in 3 browsers: options picked in the lobby, a setup ship placed by clicking, gold picked through the gold sheet, a reload mid-game. Shared steps are in `e2e/table.ts`.
- `e2e/full-game.spec.ts` runs the production build (`packages/server/dist/server.mjs` serving `packages/client/dist`). Three browsers log in and set up a room by clicking. They play setup, a roll and an end turn through the UI, and the rest with `window.__settlers.botStep()`, the engine bot playing from that browser's own view. Mid-game it reloads a page and kills the server with SIGKILL, then checks every WebSocket frame for leaks.

## Engine conventions

- **Pure and deterministic.** `applyAction(state, seat, action)` returns either a new state plus events, or a typed error, and never mutates its input. All randomness comes from the PRNG state stored in the game state. The same seed and the same actions must always give the same game.
- The engine must not import from `server` or `client`, and must not touch the clock, network, filesystem or `Math.random`.
- **Every move goes through the engine.** The client may call `legalActions` to highlight valid spots, but the server re-validates everything. The client never decides an outcome.
- **Hidden information goes through `viewFor(state, seat)` only.** The server never sends raw state or raw events to a client. If you add a field to the state, decide whether it is public, private to one seat, or server-only, and update `viewFor` plus its test.
- **Events drive the UI.** Every action emits structured events (dice rolled, resources produced, card stolen, trade done…). The client animates these, and the text log is secondary. Events are redacted per seat just like state.
- **Maps and scenarios are JSON data** in `packages/engine/maps/` (format: `src/map.ts`, documented in `docs/rules/seafarers.md` Appendix A), validated on load. The classic board is `maps/classic.json`. A game's config stores a copy of its map, so saved games never depend on a file changing. Never reorder the hexes of a published map.
- **Expansions are rule modules** (`src/modules/`), plugged in through the hooks in `src/modules/api.ts`; a game lists its modules in `config.modules`. Base rules never check `if (seafarers)`; add a hook instead. Expansion state lives under its own key (`state.sea`, `state.ck`) so base games' state is unchanged.
- A classic game's config must stay exactly `{ winVP: 10 }` (house rules and options only add fields when used), so old games replay unchanged.
- Rules for an expansion are written down first in `docs/rules/<expansion>.md`, agreed, then implemented exactly; decisions are recorded there.
- Hands hold resources plus, with C&K, commodities in the same `res` record; iterate `cardKinds(s)`, not `RES`, when a rule is about cards in hand.
- `test/citiesKnights.test.ts` covers each C&K rule and progress card; `checkInvariants(s, prev)` reuses route lengths when no piece moved (the simulator passes `prev`).
- **The CPU player** (`src/cpu.ts`, rules in `docs/bot.md`) decides from its own view only: `cpuMove(view, rng, memo)`. Never let it see more. Its rules about humans (no player trades, robber tiers, no nasty cards, hand limit) are checked on every CPU move by `test/cpuSim.ts`, and exactly by `test/cpu.test.ts`. The server makes its moves (`Rooms.scheduleCpu`) after a 1–2 s pause (`CPU_DELAY_MS` overrides it).
- `src/bot.ts` is the test bot, not the CPU player.

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
