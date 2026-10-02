# Maps: file format, editor and generator

**Status: agreed (your answers are in section 7). Being implemented.**

This covers Milestone 6's first two parts:

- **The map format and the map editor:** making, saving and sharing boards.
- **The generator:** making fair random boards from a set of rules.

The pre-game table and turn order are in [pregame.md](pregame.md).

## 1. Words

### 1.1 Hexes, corners, sides

Hexes are **pointy-top**. Each hex has six **corners** and six **sides**.

- **Corners** (where settlements go) are numbered clockwise from the top.
- **Sides** (where roads, ships and harbors go) are numbered clockwise from the east side, as in the existing map code: 0 east, 1 south-east, 2 south-west, 3 west, 4 north-west, 5 north-east.

```
                  corner 0
                     /\
         side 4    /    \    side 5
                 /        \
      corner 5  |          |  corner 1
       side 3   |   HEX    |   side 0
      corner 4  |          |  corner 2
                 \        /
         side 2    \    /    side 1
                     \/
                  corner 3
```

### 1.2 What "touching" means

Every rule below uses one of these four kinds of touching.

**Hex touches hex.** Two hexes touch when they **share a side**. Every hex has up to 6 neighbours. Sharing only a corner never happens on a hex grid, so "touch" always means "share a side". This is what "two 6s never touch" and "same resource clumps" use.

```
          ___     ___
         /   \___/   \        A touches B, C, D, E, F and G (shared sides).
         \___/ B \___/
         / G \___/ C \
         \___/ A \___/
         / F \___/ D \
         \___/ E \___/
             \___/
```

**Corner touches hex.** A corner touches the **1 to 3 hexes** it sits on. Its **pip total** is the sum of the pips of the number tokens on those hexes. The desert, sea, gold without a number, and fog all count as 0.

```
            \  hex 1  /
             \       /
     hex 2    \     /    hex 3          The corner * touches hexes 1, 2 and 3.
               \   /                    Its pip total = pips(1) + pips(2) + pips(3).
                 *
                 |
```

An **inland corner** touches three hexes that are **all land**: any terrain but sea, with the desert counting as land.

**Harbor touches.** A harbor sits on one **side** of a land hex that faces the sea.

- It touches **the two corners at the ends of that side**: the corners where a settlement can use it.
- It touches **every land hex those two corners touch**: the harbor's own hex, plus up to two coastal neighbours.
- "A harbor never touches a hex of its own resource with a good number" checks all of those hexes, because a settlement on the harbor would collect from all of them.

```
                 sea          sea
                   \  HARBOR  /
         corner a   *~~~~~~~~*   corner b        The harbor is on the side a–b of hex H.
                  /  \      /  \                 It touches corners a and b, and the
           hex L /    \ H  /    \ hex R          land hexes those corners touch:
                         \/                      H, and L and R if they're land.
```

**Corner touches corner.** Two corners touch when one side joins them. That is the distance rule. The generator only uses it in the starting-fairness check (5.12), to keep two picks from sitting next to each other.

## 2. Pips

| Number | Pips |
|---|---|
| 6 or 8 | 5 |
| 5 or 9 | 4 |
| 4 or 10 | 3 |
| 3 or 11 | 2 |
| 2 or 12 | 1 |

These are the default values of the "pips per token" setting. They're the number of ways two dice make that total out of 36. Changing them changes every pip-based rule and the heat map.

## 3. The map file

A map is the JSON format the game already uses (`packages/engine/src/map.ts`, documented in `docs/rules/seafarers.md` Appendix A), with a few **optional** additions. Files saved before this milestone stay valid.

```jsonc
{
  "format": 1,
  "id": "m-7f3a…",            // unique; set when saved
  "name": "Ann's ring island",
  "modules": [],              // ["seafarers"] if the map uses sea/gold/fog play
  "players": [3, 4],
  "winVP": 10,
  "hexes": [
    // A concrete hex: terrain and number fixed.
    { "q": 0, "r": -2, "t": "ore", "n": 10 },
    // A blank hex: filled from a pool when the game starts (as today), or by "fill the rest randomly".
    { "q": 1, "r": -2, "t": "random", "pool": "main", "n": "random" },
    // NEW, optional: locks keep this terrain and/or number when the generator fills the board.
    { "q": 2, "r": -2, "t": "wheat", "n": 6, "lock": { "t": true, "n": true } }
  ],
  "pools": { "main": { "terrain": ["…"], "numbers": [5, 2, 6] } },
  "harbors": [
    // A harbor on side `side` of land hex (q, r). Its type, or "random".
    // NEW, optional: "lock": true keeps it where it is.
    { "q": 0, "r": -2, "side": 5, "t": "any" }
  ],
  "harborPool": ["…"],
  "robber": "desert",
  // NEW, optional: where this board came from (shown in the map list; never used by the rules).
  "made": { "by": "Ann", "at": 1790000000000, "generator": { "preset": "Our rules", "seed": "k7Qp-3x" } }
}
```

