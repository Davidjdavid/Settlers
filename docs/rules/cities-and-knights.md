# Cities & Knights: rules as we will implement them

**Status: agreed (your answers are recorded under Decisions at the end). Being implemented.**

This document is the contract for the Cities & Knights (C&K) milestone. The engine, the simulator's invariants and the tests will follow it exactly. If something here is wrong, it should be fixed here first.

**Sources.** I'm working from the current (5th) edition of *Catan: Cities & Knights* and its Seafarers combination rules, which is what Catan Universe plays, as best I know it. I can't open Catan Universe from here to check its behaviour, so every point where I'm unsure, or where editions differ, is a question in §24, marked **(Qn)**, with the default I'll use if you say "default".

Everything in the base game (SPEC.md) and, when combined, in Seafarers (docs/rules/seafarers.md) still applies unless this document changes it.

---

## 1. Scope of this milestone

1. **A `citiesKnights` rule module** that works on its own (on the classic map) and combined with `seafarers` (on Heading for New Shores). Like Seafarers, it lives in its own module with its own state key (`state.ck`); base rules call hooks and never test `if (citiesKnights)`. A classic game's config stays exactly `{ winVP: 10 }`, and the 12 golden base games and every Seafarers test must replay exactly as before.
2. **Everything in your list:** commodities, the three improvement tracks with their level-3 abilities and metropolises, the event die, the three progress decks (every card, §14), the barbarians and their attacks, knights (building, levels, activating, moving, displacing, chasing the robber), city walls, the merchant, Defender of Catan points, and the robber staying inactive until the first attack.
3. **Built in three steps** (§22), each shown working before the next:
   1. commodities and city improvements (with level-3 abilities and metropolises);
   2. knights and barbarians (with walls, Defender of Catan, the sleeping robber);
   3. progress cards and the merchant.
4. **Done means:** 1,000+ simulated C&K games and 1,000+ C&K + Seafarers games pass with the new invariants (§20); all earlier tests still pass; a 3-browser end-to-end C&K game passes; it's deployed; and the bot plays C&K, badly (**Q1**).

---

## 2. Terms

- **Resources:** wood, brick, sheep, wheat, ore (unchanged).
- **Commodities:** paper, cloth, coin. Only cities produce them.
- **Cards in hand** means resources plus commodities. This is what the hand limit counts, what the robber steals and what Saboteur, Wedding and Master Merchant take. Progress cards are never "cards in hand" for these rules.
- **Improvement tracks** (one per commodity, each with levels 0–5):
  - **Trade** (yellow), bought with cloth.
  - **Politics** (blue), bought with coin.
  - **Science** (green), bought with paper.
- **Event die:** a six-sided die with three ship faces and three city-gate faces (one yellow, one blue, one green).
- **Production dice:** the yellow die and the red die. Their total is the production number, exactly like the two base dice.
- **Knight:** a piece on a land vertex. It has a **strength** (1 basic, 2 strong, 3 mighty) and is **active** or **inactive**.
- **Building:** a settlement or a city (a metropolis is a city). Knights are not buildings.
- **Piece at a vertex:** a building or a knight. A vertex holds at most one piece.
- **Barbarian strength:** the number of cities on the board, metropolises included.
- **Defense:** the total strength of all active knights on the board.

---

## 3. Components and supply

| Component | Count | Notes |
|---|---|---|
| Resource cards | 19 of each | unchanged |
| Commodity cards | unlimited (paper, cloth, coin) | anyone can hold any number; **D2** |
| Progress cards | 54: 18 trade, 18 politics, 18 science | three face-down decks, listed in §14 |
| Defender of Catan cards | 6 | 1 VP each |
| Metropolises | 3 (one per track) | |
| Merchant | 1 | |
| Barbarian ship | 1 | on a 7-step track |
| Per player: settlements, cities, roads | 5, 4, 15 | unchanged (ships 15 with Seafarers) |
| Per player: knights | 2 basic, 2 strong, 2 mighty | promoting needs a free piece of the next level |
| Per player: city walls | 3 | |

**No development cards** and **no Largest Army** in C&K. Buying development cards is not a legal action and the deck isn't created. Longest road (or longest trade route with Seafarers) stays, worth 2 VP.

---

## 4. Setup

