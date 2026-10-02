# Seafarers: rules as we will implement them

**Status: agreed (your answers are recorded under Decisions at the end). Being implemented.**

This document is the contract for the Seafarers milestone. The engine, the simulator's invariants and the tests will follow it exactly. If something here is wrong, it should be fixed here first.

**Sources.** I'm working from the current (5th) edition of *Catan: Seafarers*, which is what Catan Universe plays, as best I know it. I can't open Catan Universe from here to check its behaviour. Points that were open are marked **(Dn)**, pointing to the decision at the end.

Everything in the base game (SPEC.md) still applies unless this document changes it.

---

## 1. Scope of this milestone

1. **Restructure the engine** so expansions are optional rule modules that can be combined: `base`, `seafarers`, and later `cities-knights`, including C&K + Seafarers together. Existing saved base games must replay exactly as before (§20).
2. **Maps and scenarios as data files** (JSON), in the format the map editor will use later (Appendix A).
3. **Seafarers core rules:** sea and coast, ships, moving ships, shipping routes counting toward the longest route, gold fields, the pirate, fog hexes and discovery, harbors from map data, and special victory points such as settling a new island.
4. **Scenarios.** Only **Heading for New Shores** in this milestone (§18). Fog is supported by the engine and tested on a small test map, but no room offers a fog scenario yet. **(D3)**
5. **Room creation options:** expansions, scenario or map, points to win, house-rule toggles (§19).

---

## 2. Terms

- **Hex types:**
  - land: wood, brick, sheep, wheat, ore, gold, desert;
  - `sea`;
  - `fog` (face down; becomes land or sea when discovered).