### 3.1 Rules for a valid file

These are checked when a file is loaded, saved or imported. Anything wrong is refused with a short reason.

- **Hexes:**
  - Every hex position appears once.
  - Terrains are known ones.
  - Numbers are 2–6 or 8–12, and only on producing terrain (resources and gold).
- **Harbors:**
  - Each sits on a side that has land on one side and sea on the other. For a base-game map, the empty space around the island counts as sea.
  - No two harbors share a corner.
- **Pools** hold exactly as many terrains and numbers as there are blank hexes using them.
- **Modules:** a map with sea hexes inside the island, gold or fog needs `"modules": ["seafarers"]`. Those tiles only appear in the editor when Seafarers is on.
- **Fixed hex order:** the order of `hexes` is fixed once saved, because board ids come from it. The editor only ever adds hexes at the end. Removing a hex makes a new map version, and games already played keep their own copy of the map.

### 3.2 What a game keeps

- A game saves **its own full copy** of the map in its config, as it does today. Editing or deleting a saved map never changes a game played on it.
- A game started from a generated board also saves the **generator settings and seed**. The copy of the board is what the game uses; the seed is just a record of where it came from.

### 3.3 Import and export

- **Export** downloads `<name>.settlers-map.json`: the map file above.
- **Import** reads such a file, checks it as in 3.1, and saves it under a new id. If the name is taken, it becomes "Name (2)".

## 4. The map editor

The editor is reached from the start screen ("Maps") and from the pre-game table ("Edit this board", pregame.md).

### 4.1 Starting points

- A **blank board**.
- **The standard board**: the classic 19 hexes, all blank. That's today's classic board.
- **Any saved map**: editing a copy, or the map itself.

### 4.2 Tools

- **Place a tile:** pick a terrain from the palette and click (or tap) a hex. Sea, gold and fog are in the palette only when Seafarers is on.
- **Place a number token:** pick a number and click a producing hex. Clicking with no number picked removes the token.
- **Place a harbor:** pick a harbor type and click a coastal side.
- **Drag** a tile, number or harbor to swap it with another, or move it to an empty spot.
- **Reshape:** "Add hex" places a new hex next to the board; "Remove hex" deletes one. The board can be any shape, including islands with sea between them.
- **Lock / unlock:**
  - Lock a hex's terrain, its number, or a harbor.
  - Locked things show a small padlock.
  - "Fill the rest randomly" and the generator never change them.
- **Fill the rest randomly:** runs the generator (section 5) on every blank tile, number and harbor, using the chosen preset. Everything already placed stays, locked or not. If the rules can't be met around what's placed, it says which rule (5.13). Rules that only placed pieces break (two 6s you put side by side, say) are left alone: they show as warnings.
- **Clear unlocked:** turns everything that isn't locked back to blank (one step). "Clear unlocked" then "Fill the rest" regenerates everything but the locks.
- **Undo / Redo:** every change is one step (Ctrl+Z / Ctrl+Shift+Z, or buttons). A fill is one step. The history covers the whole editing session.

### 4.3 What the editor shows as you work

- **Heat map:** every corner shows its pip total as a small badge. The colour runs from dim (low) to bright (high) in one hue, so it reads in colorblind modes, and the number is always printed. It can be switched off.
- **Warnings:** a list of every generator rule (section 5) the current board breaks, with the hexes, corners or harbors involved highlighted. Warnings **never block saving**, because a custom map may break rules on purpose.
- **Fairness summary:** the same summary the generator shows (5.14).
- **Counts:** tiles and tokens on the board compared with the standard set, for example "4 wood · 3 brick · …", and the number tokens used.

### 4.4 The map list

Each map has **Open, Rename, Duplicate, Delete** (two confirmations) and **Export**, plus **Import** at the top. Each entry shows the name, who made it, when, and a small preview.

## 5. The generator

