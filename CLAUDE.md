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
| Simulator (default 1,000 games) | `npm run sim` |
| Simulator, more games / fixed seed | `npm run sim -- --games 20000 --seed 12345` |
| Replay a failing game | `npm run sim -- --replay <seed>` |
| End-to-end (3 browsers, real server build) | `npm run test:e2e` (builds first; needs Chromium: `npx playwright install chromium` once) |
| **Everything CI runs** | `npm run check` |
| Build (client to `packages/client/dist`, server bundle to `packages/server/dist`) | `npm run build` |
| Deploy | see `deploy/README.md` _(not built yet)_ |

## Definition of done

**Run `npm run check` before saying anything is done, fixed or working**, and report what it actually printed. If you couldn't run something (e.g. e2e), say so plainly. Don't describe untested code as working.

- For a bug: first reproduce it as a failing test, using a seed or move log where possible. Then fix it and show the test passing.
- For a rule change: add a unit test for the rule, and add or update a simulator invariant if the rule affects a conserved quantity.
- For UI changes: also check them in a browser (Playwright screenshot or the e2e test), not just by typechecking.

## Engine tests

- `packages/engine/test/simulate.ts` plays seeded random games. After every action it checks `checkInvariants` and `checkTransition`. On a sample of steps it also checks that every action from `legalActions` is accepted, that inputs aren't mutated, and that views and events leak nothing. At the end of each game it replays the whole game from the seed and compares the result.
- A failing game prints its seed. `npm run sim -- --replay <seed>` reruns it with every check on every step.
- Test helpers (`test/helpers.ts`) can rig the dice (`rigDice`), set hands, and place pieces directly, for exact rule tests.
- When you add a check, plant the bug it should catch and confirm it fails before trusting it.

## Server and client tests

- `packages/server/test/rooms.test.ts` drives `Rooms` with fake connections: full games through the server, restart and replay, hidden info in every message sent, failed saves, reset and seat takeover rules.
- `e2e/full-game.spec.ts` runs the production build (`packages/server/dist/server.mjs` serving `packages/client/dist`). Three browsers log in and set up a room by clicking. They play setup, a roll and an end turn through the UI, and the rest with `window.__settlers.botStep()`, the engine bot playing from that browser's own view. Mid-game it reloads a page and kills the server with SIGKILL, then checks every WebSocket frame for leaks.

## Engine conventions

- **Pure and deterministic.** `applyAction(state, seat, action)` returns either a new state plus events, or a typed error, and never mutates its input. All randomness comes from the PRNG state stored in the game state. The same seed and the same actions must always give the same game.
- The engine must not import from `server` or `client`, and must not touch the clock, network, filesystem or `Math.random`.
- **Every move goes through the engine.** The client may call `legalActions` to highlight valid spots, but the server re-validates everything. The client never decides an outcome.
- **Hidden information goes through `viewFor(state, seat)` only.** The server never sends raw state or raw events to a client. If you add a field to the state, decide whether it is public, private to one seat, or server-only, and update `viewFor` plus its test.
- **Events drive the UI.** Every action emits structured events (dice rolled, resources produced, card stolen, trade done…). The client animates these, and the text log is secondary. Events are redacted per seat just like state.
- Board geometry comes from board data (a hex list), not hardcoded constants, so the map editor and Seafarers can supply other boards.
- Expansions (Seafarers, Cities & Knights) and the CPU player must slot in as new rule modules or new clients, not as `if (expansion)` branches spread through base rules.

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