1. Same snake order as the base game (or the Seafarers scenario).
2. **The first placement is a settlement and the second is a city**, each with its road (or ship with Seafarers).
3. **Starting resources:** for the city only, one **resource** for each adjacent land hex that produces one. No commodities. A gold hex gives a resource of the player's choice, as in Seafarers. The desert gives nothing.
4. The robber starts on the desert (or wherever the map says) and is **asleep** (§13). With Seafarers, the pirate is also asleep (**Q12**).
5. The barbarian ship starts at step 0 of 7. Every improvement track is at 0. The three progress decks are shuffled with the game's PRNG during `newGame`.

---

## 5. A turn

1. **Before rolling**, you may play **Alchemist** (§14.3). It is the only card that can be played before the roll.
2. **Roll** all three dice at once. Resolution order (5th edition):
   1. **Event die** (§6): either the barbarians advance (and maybe attack), or players draw progress cards.
   2. **Production** for the production number (§7). On a 7: discards, then the robber if it's awake (§13).
   3. Then any choices this created (gold, Aqueduct, discards, progress-card overflow, cities lost to the barbarians…) are made before the turn continues. Players who owe a choice are shown it at once and may answer in any order; the turn continues when nobody owes one.
3. **Main phase:** in any order, as often as you can afford: trade with players or the bank, build, buy improvements, build/activate/promote knights, take knight actions, play progress cards (any number per turn; including cards drawn this turn) (**Q8**), and with Seafarers build/move ships as before.
4. **End turn.**

**Winning:** 13 VP by default (**Q4**). As in the base engine, you win only on your own turn: as soon as any action of yours leaves you at or above the target. Points gained on someone else's turn (Printer, Constitution, Defender of Catan) count from your next action.

---

## 6. The event die

Faces: ship, ship, ship, yellow gate, blue gate, green gate (each 1 in 6 for a colour, 1 in 2 for the ship).

### 6.1 Ship

The barbarian ship moves one step. When it reaches step 7 it attacks (§10), then returns to step 0.

### 6.2 City gate

Each player whose level in the gate's colour lets them draws one card from the top of that colour's deck. Level *L* draws when the red die is **at most L + 1**:

| Level | Red die that draws |
|---|---|
| 0 | never |
| 1 | 1–2 |
| 2 | 1–3 |
| 3 | 1–4 |
| 4 | 1–5 |
| 5 | 1–6 (always) |

Players draw in turn order starting with the player whose turn it is. If the deck is empty, nobody else draws. Victory-point cards (Printer, Constitution) are revealed and placed in front of the player at once. Draws happen on every roll, including a 7.

### 6.3 Progress card hand limit