The generator fills a board: every unlocked hex and harbor of a **shape** (the standard board, or any map's layout of land and sea) under the rules below.

- Each rule can be turned **on or off**.
- Where it makes sense, a rule has an **adjustable number**.
- A set of settings is a **preset**.

**"Our rules"** is the default preset: every rule below on, with the default numbers.

| # | Rule | Setting (default) |
|---|---|---|
| 5.1 | Pips per token | table in section 2 |
| 5.2 | Red numbers never touch | on |
| 5.3 | 2:1 harbor not on its own resource with a good number | on; "good" = 6/8 (option: also 5/9) |
| 5.4 | No 6 or 8 touching any harbor | **off** (stricter, opt-in) |
| 5.5 | Best-spot limit | on, 12 |
| 5.6 | Bad-spot limit (inland corners) | on, 4 (Q3) |
| 5.7 | 2 and 12 never touch | on |
| 5.8 | No clusters of 2, 3, 11, 12 | on |
| 5.9 | Same number never touches itself | on |
| 5.10 | Resource clump limit | on, 3 hexes |
| 5.11 | Resource balance | on, each resource within ±25% of its fair share (Q4) |
| 5.12 | Starting fairness | on, gap ≤ 4 pips (Q5) |
| 5.15 | Desert | random (center / edge / random / none) |
| 5.16 | Harbors | standard positions (standard / random) |
| 5.17 | Numbers | random within the rules (official spiral / random) |

### How each rule is checked

The same functions run in three places:

- inside the generator;
- as the editor's warnings;
- in the separate **checker** that the tests run over 10,000 maps per preset.

The checker is written separately from the generator: it only reads a finished board and the settings.

**5.2 Red numbers never touch.** For every pair of touching hexes (section 1.2), it's a violation if both have a 6 or 8. That includes 6-6, 8-8 and 6-8.

**5.3 Harbors and good numbers.** For every 2:1 harbor of resource R, it's a violation if any land hex the harbor touches (section 1.2) is R and has a good number. Good numbers are 6 or 8, or also 5 and 9 with that option on.

**5.4 No 6 or 8 at any harbor.** For every harbor, of any type, it's a violation if any land hex it touches has a 6 or 8.

**5.5 Best-spot limit.** For every corner, it's a violation if its pip total (section 1.2) is above the limit. This counts every corner, coastal ones too.

**5.6 Bad-spot limit.** For every **inland** corner, it's a violation if its pip total is below the limit. The desert counts 0, so a corner on the desert counts as weak.

**5.7 2 and 12 never touch.** For every pair of touching hexes, it's a violation if one has a 2 and the other a 12.

**5.8 No clusters of 2, 3, 11, 12.** For every corner, it's a violation if two or more of the hexes it touches have a 2, 3, 11 or 12. So no settlement spot has more than one of these weakest numbers.

**5.9 Same number never touches.** For every pair of touching hexes, it's a violation if both have the same number.

**5.10 Clump limit.** Hexes of the same resource that touch form a clump: each connected group, following shared sides. It's a violation if a clump is bigger than the limit. The desert, sea and gold don't clump.

**5.11 Resource balance.** For each resource R:

- **Its total** is the pips of every R hex added up.
- **Its fair share** is the board's total pips × (R hexes ÷ producing hexes). On the standard board that's 58 pips over 18 numbered hexes, so a resource with 4 hexes has a fair share of 12.9 pips, and one with 3 hexes 9.7.
- It's a violation if R's total is outside fair share ± the allowed percentage.

**5.12 Starting fairness.** This simulates the setup draft for the table's player count (3 or 4; a preset can fix it):

1. **Players pick in snake order:** 1, 2, …, n, n, …, 2, 1.
2. **Each pick** takes the free corner with the highest pip total that follows the distance rule. Ties go to the corner with more different resources, then to the first in board order.
3. **Each player's score** is their two corners' pip totals added up.
4. **The gap** is the best player's score minus the worst's. It's a violation if the gap is above the limit.

This "greedy draft" is a deliberately simple model of real picks. It catches boards where the first picks are far better than the last.

### 5.13 Search, speed, and settings that can't work

**How it searches:**

- The generator does a constraint search. It doesn't place randomly and retry.
- **Order:** first the desert, then terrains (clump limit), then numbers (the touching rules and corner limits), then harbor types (harbor rules). Last come the whole-board checks: balance and fairness.
- **Backtracking:** each choice is checked as it's made. A choice that breaks a rule is undone at once, rather than discovered at the end.
- Within each step, the order of choices comes from the seed.

**The same seed always gives the same board:**

- The search is limited by a **count of steps**, not by the clock, so it finishes the same way on any computer.
- A clock limit of 1 second is only a safety net. If it ever fires, it's reported as an error, never quietly turned into a different board.
- The aim is under 200 ms for "Our rules" on the standard board, and under a second for anything.

**Easing the spot rules (D7):**

- The spot rules are the best-spot limit (5.5), the bad-spot limit (5.6) and no clusters of 2, 3, 11, 12 (5.8).
- The search first uses three quarters of its step budget with every rule as set. Nearly every board is found this way.
- If that runs out, the last quarter eases only the spot rules by one step: the best-spot limit +1, the bad-spot limit −1, and at most one pair of 2/3/11/12 touching.
- An eased board shows its warning like any other, so it's never hidden.
- Every other rule is never eased.
- If the eased search fails too, the generator says why, as below, using the rules as set.

**When it can't find a board, it says why:**

- It retries with each rule switched off in turn, to find which rules are blocking. Each retry has a small step budget.
- **The message names the rule and suggests a fix,** for example:
  - "No board fits: the best-spot limit of 9 is too low. The lowest that works with your other rules is about 11."
  - "No board fits: resource balance ±5% together with the clump limit of 1."
- Some settings can't work at all and are refused at once, before any search. For example, a clump limit of 0, or a best-spot limit below the highest single token.

### 5.14 Fairness summary

Shown under every board: in the editor, the pre-game table and the end screen.

- **Pips per resource:** for example "Ore 11 · Wheat 14 · …", each with its fair share.
- **Best corners:** the top three, as pip total and resources.
- **Worst inland corner:** the lowest.
- **Starting-fairness gap:** for 3 and for 4 players, with the snake-draft picks it assumed.

### 5.15–5.17 Layout options

**5.15 Desert:**

- **Center:** the middle hex of the shape.
- **Edge:** a random coastal hex.
- **Random:** any land hex.
- **None:** see question Q2.

**5.16 Harbors:**

- **Standard positions:** the 9 harbor spots of the standard board, with types shuffled. On other shapes it uses the map's own harbor spots.
- **Random positions:** coastal sides chosen so that no two harbors share a corner and they're spread around the coast. Same count: 4 any, one of each resource.

**5.17 Numbers:**

- **Official spiral:** the official token order (A–R: 5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11), laid in a spiral from one of the 6 outer corners, in either direction, skipping the desert. That gives 12 layouts. The search tries them in seeded order and keeps the first that meets the other rules. This only works for the standard shape.
- **Random within the rules:** any arrangement that meets the rules.

### 5.18 Seeds and presets

- **Seeds:** every generated board has a short seed, for example `k7Qp-3x`. The same settings and seed give the same board, every time.
  - The pre-game table shows the seed with a copy button.
  - Typing a seed in regenerates that board.
- **Presets:**
  - Named sets of settings, saved for everyone.
  - "Our rules" (all on, defaults) and "Anything goes" (all off) can't be deleted.
  - Others can be added, renamed and deleted.

## 6. Tests ("done means" for this part)

1. **The checker:**
   - 10,000 generated boards per preset (every built-in one, and the test presets) are checked with **zero violations** of every rule except the spot rules.
   - The spot rules are also never broken, except on eased boards (D7). Those stay rare (under 1% per preset), and each breaks them by at most one step. The rate is reported per preset.
   - The same seed always gives the same board.
   - Each preset generates in under a second.
2. **Impossible settings fail fast** (under 2 seconds) with a message naming the blocking rule. There's a list of known-impossible settings, each with its expected message.
3. **Saved maps load identically:**
   - Save → load → save gives byte-identical JSON.
   - Export → import gives the same board.
   - A game started on a map rebuilds identically after a server restart.
4. **Editor actions have tests:** place, remove, swap, drag, lock, fill-the-rest (keeps locks), undo/redo after every kind of action, reshape, rename/duplicate/delete, import of a bad file.
5. **A full 3-player game** on a custom map, and another on a generated map (both in browsers, Part C of pregame.md).

## 7. Decisions

1. **D1 Showing each part:** I show each part working (screenshots and a short walkthrough) and carry on unless you say stop.
2. **D2 No desert:**
   - "None" is a desert setting (5.15), alongside center, edge and random.
   - The 19th hex becomes a random resource with an extra token from 3–5 or 9–11.
   - The robber starts off the board.
3. **D3 Bad-spot limit:**
   - Default 4.
   - Corners on the desert are left out by default, with a switch to include them.
4. **D4 Resource balance:** ±25% of fair share by default, with its own on/off switch.
5. **D5 Starting fairness:** a gap of at most 4 pips by default, with its own on/off switch.
6. **D6 Player counts:** generated boards for 2, 3 and 4 players.
7. **D7 Spot rules are soft:** a board may now and then have a spot a little too good or too bad, as long as that's rare (your note, 2 October). The generator eases only the spot rules, and only when the strict search runs long (5.13).