- **Edge kinds,** from the two hexes on either side of an edge (an edge with only one hex borders the map's outer edge, which counts as sea):
  - **land edge:** both sides are land.
  - **coast edge:** one land side and one sea side.
  - **sea edge:** both sides are sea.
  - **An edge with a fog hex on one side** takes its kind from the known side (§11.4).
  - **An edge with fog on both sides** has no kind, and nothing can be built on it.
- **Land vertex:** touches at least one land hex. Settlements and cities can only go on land vertices.
- **Island:** a group of land hexes connected through shared edges. Fog hexes count as unknown; when one becomes land, islands are recomputed. (Explicit island lists, needed for scenarios like *Through the Desert*, will be added to the map format with that scenario.)
- **Home islands:** the islands a player's two starting settlements are on.
- **Shipping route:** a connected chain of one player's ships.
- **Trade route:** any chain of a player's roads and ships, counted for the longest route (§13).

---

## 3. Components and supply

| Item | Per player | Notes |
|---|---|---|
| Roads | 15 | as base |
| **Ships** | **15** | new; cost **1 wood + 1 sheep** |
| Settlements | 5 | as base |
| Cities | 4 | as base |

- Bank: 19 of each resource. Gold is not a card: gold fields pay out in normal resources (§7).
- Development deck: same 25 cards as base.
- **Robber:** one, on a land hex, or off the board if the scenario starts it off.
- **Pirate:** one, on a sea hex, or off the board if the scenario starts it off.
- **Special VP tokens** (e.g. new-island bonuses): tracked per player as public numbers, with a supply limit if the scenario sets one.

---

## 4. Maps and scenarios are data

A **map** describes the board:
- every hex: its type, its number token (or none), and whether it is fixed or drawn from a random pool;
- harbors;
- starting areas;
- islands (optional);
- where the robber and pirate start.

A **scenario** wraps a map with:
- the expansions it needs and the player counts it supports;
- the default points to win;
- special victory points;
- which optional rules are on (for example fog).

Both are plain JSON files in `packages/engine/maps/`. The engine validates every file when it loads it and refuses a broken one (Appendix A.3), so a bad map can't start a game.

Random parts of a map (shuffled terrain, number tokens, harbors, fog stacks) are drawn from the game's seeded random generator when the game starts. Fog draws happen when a hex is discovered. The same seed always gives the same game.

---

## 5. Setup

1. **Order:** the same snake draft as the base game: 1→N, then N→1.
2. **Each placement** is a settlement plus one adjacent **road or ship**:
   - a road on a land or coast edge;
   - a ship on a coast or sea edge.
3. **Where:** a starting settlement must be on a land vertex that touches at least one hex marked as a **starting area**, and must obey the distance rule. The starting area is in each scenario's data file (`start`). In *Heading for New Shores* it is **the main island only**, as in the official scenario. Starting anywhere else is refused, for people and CPUs alike, and only legal corners are highlighted. **(D5, D13)**
4. **Second settlement payout:** one resource for each adjacent producing hex.
   - **Gold:** you choose one resource (any the bank has) for each adjacent gold hex. **(D6)**
   - Desert, sea and fog pay nothing.
5. **Robber and pirate** start where the scenario says; either may start off the board.

---

## 6. Turn order

Same phases as the base game: optionally play a development card, roll, then build, trade and play in any order. New in Seafarers:

- **Move one ship per turn,** after rolling (§9), or as many as you like with the house rule. **(D9, D11)**
- **Build ships.**
- A **7** or a **Knight** moves the robber **or** the pirate (§10).
- When a roll pays out gold, a new **"choose gold"** step comes before you can act (§7).

---

## 7. Production

1. On a roll other than 7, every land hex with that number produces, unless the robber is on it. **The pirate doesn't stop production.**
2. Normal resources are paid out exactly as in the base game, including the bank-shortage rule.
3. **Gold fields:**
   - Each settlement next to a producing gold hex earns **1 resource of its owner's choice**; each city earns **2**. Any resource the bank still has can be picked; there are no separate gold cards.
   - Gold choices are made **after** normal resources are paid.
   - Every player owed gold chooses at the same time, like discarding. Each player picks exactly as many resources as they're owed, and only resources the bank still has.
   - **Bank runs low:** choices are applied as each player makes them. Each player must pick as many as they're owed, or as many as the bank still holds if that's fewer. If the bank runs dry, anyone still owed gets nothing. **(D6)**
   - Gold choices are public, the same as normal production.
4. A player owed gold who has nothing left to choose (empty bank) skips the step.

---

## 8. Building

### 8.1 Roads (1 wood, 1 brick)
- Only on a **land edge** or **coast edge**.
- Must connect, at either end, to one of:
  - your own **settlement or city**, or
  - your own **road**, at a vertex with no opponent building on it.
- **A road can't connect directly to a ship.** Roads and ships only join at one of your settlements or cities.

### 8.2 Ships (1 wood, 1 sheep)
- Only on a **coast edge** or **sea edge**.
- Must connect, at either end, to one of:
  - your own **settlement or city**, or
  - your own **ship**, at a vertex with no opponent building on it.
- **A ship can't connect directly to a road.**
- **Never on an edge of the pirate's hex** (§10).
- A coast edge holds a road **or** a ship, not both.

### 8.3 Settlements (as base)
- On a free land vertex, obeying the distance rule.
- Must touch your **road or ship**. A ship on the coast is enough to settle at its end.
- If this is your first settlement on an island you've never built on before and that isn't one of your home islands, you may earn special VP (§15).

### 8.4 Cities
Unchanged from the base game.

### 8.5 Development cards
Same deck and prices as the base game.

---

## 9. Moving ships

Once per turn, after rolling, you may move **one** of your ships to a new place. With the **"move ships freely"** house rule there's no limit on how many moves you make per turn; every other rule below still applies. **(D11)**

1. **Which ships can move:** the ship must be at the **open end** of a shipping route. One of its two ends must touch none of the following:
   - your settlement or city;
   - another of your ships.

   An opponent's building at that end doesn't count as a connection.
2. **Ships in a closed route can't move.** A route that links two of your buildings is closed, so its end ships are attached at both ends. This follows from rule 1 and isn't checked separately.
3. **A ship built this turn can't move.**
4. **Ships next to the pirate are stuck:** a ship on an edge of the pirate's hex can't move, and a ship can't be moved there.
5. **Where it can go:**
   - The ship is first taken off the board.
   - The new edge must be a legal ship placement under §8.2, with the ship already removed.
   - The new edge must be different from the one it left.
6. Moving costs nothing. It can change who holds the longest route, which is recalculated afterwards.
7. Moving a ship next to a fog hex discovers it, the same as building (§11). **(D8)**

---

## 10. The robber and the pirate

1. **On a 7** (after discards) or **a Knight,** the player chooses one:
   - **Robber:** move it to a different **land** hex. Not sea, fog or undiscovered hexes; the desert is allowed. Then steal one random resource from an opponent who has a settlement or city on that hex and holds cards. This is the same as the base game.
   - **Pirate:** move it to a different **sea** hex. Then steal one random resource from an opponent who has a **ship on an edge of that hex** and holds cards. **(D7)**
2. If either piece starts off the board, it can be placed anywhere legal.
3. **Robber effects:** its hex produces nothing (unchanged).
4. **Pirate effects:**
   - No ship can be **built on, moved onto, or moved off** an edge of the pirate's hex.
   - It doesn't block roads, settlements or production.
5. Who can be stolen from is public; which card was stolen is seen only by the thief and the victim, as in the base game.

---

## 11. Discovering hexes (fog)

Used by scenarios with fog, such as *The Fog Islands*.

1. **Fog hexes start face down.** The scenario provides two secret **fog stacks**:
   - terrain tiles (land types, gold and sea);
   - number tokens.
2. **Revealing:** when you **build or move** a road or ship onto an edge with a fog hex on either side, that fog hex is revealed. Free roads from Road Building count as building. **(D8)**
   - Draw a random terrain from the stack.
   - If it's land other than desert, also draw a random number token.
3. **The reward** goes to whoever revealed it:
   - **Resource land:** 1 card of that resource, if the bank has one.
   - **Gold:** 1 resource of your choice. **(D8)**
   - **Desert or sea:** nothing.
4. **Building on edges next to fog:**
   - An edge with fog on one side and a known hex on the other can take:
     - a **ship**, if the known side is sea;
     - a **road**, if the known side is land.
   - An edge with fog on **both** sides can take nothing.
   - The fog hex is revealed straight after the piece is placed. However the hex turns out, the piece stays legal:
     - a road becomes a coast or land edge;
     - a ship becomes a coast or sea edge.

5. **Running out:** if the number-token stack is empty when land is revealed, the hex gets no number. Our maps are written so this can't happen, and the map checker requires it.
6. **What's hidden:** the contents of the fog stacks, like the dev deck, never leave the server. Players see only how many fog hexes are left.

---

## 12. Harbors and trading

- Harbors are placed by the map: a hex, one of its six sides, and a type (3:1 or a 2:1 resource). Some maps instead shuffle a set of harbor types onto fixed harbor spots.
- A harbor's side must be a coast edge.
- A settlement or city on either end of a harbor's edge gets that harbor's rate. This is the same as the base game.
- Trading is otherwise unchanged.
- **Ships give no trade rate,** even when they touch a harbor.

---

## 13. Longest trade route (replaces Longest Road)

1. A trade route is a path of your roads and ships, with no edge used twice.
2. **Roads and ships join only at a vertex with your own settlement or city on it.** Road to road and ship to ship join anywhere, except at a vertex with an opponent's building.
3. An opponent's settlement or city on a vertex **breaks** the route there, for roads and ships alike.
4. **Holding it:**
   - You need 5 or more pieces in a row, and it's worth 2 VP.
   - If two players tie, whoever already holds it keeps it.
   - If the holder drops below the leader and the leaders are tied, nobody holds it.

   All of this is the same as the base game. The log and board call it **"Longest Trade Route"** when Seafarers is on.
5. It's recalculated whenever a road or ship is built or moved, or a settlement is built.

---

## 14. Development cards

| Card | Change in Seafarers |
|---|---|
| **Knight** | Moves the robber **or** the pirate (§10). Counts toward Largest Army as usual. |
| **Road Building** | Build **2 pieces for free**, each a road or a ship, in any mix, following normal placement rules. You may stop early. |
| Year of Plenty, Monopoly, Victory Point | Unchanged. |

---

## 15. Victory points and winning

1. **Points to win:** the scenario's target by default (§18). The room creator can change it (§19).
2. **Special VP, "settling a new island":**
   - The first settlement you build on an island earns the scenario's bonus (usually 2 VP) if the island has no hex of the scenario's **starting area** and you haven't built on it before. Starting settlements never earn it. The amount (`specialVP.newIsland`) and the starting area (`start`) are both in the scenario's data file. **(D5, D13)**
   - A map whose starting area is "all" (custom maps, and games saved before D13) falls back to the old rule: the islands of your starting settlements are your home islands.
   - Each player can earn this once per island.
   - Other players building there doesn't affect you.
   - Upgrading to a city adds nothing more.
   - These points are public.
3. **Other special VP:** some scenarios award points for other things (batch 2: wonders, cloth, the forgotten tribe). The engine will have a generic per-player special-VP counter, so each scenario just adds to it.
4. **Winning:** unchanged from the base game. Total VP (including special VP and hidden VP cards) at or above the target, checked on your own turn.

---

## 16. Hidden information

New hidden things, kept server-only and allowlisted in `viewFor` like the rest:
- the contents of the fog stacks;
- terrain and numbers drawn for hexes that are still fog;
- random map draws not yet revealed.

Players see:
- which hexes are fog;
- how many tiles and tokens are left in each fog stack;
- everything already revealed.

Gold choices, ship moves, pirate moves and discoveries are all public. Steals by the pirate are redacted exactly like robber steals.

---

## 17. New invariants the simulator will check after every move

Everything from the base game, plus:

1. **Resources are conserved:** for each resource, the bank plus all hands equals 19. Gold and discovery rewards both come from the bank.
2. **Pieces are conserved:** for each player, ships on the board plus ships in supply equals 15, alongside roads, settlements and cities.
3. **Pieces are on legal edges:**
   - every ship is on a coast or sea edge;
   - every road is on a land or coast edge;
   - no edge holds two pieces;
   - no piece is on an edge that still borders a fog hex. Revealing happens in the same move as placing, so this always holds after a move.
4. **Ships are connected:** every ship belongs to a chain of its owner's ships that reaches one of its owner's settlements or cities. As with roads, the chain may pass a vertex where an opponent settled later: building rules stop new ships passing there, but ships already placed stay connected. Moving ships and the pirate must never leave a ship stranded.
5. **Roads are connected**, the same as the base invariant, but roads can't pass through ships.
6. **The robber is on a land hex** (not sea, not fog) or off the board. **The pirate is on a sea hex** or off the board.
7. **No ship touches the pirate's hex** unless it was already there when the pirate arrived. Checked as a rule about each move: no move builds or moves a ship onto or off an edge of the pirate's hex.
8. **Ship moves:** at most one per turn, never a ship built that turn, and the moved ship was at an open end.
9. **Fog accounting:** fog hexes left plus revealed fog hexes equals the scenario's fog count, and the stacks always hold enough to finish revealing.
10. **Special VP:** each island bonus is held at most once per player per island, never for a home island or the starting area, and matches the settlements on the board in both directions: every bonus has a settlement on its island, and every island outside the starting area that a player has built on earned them its bonus.
11. **Starting area:** every starting settlement is in the scenario's starting area (checked on every setup move).
12. **Longest trade route:** the holder matches a full recalculation, using the same tie rules as the base game.
13. **Gold:** after the gold step, no one is owed gold unless the bank ran out.
14. **Determinism:** replaying every Seafarers game from its seed and moves gives the identical state, as for the base game.

The simulator will play **1,000+ random games across every scenario and player count** each run. The random agent learns to build ships, move them, choose the pirate, and pick gold.

---

## 18. Scenarios

### 18.1 This milestone: Heading for New Shores

| | |
|---|---|
| Players | 3 or 4 (Seafarers is 3–4 players only) **(D4)** |
| Points to win | 14 |
| Special VP | 2 for each player's first settlement on each small island **(D5, D13)** |
| Start | The main island only **(D13)** |
| Fog | none |
| Robber | starts on the desert |
| Pirate | starts off the board; it arrives the first time someone chooses it on a 7 or Knight |

**Layout:** our own map in the spirit of the official one, not a copy of it **(D2)**:
- a 19-hex main island, with the standard terrain mix and numbers, shuffled each game;
- a ring of sea around it;
- four small islands of 3 hexes each, holding 2 gold fields among them, with shuffled terrain and numbers;
- 9 harbors around the main island, shuffled each game.

The file is `packages/engine/maps/heading-for-new-shores.json`.

### 18.2 Later

The other official scenarios come later, each with its own win target and special VP **(D5)**:
- The Four Islands, The Fog Islands, Through the Desert, New World (core rules only);
- The Forgotten Tribe, Cloth for Catan, The Pirate Islands, The Wonders of Catan (each with its own rules).

The module design (§20) leaves room for all of them without changing core rules.

---

## 19. Room options

Set when the room's game is created. All of them are shown to everyone in the lobby, and all are saved with the game:

- **Expansions:**
  - Base only (default), or Seafarers.
  - Later, Cities & Knights and C&K + Seafarers, greyed out until built.
- **Scenario or map:**
  - with Seafarers, Heading for New Shores (3–4 players only);
  - without Seafarers, the classic random board.
- **Points to win:** defaults to the scenario's target; can be set from 8 to 20.
- **House-rule toggles,** each off by default **(D11)**:
  - **No 7s in the first round:** while it is any player's first turn, a roll of 7 is re-rolled automatically, and the re-roll is shown. Works with or without Seafarers. Later, with Cities & Knights: "no 7s until the barbarians have attacked once".
  - **3:1 bank trades for everyone:** the default bank rate is 3:1 instead of 4:1; 2:1 harbors still give 2:1.
  - **Move ships freely** (Seafarers only): no limit on ship moves per turn.

---

## 20. How this fits the engine (design notes)

- **Game config:** each game stores `config.modules`, e.g. `["base"]` or `["base", "seafarers"]`, plus the scenario id, points to win and house rules. The state is saved and replayed with it.
- **Modules:** each module contributes:
  - its slice of game state (e.g. `ships`, `pirate`, `fog`, `goldOwed`);
  - its actions (`ship`, `moveShip`, `pirate`, `chooseGold`);
  - its events;
  - its legal-move list;
  - its invariants;
  - its view fields (with redaction).

  Base rules call extension points such as "who can be stolen from here", "what counts toward the longest route" and "where can setup pieces go". Base code never checks `if (seafarers)`.
- **Combining with C&K:** knights and city walls only touch land, so they won't conflict with ships. Where both expansions affect the same thing (C&K's barbarians and Seafarers' pirate; C&K's "Merchant Fleet" and harbors), the combined rules go in a small dedicated module that is only loaded when both are on.
- **Saved games:** today's base games carry engine version 1. Before restructuring, I'll record the full move logs of 12 seeded base games (2–4 players). After restructuring, a test will require them to replay to byte-identical states, along with the games already saved on the live server. If the restructure changes anything a base game can see, it fails.

