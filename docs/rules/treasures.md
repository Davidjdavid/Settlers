# Treasures: rules as we will implement them

**Status: draft, waiting for your answers (D1–D8 at the end). Nothing is built until they're agreed.**

This is the contract for treasures (SPEC 10.3, Milestone 10). The engine, the simulator's invariants and the tests will follow it exactly. If something here is wrong, it should be fixed here first. Everything in the base game, Seafarers and Cities & Knights still applies unless this document changes it.

---

## 1. Treasure spots

1. A map may have **treasure spots**, placed in the map maker. Each spot is on a **path**: an edge where a road or ship can go (a land, coast or sea edge, docs/rules/seafarers.md §2).
2. A spot is **face down**: everyone sees where the spots are, nobody knows what's there.
3. Treasures work **in every mode** where the map has spots: base, Seafarers, Knights, Full game. Spots are part of the map, so a saved game keeps them (CLAUDE.md: a game's config stores its map).
4. **Checks on the map:** a spot must be on a real edge of the map, not on an edge between two fog hexes or off the board; at most one spot per edge. The editor warns about spots nobody can reach (never blocks saving).

## 2. The treasure deck

1. At the start of the game the engine makes a **treasure deck** with **one card per spot** on the map, shuffled from the game's random numbers. Its order is secret (server-only, like the development deck).
2. **The four kinds** are dealt as evenly as possible, in this order before shuffling: free roads and ships, 2 resources of your choice, sheep + brick + wheat, a free development card, then round again. So 4 spots give one of each; 6 spots give two of the first two kinds and one of the others. **(D1)**
3. Because there is one card per spot, **the treasure deck never runs out**.
4. Everyone can see how many spots are left; nobody can see which kinds are left.

## 3. Finding a treasure

1. The first player to **build a road or a ship on a spot, or move a ship onto it**, finds it. Free pieces count (Road Building, the Diplomat's rebuilt road, a treasure's own free pieces).
2. **Setup:** a road or ship placed during setup can't go on a treasure spot. **(D2)**
3. The finder draws the **top card** of the treasure deck. **Everyone sees what it is** (the log says "Ann found a treasure: 2 resources of her choice").
4. The treasure happens **straight away, for the finder only**, before anything else in the turn (§4). The spot is then empty for good.
5. A piece that finds a treasure stays where it is, as usual.

## 4. The treasures

### 4.1 Free roads and ships

1. The finder places **2 free pieces straight away**, in any mix: 2 roads, 2 ships, or 1 of each (ships only in Seafarers maps). It works exactly like a Road Building card played at once:
   - the normal building rules apply (a road joins your roads or buildings, a ship your ships or a coastal building, not next to the pirate);
   - only pieces you still have in supply;
   - **if there's no legal spot, the rest is lost.** It's also lost when you have no pieces left.
2. **Found while placing free pieces** (from Road Building or from another treasure): the new 2 are added to the ones still to place. **(D3)**
3. A free piece can find another treasure; that one happens straight away too.
4. You can't do anything else until the free pieces are placed (or lost), the same as Road Building today.

### 4.2 Two resources of your choice

1. The finder picks **any 2 resources** (wood, brick, sheep, wheat, ore; never commodities), the same two or different, from the bank, as with Year of Plenty.
2. **The bank running short:** you can only pick what the bank holds. If the bank holds 1 resource card in all, you get that one; if none, nothing. **(D4)**
3. Like gold, the choice is made straight away, in a sheet that can't be closed without choosing.

### 4.3 Sheep, brick and wheat

1. The finder takes **1 sheep, 1 brick and 1 wheat** from the bank.
2. **The bank running short:** you get each of the three the bank still has; any it's out of is lost. **(D4)**

### 4.4 A free development card

1. **Base and Seafarers:** the top card of the development deck, free. It's a new card: you can't play it this turn (a victory point card counts at once, as when bought).
2. **Knights and Full game:** a **progress card** from the deck you pick (science, trade or politics), with the usual rules: a victory-point progress card is shown at once; the 4-card limit applies as when you draw one (at the end of your turn you keep 4).
3. **A deck running out:**
   - Base and Seafarers: if the development deck is empty, the treasure gives nothing. **(D5)**
   - Knights: you can only pick a deck with cards in it; if all three are empty, nothing.

## 5. Things that don't change

- Treasures give **no victory points** of their own.
- The robber, the pirate, the merchant and knights never find treasures.
- Finding a treasure doesn't count as playing a card: you can still play a development card that turn.
- Treasures don't count as production (no Aqueduct, no "no 7s" effects).

## 6. Hidden information

- The deck's order is server-only. Every player sees the spots left and the deck's size.
- What a treasure turns out to be is public as soon as it's found, as is everything it gives, **except the development card**: like a bought card, only the finder sees which one (others see "a development card"). A progress card shows its deck, as when drawn. **(D6)**

## 7. Stats and the log

- Every card a treasure gives is explained by its event, so the stats count it ("from treasures" as a new source of cards). **(D7)**
- Log: "Ann found a treasure: 1 sheep, 1 brick and 1 wheat", "Ann found a treasure: 2 free roads or ships", and so on.

## 8. New invariants the simulator will check

1. The treasure deck plus the treasures found always make the whole deck (one card per spot).
2. No treasure is found twice; a found spot never comes back.
3. Every card a treasure gives comes from the bank or a deck, so the bank-plus-hands totals still hold (SPEC 8.1), and the development and progress decks plus hands still hold.

## 9. Tests

- Rules tests for every treasure: found by building a road, building a ship, and moving a ship; free pieces at the piece limit and with no legal spot; found while placing free pieces; the bank short and empty for each resource treasure; the development deck empty; a Knights game with one and with all progress decks empty.
- 1,000 simulated games each in Seafarers and Full game mode on a test map with treasures (SPEC 10.5).

---

## Decisions (your answers go here)

1. **D1 The deck:** one card per spot, the four kinds dealt round in turn, so the kinds are as even as the number of spots allows. *(Alternative: a fixed deck, e.g. 3 of each, reshuffled when it runs out.)*
2. **D2 Setup:** setup roads and ships can't go on a treasure spot. *(Alternative: they can, and the treasure happens at the end of that setup turn.)*
3. **D3 Free pieces while placing free pieces:** the new 2 are added to the ones still to place.
4. **D4 Resources when the bank is short:** you get what the bank has; the rest is lost (as Year of Plenty and production do today).
5. **D5 An empty development deck:** the treasure gives nothing. *(Alternative: 2 resources of your choice instead.)*
6. **D6 Which development card:** only the finder sees it, like a bought card.
7. **D7 Stats:** treasures count as a new source of cards in the stats.
8. **D8 Where treasures work:** every mode, on any map with spots (§1.3).