You may hold at most **4** progress cards (VP cards don't count). If a draw gives you a 5th on someone else's turn, you must at once choose one to put face down under its deck. If it's your own turn, you keep all 5 and can play them as usual; you just can't end your turn holding more than 4 (play one, or put one under its deck) (**D8, D9**).

---

## 7. Production

The production number works exactly as in the base game (robber blocks its hex, bank shortage rule), with these changes for **cities**:

| Hex | Settlement gets | City gets |
|---|---|---|
| Forest | 1 wood | 1 wood + 1 paper |
| Pasture | 1 sheep | 1 sheep + 1 cloth |
| Mountains | 1 ore | 1 ore + 1 coin |
| Hills | 1 brick | 2 brick |
| Fields | 1 wheat | 2 wheat |
| Gold (Seafarers) | 2 of choice | 2 resources of choice; no commodities (**Q13**) |

- **Commodities never run out** (**D2**). The bank shortage rule still applies to resources.
- **Aqueduct** (science level 3, §8.2): if a production roll other than 7 gives you nothing at all (no resource, no commodity, no gold), you take 1 resource of your choice from the bank. This is a choice like gold. (**Q10**)

---

## 8. City improvements

### 8.1 Buying

- **Cost:** level *n* of a track costs *n* of its commodity: trade = cloth, politics = coin, science = paper. Going from 0 to 5 costs 1+2+3+4+5 = 15.
- One level at a time, during your main phase, as many as you can afford.
- **You need at least one city** on the board to buy any level (**Q5**).
- Crane (§14.3) lowers the cost of one level by 1 commodity.
- Levels never go down, even if you lose cities to the barbarians.

### 8.2 Level-3 abilities

These are active permanently from level 3 and apply only to the owner.

| Track | Level 3 | Ability |
|---|---|---|
| Trade | Trading House | Trade **commodities** with the bank at **2:1**, for any resource or commodity. |
| Politics | Fortress | Your knights can be promoted to **mighty** (strength 3). Without it, strength 2 is the limit (also for Smith and Deserter). |
| Science | Aqueduct | See §7: a non-7 roll that gives you nothing gives you 1 resource of your choice. |

### 8.3 Metropolises

- **The first player to reach level 4 in a track gets that track's metropolis**, placed on one of their cities that doesn't already have one. A player can hold more than one metropolis, each on a different city.
- **Taking a metropolis:** if another player reaches level **5** in that track while the holder is still at 4, they take it (it moves to one of their cities). A holder at level 5 keeps it for good. Reaching 4 when someone already holds it gives nothing.
- **You can't buy level 4 or 5 if it would earn you a metropolis and you have no city without one** (**Q5**).
- A metropolis is **worth 2 VP more** than a city (4 in total). It can't be reduced by the barbarians, and it still counts as a city everywhere else (production, barbarian strength, city walls).
- The owner picks which city gets it. It's a choice made at once, like gold.

---

## 9. Knights

### 9.1 Costs

| Action | Cost |
|---|---|
| Build a basic knight (inactive) | 1 sheep + 1 ore |
| Promote a knight by one level | 1 sheep + 1 ore |
| Activate a knight | 1 wheat |

### 9.2 Building, promoting and activating

- **Building:** place a basic knight from your supply on an **empty land vertex connected to your roads** (with Seafarers, roads or ships: **Q11**). There's no distance rule for knights.
- **Promoting:** basic to strong, or strong to mighty (mighty needs Fortress, §8.2).
  - You need a free piece of the higher level in your supply; the lower one goes back.
  - Each knight can be promoted at most **once per turn**, including the turn it was built.
  - Promoting keeps it active or inactive.
- **Activating:** an inactive knight becomes active. This can be done in the turn it was built.
- **Pieces at vertices:**
  - A vertex with a knight can't get a settlement. You can't build on your own knight's vertex either: move it away first.
  - Another player's knight **blocks your roads like a building**:
    - you can't extend a road or ship from that vertex;
    - it splits your longest road or trade route there.

  (**Q6**)

### 9.3 Knight actions

Only an **active** knight can act, and **not in the turn it was activated** (**Q7**). Each action makes it inactive. It can then be reactivated (1 wheat) but can't act again that turn.

1. **Move:** to an empty vertex reachable along **your own roads**. The path may pass through vertices with your own pieces, but not through vertices with another player's piece. With Seafarers, knights move along roads only, not ships (**Q11**).
2. **Displace:** move, along the same kind of path, onto a vertex holding **another player's knight with lower strength**.
   - That player must move their knight, keeping its level and active state, to an empty vertex connected to their own roads (ignoring the distance rule). It's their choice, made at once.
   - If there's no such vertex, the knight goes back to their supply.
3. **Chase the robber:** if your knight's vertex is a corner of the robber's hex, move the robber as after a 7: pick a new land hex and steal one card from a player with a building there. Not allowed while the robber is asleep (§13). With Seafarers, knights don't chase the pirate (**Q12**).

### 9.4 Limits

At most 2 knights of each strength on the board per player (6 in total).

---

## 10. Barbarian attacks

When the ship reaches step 7:

1. **Barbarian strength** = number of cities on the board (all players, metropolises included).
2. **Defense** = total strength of all active knights (all players).
3. **If barbarian strength > defense, the barbarians win.**
   - Only players with at least one city that isn't a metropolis are at risk.
   - Among them, everyone with the **lowest** active-knight strength (0 if none) loses one city. They choose which city (not a metropolis), and it becomes a settlement.
   - A city wall on it is removed.
   - If the player has no settlement piece left in their supply, the city still becomes a settlement and their settlement count may exceed 5 until they build it back up (**Q14**).
4. **If defense ≥ barbarian strength, Catan wins.**
   - The player with the **strictly highest** active-knight strength gets a Defender of Catan card (1 VP).
   - If two or more are tied for highest, each of them draws a progress card from a deck of their choice, in turn order from the current player, following the same overflow rule (§6.3).
   - A player whose active-knight strength is 0 gets nothing (so if nobody has an active knight, nothing happens).
   - If all 6 Defender cards are gone, the single winner draws a progress card of their choice instead (**Q15**).
5. **Then, either way:**
   - every knight on the board becomes inactive;
   - the ship goes back to step 0;
   - if this was the first attack, the robber wakes up (and the pirate, §13).
6. **Order within the roll:** the attack is resolved, including all city-loss choices, before production.

---

## 11. City walls

- **Cost:** 2 brick. You build it under one of your cities (or metropolises) that doesn't already have one. You have 3.
- **Effect:** each of your walls adds **2** to your hand limit on a 7 (7 → 9 → 11 → 13).
- If the city is reduced to a settlement by the barbarians, its wall goes back to your supply.

---

## 12. The hand limit on a 7

On a 7, each player with more cards in hand (resources + commodities) than their limit (7 + 2 per wall) discards half, rounded down, of their own choice. This happens **even while the robber is asleep** (**Q3**). Progress cards are never discarded on a 7.

---

## 13. The sleeping robber

- Until the first barbarian attack, the robber stays where it starts:
  - a 7 doesn't move it and nobody steals (discards still happen, §12);
  - knights can't chase it;
  - Bishop can't be played.
- From the first attack on, it works as usual. It still blocks its hex's production while asleep, as it sits on the desert (or nowhere, if the map has no robber).
- **With Seafarers:** the pirate sleeps until the first attack too (**Q12**).
- **House rules for 7s before the first attack** (**D3**), each off by default:
  - **"Re-roll 7s until the barbarians have attacked":** a production total of 7 is rolled again (the production dice only; the event die is rolled once, after them), like our "no 7s in the first round" rule. Alchemist can't choose a 7 while this applies.
  - **"No discards until the barbarians have attacked":** a 7 does nothing at all before the first attack.
  - If both are on, the re-roll wins.
- **House rule "Barbarians wait N rounds"** (**D3**): for the first N rounds (each player has had N turns) the event die isn't rolled at all, so the barbarians don't move and nobody draws progress cards. 0 by default.

---

## 14. Progress cards

### 14.1 General rules

- Drawn only through the event die (§6.2) and ties against the barbarians (§10).
- Hidden from other players. Everyone sees how many each player has, and the size of each deck.
- **Playing:**
  - on your turn, after rolling (except Alchemist, before rolling);
  - any number per turn;
  - including a card drawn this turn (**Q8**).
- **A played card goes face down under its deck.** Each deck's size plus the cards in hands, plus the VP cards on the table, is always 18.
- **Victory-point cards (Printer, Constitution)** are revealed when drawn, stay on the table, and are never in a hand.
- **A card can't be played if it would do nothing.** For example: Engineer with no wall left, Bishop while the robber sleeps, or Smith with no knight that can be promoted. Such cards aren't legal actions, which keeps the bot and the simulator honest.

### 14.2 Trade deck (yellow, 18 cards)

| Card | # | Effect as implemented |
|---|---|---|
| Commercial Harbor | 2 | For each opponent in turn, you may offer them one resource from your hand; they must give you a commodity of their choice in return. If they have no commodity, nothing is exchanged. You can skip any opponent. |
| Master Merchant | 2 | Choose an opponent with **more VP than you**. You see their resources and commodities and take any 2. |
| Merchant | 6 | Put the merchant on a land hex next to one of your buildings (taking it from wherever it is). While it's yours: +1 VP, and you trade that hex's resource 2:1 with the bank (nothing extra on desert or gold). |
| Merchant Fleet | 2 | Name one resource or commodity. For the rest of this turn you trade it with the bank at 2:1, as often as you like. |
| Resource Monopoly | 4 | Name a resource. Each opponent gives you 2 of it (or 1, or 0, if that's all they have). |
| Trade Monopoly | 2 | Name a commodity. Each opponent gives you 1 of it if they have one. |

### 14.3 Science deck (green, 18 cards)

| Card | # | Effect as implemented |
|---|---|---|
| Alchemist | 2 | Play **before rolling**. You choose the yellow and red dice (1–6 each). The event die is rolled as usual. |
| Crane | 2 | Your next city improvement this turn costs 1 commodity less. |
| Engineer | 1 | Build a city wall for free. |
| Inventor | 2 | Swap the number tokens of two hexes. Neither may be a 2, 12, 6 or 8. |
| Irrigation | 2 | Take 2 wheat for each fields hex next to at least one of your buildings, whatever the robber's position (**Q16**). Bank shortage: you get what's there. |
| Medicine | 2 | Upgrade a settlement to a city for 2 ore + 1 wheat. |
| Mining | 2 | Take 2 ore for each mountains hex next to at least one of your buildings (same rules as Irrigation). |
| Printer | 1 | 1 VP, revealed when drawn. |
| Road Building | 2 | Build 2 roads for free (with Seafarers: roads or ships in any mix). |
| Smith | 2 | Promote up to 2 different knights by one level each, for free. The usual limits apply (once per turn per knight; mighty needs Fortress; free pieces). |

### 14.4 Politics deck (blue, 18 cards)

| Card | # | Effect as implemented |
|---|---|---|
| Bishop | 2 | Move the robber (as after a 7) and steal 1 random card from **each** player with a building on the new hex. Not while the robber sleeps. |
| Constitution | 1 | 1 VP, revealed when drawn. |
| Deserter | 2 | Choose an opponent with a knight. They remove one of their knights (their choice). Then you may place one of your own knights **of the same strength** from your supply, free, on a vertex where you could build a knight, with the same active state. If you have no knight of that strength free (or it's mighty and you lack Fortress), you place nothing (**Q17**). |
| Diplomat | 2 | Remove an **open road**: a road with one end touching none of its owner's other roads, ships or buildings. Any player's road, including yours. If it was yours, you may at once build it again elsewhere for free. Ships are not affected (they can already be moved). |
| Intrigue | 2 | Displace an opponent's knight standing on a vertex touched by one of your roads, without using a knight of your own. Its owner relocates it as in §9.3. |
| Saboteur | 2 | Each opponent with **as many or more VP** than you discards half their cards in hand (rounded down), of their own choice. |
| Spy | 3 | Look at an opponent's progress cards and take one. |
| Warlord | 2 | Activate all your knights for free. |
| Wedding | 2 | Each opponent with **more VP** than you gives you 2 cards in hand of their choice (fewer if they have fewer). |

---

## 15. Trading

- **Commodities trade like resources.** Players can trade them freely with each other. With the bank they go at 4:1, or 3:1 at a 3:1 harbor. 2:1 harbors are only for their resource.
- **Anything you get from the bank** can be a resource or a commodity, as long as the bank has it.
- **Better rates,** where several apply you get the best one for each trade:
  - Trading House: commodities 2:1;
  - Merchant: that hex's resource 2:1;
  - Merchant Fleet: the named card 2:1 this turn;
  - the 3:1 bank house rule: 3:1 for everything, commodities included.

---

## 16. Victory points

| Source | VP | Public? |
|---|---|---|
| Settlement / city / metropolis | 1 / 2 / 4 | yes |
| Longest road (or trade route) | 2 | yes |
| Defender of Catan card | 1 each | yes |
| Printer, Constitution | 1 each | yes (revealed when drawn) |
| Merchant | 1 | yes |
| Seafarers scenario special VP (e.g. new islands) | as the scenario says | yes |

There are no hidden VP in C&K. A player's visible score is their real score.

---

## 17. Cities & Knights with Seafarers

On Heading for New Shores with both modules:

- **Ships** work as in Seafarers. Road Building can place ships.
- **Gold:** settlement 1 choice, city 2 choices, resources only (**Q13**).
- **Knights** are placed only on land vertices. They are built connected to roads or ships, but move only along roads (**Q11**).
- **Barbarians** count every city on every island.
- **The pirate** sleeps until the first attack like the robber, and is then moved by 7s only. Knights don't chase it (**Q12**).
- **Fog** isn't used on Heading for New Shores, so nothing changes there.
- **Points to win:** 17 by default (14 + 3) (**Q4**).
- **Island bonus:** unchanged. A starting **city** on an island makes it a home island, like a starting settlement.

---

## 18. Hidden information

| Item | Who sees it |
|---|---|
| Your resources and commodities | you; others see your total card count |
| Your progress cards | you; others see how many of each colour you hold (**D18**) |
| Progress decks | everyone sees each deck's size; the order is server-only (in `state`, never in a view) |
| A drawn progress card | the drawer; others see "drew a trade card" |
| Card stolen by the robber, Bishop, Master Merchant | the two players involved; others see that a card moved |
| Cards given for Wedding, Saboteur discards, Commercial Harbor | everyone sees counts. Discards are public as in the base game (you asked for discards in the log), so Saboteur discards are public; Wedding gifts are shown only to the two players |
| Spy | the spy sees the target's progress cards while choosing; everyone sees which deck colour the taken card came from (**Q18**) |
| Master Merchant | the player sees the target's hand while choosing |
| Everything else (knights, levels, walls, barbarians, dice, metropolises, merchant, VP cards) | public |

`viewFor` and `eventFor` get these rules, and the leak checks in the simulator perturb each hidden item (decks, other hands of progress cards, commodities) and confirm no view changes.

---

## 19. Room options

- **A "Cities & Knights" toggle in the lobby,** next to the scenario buttons. It combines with Classic or Heading for New Shores.
- **Default points to win:** 13 with Classic, 17 with Heading for New Shores. Adjustable (5–30) as now.
- **3 or 4 players** (**Q4**).
- **House rules:** the existing three still apply (the 3:1 rule extends to commodities), plus, shown only with C&K: **re-roll 7s** or **no discards** until the barbarians have attacked, and **barbarians wait N rounds** (§13).
- **Stored in the room's options** like the others. A game's config records the modules it was started with, so it replays the same forever.

---

## 20. New invariants the simulator will check after every move

Each new check gets a planted bug to make sure it fails, as before.

1. **Commodity conservation:** commodities are unlimited, so the bank keeps a running count: for each commodity, bank + all hands = a fixed total, and nobody's count is negative.
2. **Resource conservation** as before (19 each), now with the C&K production rules.
3. **Progress card conservation:** for each colour, deck + hands + VP cards on the table = 18, and the exact multiset of card types in that colour never changes (no card copied, lost or swapped between decks).
4. **Deck counts** in every view equal the real deck sizes.
5. **Progress hand limit:** nobody holds more than 4 progress cards, except while their overflow choice is pending (then exactly 5).
6. **Barbarian track:**
   - the ship is always on steps 0–6 between moves;
   - it moves only on a ship roll (+1) or after an attack (back to 0);
   - the attack count goes up by exactly 1 each time it resets;
   - "robber asleep" holds exactly when the attack count is 0.
7. **Knight limits:**
   - per player, at most 2 knights of each strength on the board;
   - mighty knights only with politics ≥ 3;
   - every knight on a land vertex with no other piece;
   - every knight connected to its owner's network when placed or moved (checked in the transition);
   - right after an attack, no knight is active.
8. **Knight actions:** a knight that acted this turn is inactive; no knight acts twice in a turn; none acts in the turn it was activated; none is promoted twice in a turn.
9. **Improvements:** levels 0–5, never decreasing.
10. **Metropolises:**
    - at most one per track, on a city of the holder;
    - at most one per city;
    - the holder's level is ≥ 4 and no other player has a higher level in that track;
    - if anyone has level ≥ 4, the metropolis is held by someone.
11. **City walls:** at most 3 per player, each under one of that player's cities, at most one per city.
12. **Defender of Catan:** cards given out + cards left = 6.
13. **Robber:** doesn't move while asleep (the same holds for the pirate with Seafarers).
14. **Merchant:** if placed, on a land hex; its holder gets exactly 1 VP for it.
15. **VP:** each player's total equals the sum of §16. Nobody is above the target unless the game is over (from the base checks).
16. **No development cards** exist in a C&K game, and nobody has the Largest Army.

Plus, as for Seafarers:

- every legal action is accepted;
- random illegal actions are rejected;
- views and events leak nothing;
- every game replays identically from its seed.

---

## 21. How this fits the engine (design notes)

- **New module `citiesKnights`** in `src/modules/citiesKnights.ts`, with its state under `state.ck`:
  - commodity hands and bank;
  - improvement levels;
  - metropolis holders and cities;
  - knights by vertex;
  - walls;
  - barbarian position and attack count;
  - decks, progress hands and VP cards;
  - Defender cards;
  - merchant;
  - pending choices.
- **New base hooks** (each a no-op without the module, so base and Seafarers replay unchanged):
  - **dice:** extra dice (event die) and what happens before production;
  - **production per building**, so a city can give a resource plus a commodity;
  - **setup:** the second piece is a city;
  - **hand limit;**
  - **robber active**, plus whether a 7 moves the robber;
  - **vertex blocked by a non-building piece** (knights), used by building and route length;
  - **development cards disabled.**
- **Roll events** gain the event die result, barbarian moves and attacks, and progress draws (redacted per seat). Each card has its own event, so the client can animate it: cards fly, the ship moves, knights light up.
- **Pending choices** use one shared "owed choices" mechanism like Seafarers gold, rather than a stage per card:
  - gold, Aqueduct and progress overflow;
  - the barbarians: which city to lose, and the deck to draw from on a tie;
  - knight relocation;
  - Deserter, Wedding, Saboteur and Commercial Harbor answers;
  - metropolis placement.

  Several players can owe choices at the same time, and the turn continues when none are left.
- **The bot** learns every new action from its own view. It stays weak (random-ish but sensible weights) and never targets a human player (when it's a real CPU seat).
- **Client:**
  - the event die next to the dice;
  - a barbarian track;
  - a three-track improvement chart per player;
  - knights on the board (strength and active state visible);
  - walls and metropolises on cities;
  - the merchant;
  - a progress-card hand with sheets for each card's choices;
  - commodities in the hand bar.

---

## 22. Build steps and what "shown working" means

Each step ends with:

- `npm run check` green;
- a simulator run of the module at that stage (1,000 C&K + 1,000 C&K + Seafarers games);
- screenshots of the new UI;
- a short report to you.

I wait for your OK before the next step.

1. **Commodities and improvements:**
   - setup with a city;
   - commodities;
   - 4:1 and harbor trades of commodities;
   - improvement tracks and costs;
   - level-3 abilities (Trading House, Aqueduct; Fortress is shown as unlocked but only used in step 2);
   - metropolises;
   - the event die. The ship advances, but there are no attacks yet; gates draw nothing until step 3.
   - Development cards removed.
2. **Knights and barbarians:**
   - knights: build, promote, activate, move, displace, chase;
   - barbarian attacks with city loss and Defender of Catan;
   - city walls and the hand limit;
   - the sleeping robber (and pirate);
   - the new house rule.
3. **Progress cards and the merchant:**
   - three decks, draws, hand limit;
   - every card in §14;
   - the merchant.

   Then the full end-to-end test, the deploy and the final report.

During steps 1–2 the "Cities & Knights" toggle isn't offered on the live site (**Q19**).

---

## 23. Out of scope for this milestone

- The real CPU player as a seat you can add in the lobby (**Q1**).
- Other C&K variants (e.g. 2-player C&K, Traders & Barbarians).
- Seafarers scenarios other than Heading for New Shores.
- The map editor.

---

## 24. Questions (answered: see Decisions)

Each has a default. Answer "default" to any you're happy with.

1. **Q1 CPU player.** For Seafarers you said "No CPU player yet". This milestone says "the CPU player can play it badly".
   - **Default:** this means the bot we already have (it plays the test games from its own view). I'll teach it every C&K action. It stays weak, and it is not yet a seat you can fill in the lobby.
   - If you want bot seats in rooms now, say so. They'd never target a human (robber, Bishop, Spy, Deserter, Master Merchant, Wedding, Saboteur, Intrigue, Commercial Harbor).
2. **Q2 Commodity supply.**
   - **Default:** 12 of each, with the base shortage rule.
   - Alternative: unlimited.
3. **Q3 7s while the robber sleeps.**
   - **Default:** players over the limit still discard. The robber doesn't move and nobody steals.
   - Alternative: a 7 does nothing at all before the first attack.
4. **Q4 Players and points.**
   - **Default:** 3 or 4 players (like Seafarers). 13 VP on Classic; 17 VP on Heading for New Shores with C&K.
5. **Q5 When can you buy improvements?**
   - **Default:**
     - you need at least one city to buy any level;
     - you can't buy a level-4 or level-5 that would give you a metropolis if all your cities already have one.
   - Alternative: improvements can be bought with no city at all (some editions allow this), and a metropolis you can't place is simply not taken.
6. **Q6 Opponents' knights block roads.**
   - **Default:** an opponent's knight on a vertex blocks building past it and splits longest road, exactly like a settlement.
   - Alternative: knights don't affect roads.
7. **Q7 Using a knight the turn it's activated.**
   - **Default:** not allowed. It can act from your next turn on. (A knight that was already active when your turn began can act once this turn.)
   - Alternative: an activated knight can act at once.
8. **Q8 Playing progress cards.**
   - **Default:** any number per turn, including cards drawn this turn, only after rolling (Alchemist only before).
   - Alternative: one per turn.
9. **Q9 Progress hand overflow.**
   - **Default:** at 5 cards you put one under its deck at once. On your own turn you may play one of them instead, if it's playable then.
10. **Q10 Aqueduct.**
    - **Default:** only if a non-7 roll gives you nothing at all (resources or commodities).
    - Alternative: Catan Universe's exact behaviour, if you know it differs.
11. **Q11 Knights and ships (C&K + Seafarers).**
    - **Default:** knights can be built at a land vertex connected to your roads or ships, but move only along roads.
    - Alternative: roads only for both.
12. **Q12 The pirate in C&K + Seafarers.**
    - **Default:** the pirate sleeps until the first attack like the robber, and knights can't chase it.
    - Alternatives: the pirate is always active; knights next to the pirate's sea hex can chase it.
13. **Q13 Gold for cities.**
    - **Default:** a city on gold gets 2 resources of choice, never commodities.
    - Alternative: 1 resource + 1 commodity of choice.
14. **Q14 Losing a city with no settlement piece left.**
    - **Default:** it still becomes a settlement (you may have 6 settlements for a while).
    - Alternative: the city is lost entirely.
15. **Q15 Defender cards run out.**
    - **Default:** the sole winner draws a progress card of their choice instead.
16. **Q16 Irrigation and Mining with the robber.**
    - **Default:** the robber doesn't stop them.
17. **Q17 Deserter.**
    - **Default:** you replace the removed knight only with one of the same strength, and its active state is copied.
    - Alternative: you may place a weaker knight if you have no equal one.
18. **Q18 Spy.**
    - **Default:** others see only the colour of the card you took.
    - Alternative: the card is announced to everyone.
19. **Q19 Deploying between steps.**
    - **Default:** steps 1 and 2 are deployed with the C&K toggle hidden, so the live site always only offers finished rules. You see each step through the report and screenshots.
    - Alternative: show the toggle as "Cities & Knights (in progress)" so you can play the partial version.
20. **Q20 Anything Catan Universe does that bugs you in C&K** (for example, how it asks you to pick a city to lose, or Spy/Commercial Harbor flows)? I'll turn each into a requirement.

---

## Decisions

Your answers to the questions in the first draft:

1. **D1 CPU player:** ignore for now; you'll describe it later. The existing test bot learns C&K so the simulator and end-to-end test can play it, nothing more.
2. **D2 Commodities:** no supply limit. Anyone can hold any number (resources keep their 19-card limit).
3. **D3 7s before the first attack:** by default players over the limit discard and the robber stays put. Two house rules: re-roll 7s, or no discards, until the barbarians have attacked. A third: the barbarians (event die) wait N rounds before starting.
4. **D4 Players and points:** 3 or 4 players; 13 VP on Classic, 17 on Heading for New Shores.
5. **D5 Improvements:** you need a city to buy any level; you can't buy a level that would win a metropolis you have no city for.
6. **D6 Knights block roads:** yes, like settlements.
7. **D7 Knights can't act the turn they're activated.**
8. **D8 Progress cards:** any number per turn, including ones drawn this turn, after rolling (Alchemist before). A 5th card drawn on your own turn can just be played; you don't have to throw one away first.
9. **D9 Overflow:** on someone else's turn a 5th card means putting one under its deck at once; on your own turn you get back to 4 before ending it.
10. **D10 Aqueduct:** only when a non-7 roll gives you nothing at all.
11. **D11 Knights with ships:** built next to roads or ships; move along roads only.
12. **D12 Pirate:** sleeps until the first attack; knights don't chase it.
13. **D13 Gold:** a city gets 2 resources of choice, no commodities.
14. **D14 City lost with no settlement piece left:** it still becomes a settlement.
15. **D15 Defender cards run out:** the sole winner draws a progress card of their choice.
16. **D16 Irrigation and Mining** ignore the robber.
17. **D17 Deserter:** same strength only; active state copied.
18. **D18 Spy and colours:** everyone always sees how many progress cards of each colour every player holds, and the colour of a card taken with Spy.
19. **D19 Steps:** build it all; no partial deploys.
20. **D20 Catan Universe gripes:** later, after playtesting.