---

## Appendix A: map and scenario file format

### A.1 Coordinates
- Hexes use axial `q, r` coordinates with pointy tops, like the current engine.
- **Hex sides are numbered 0–5 clockwise, starting with the east side:** 0 east, 1 south-east, 2 south-west, 3 west, 4 north-west, 5 north-east.
- Harbors and start areas refer to `[q, r]` coordinates and side numbers, never to engine edge ids, so files stay readable and editable.
- **The order of `hexes` defines the board's internal ids.** Never reorder the hexes of a map that has been played, or saved games would replay on a different board.

### A.2 Example

```json
{
  "format": 1,
  "id": "heading-for-new-shores",
  "name": "Heading for New Shores",
  "modules": ["seafarers"],
  "players": [3, 4],
  "winVP": 14,
  "specialVP": { "newIsland": 2 },
  "hexes": [
    { "q": 0, "r": -2, "t": "random", "pool": "main", "n": "random" },
    { "q": -3, "r": 0, "t": "sea" },
    { "q": 4, "r": -1, "t": "random", "pool": "isles", "n": "random" },
    { "q": 5, "r": 0, "t": "fog" }
  ],
  "pools": {
    "main": { "terrain": ["wood", "wood", "sheep", "desert"], "numbers": [2, 3, 12] },
    "isles": { "terrain": ["gold", "ore"], "numbers": [5, 9] }
  },
  "fog": { "terrain": ["sea", "wood"], "numbers": [4] },
  "harbors": [{ "q": -2, "r": 0, "side": 3, "t": "random" }],
  "harborPool": ["any"],
  "numberRules": { "noAdjacentRed": true, "noAdjacentSame": true },
  "start": "all",
  "robber": "desert",
  "pirate": null
}
```

(Shortened: a real file lists every hex, and pool sizes must match.)

Field notes:

| Field | Meaning |
|---|---|
| `t` | `wood`, `brick`, `sheep`, `wheat`, `ore`, `gold`, `desert`, `sea`, `fog`, or `random` (drawn from `pool`) |
| `pools` | Random terrain lists and number tokens, shuffled with the game's seed in the order listed |
| `harborPool` | Types shuffled onto harbors marked `random` |
| `n` | a number token, `"random"` (from the pool's numbers), or absent |
| `start` | the starting-area hexes |
| `robber` / `pirate` | a hex, `"desert"`, or `null` (off the board) |

### A.3 Checks on load
A map is refused unless all of these hold:
- the coordinates are unique;
- the pool counts match the number of hexes drawing from them;
- every harbor sits on a coast edge;
- every start hex is land;
- the robber starts on land and the pirate on sea;
- the fog stacks are big enough;
- the number rules can be satisfied (or the map uses fixed numbers);
- the player counts are 2–6.

---

## Decisions

Your answers to the questions in the first draft:

1. **D1 Edition:** the current (5th) edition.
2. **D2 Layouts:** start with one default Seafarers map, our own in the official spirit.
3. **D3 Scenarios:** only Heading for New Shores in this milestone.
4. **D4 Players:** Seafarers games need 3 or 4 players.
5. **D5 Special VP:** set per scenario (to be decided as we add them). Heading for New Shores gives 2 VP per new island settled. Starting settlements may go on any island; islands you start on are home islands and earn no bonus.
6. **D6 Gold:** you pick any resource you want. There are no gold cards; the only limit is that the bank must have the resource.
7. **D7 Pirate:** steals only from players with a ship on its hex; freezes ships on its hex's edges (no building, no moving on or off). It starts off the board in Heading for New Shores.
8. **D8 Fog:** moving a ship next to fog discovers it; discovering gold gives a resource of your choice; an edge with fog on one side is buildable according to its known side.
9. **D9 Moving ships:** after rolling, one per turn, never a ship built this turn.
10. **D10 Robber:** any revealed land hex, including unsettled islands.
11. **D11 House rules:** no 7s in the first round; 3:1 bank trades for everyone; move ships freely. Planned for Cities & Knights: no 7s until the barbarians have attacked once.
12. **D12 CPU player:** not in this milestone. When it comes, it must never target a human player.
13. **D13 Starting area (fix, Milestone 5):** replaces the "start anywhere" part of D5. In Heading for New Shores starting settlements go on the main island only, as the rulebook says, and each player earns 2 VP for their first settlement on each small island. Both rules come from the scenario's data file (`start`, `specialVP.newIsland`). Games already saved keep the rule they were started with.
14. **D14 Pirate start (rulebook check):** in Heading for New Shores the pirate starts on a set sea hex, not off the board.
    - The hex is (1, 3), south of the main island. It touches no land, so it hurts nobody on the first turn.
    - I couldn't check the official position (the rulebook sites are blocked from here), so this is our choice.
    - New games only; saved games keep theirs.
15. **D15 3-player layout:** with 3 players, Heading for New Shores uses `maps/heading-for-new-shores-3.json`. It's our own layout, since the official one couldn't be checked:
    - The main island's west column is sea, leaving 16 tiles: 3 of each resource and the desert.
    - The number tokens are the standard 18 without a 3, an 11 and the 12.
    - Its three harbors move to the new west coast.
    - The small islands are unchanged.
    - The pre-game table switches to it when 3 people sit down (and back with 4).
16. **D16 Fog:** confirmed as D8: moving a ship next to fog uncovers it, as well as building.
