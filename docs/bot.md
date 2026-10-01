# The CPU player: rules as we will implement them

**Status: draft. Waiting for your OK on these rules and the questions at the end (§12). No code until then.**

This document is the contract for the CPU player. Its code, the simulator and the tests will follow it exactly. If something here is wrong, it should be fixed here first.

The CPU player is a seat you can add to any room. It plays legally but badly, and it is never mean to humans. In this document:

- **human** means a seat a person sits in;
- **CPU** means any CPU seat (this one or another);
- **its own** means the CPU deciding the move.

---

## 1. How it fits in

- **It plays from its own view only.**
  - Its decisions come from a pure function in the engine: `cpuMove(view, rng)`.
  - It sees exactly what a person in that seat would see (`viewFor`), so it can't cheat.
  - Its randomness comes from a seeded generator, so its choices can be replayed in tests.
- **Its moves go through the normal path.** The server applies them with `applyAction`, saves them to SQLite before broadcasting, and sends them to everyone like any other move. A CPU move can be illegal only through a bug, and the server rejects it like any other.
- **The server drives it:**
  - Whenever the game changes and a CPU seat has something to do (its turn, a discard, a choice it owes, an offer to answer), the server waits a random **1 to 2 seconds**, then makes its move.
  - Only one move is pending per CPU at a time.
  - After a server restart, pending CPU moves are picked up again.
- **The engine marks CPU seats** with a public flag (`cpu: true`) on the player. Humans can see who the CPUs are, and the one rule exception in §5 can apply to them. Games without CPUs are unchanged, so saved games replay as before.

---

## 2. In the lobby

- **Adding a CPU:** any seated player can click **Add CPU player** while there is a free seat.
  - It gets a name from a list (Bramble, Cobble, Pip, Turnip, Mossy, Biscuit) and the colour **gray**.
  - If gray is taken, it gets the first free colour.
- **Gray becomes a colour anyone can pick**, CPU or human.
- **Anyone in the lobby can change a CPU's colour** (to any free colour) **or remove the CPU.**
- **CPUs count toward the player count** (2–4, or 3–4 for Seafarers and C&K).
- **At least one human must be seated** to start a game.
- **CPUs are always "connected".** Nobody can take over a CPU's seat.
- **"New game, same players"** keeps the CPUs.
- **CPUs can't be added after the game has started.**

---

## 3. Trading

- **It never offers a trade to a player.**
- **It declines every offer it is asked to answer**, about 1–2 seconds after the offer appears.
- **It trades with the bank only to protect its hand, and only when it is about to end its turn:**
  - While it holds more cards than its hand limit, and the cards it holds allow a bank trade, it trades with the bank, then ends its turn.
  - The hand limit is 7, or 7 + 2 per city wall in Cities & Knights. Cards in hand include commodities.
  - **Each trade:**
    - **Gives** the card it holds most of, among those it holds enough of to trade at its best rate (harbors, merchant, trading house and house rules all count). Ties go to the cheapest rate, then to card order.
    - **Gets** the resource it holds fewest of that the bank has (commodities don't run out, but it asks for resources).
  - If no bank trade is possible, it ends its turn anyway (over the limit).
- **It never uses the bank for any other reason** (not to build).

---

## 4. Building (rarely)

- **Setup:** it places its starting pieces on a **random** legal corner and edge. It never looks for the best spot. With Seafarers it may start on any legal island; with C&K its second piece is a city, as for everyone.
- **During its turn:** at most **one** build per turn, and only with a **1 in 4** chance when it can afford something.
  - What it builds, in order of preference: city, then settlement, then road (or ship, if there's no road to build).
  - A road or ship is built only if it leads toward a spot where a settlement could go. Otherwise it's a random legal edge.
- **Development cards (base and Seafarers):** it buys one with the same 1 in 4 chance, if it has the cards and didn't build that turn. Cards it plays are listed in §6.
- **Seafarers:**
  - It moves a ship only to reach a building spot, with the same 1 in 4 chance.
  - Gold: it picks the resources it holds fewest of.
- **Cities & Knights:**
  - **Knights.** These are its priority (see §6), not "rare".
  - **Improvements.** With the same 1 in 4 chance per turn, it buys one level in the track whose commodity it holds most of.
  - **City walls.** Built only when it holds at least 4 brick, with the same chance.

---

## 5. The robber and the pirate

Whenever it must move the robber (after a 7, or a Knight card), it picks a hex in the first tier that has one:

1. **An empty hex:**
   - a land hex with no settlements or cities on it (the desert counts);
   - not the hex the robber is on now, and one the robber may legally go to.

   If several are empty, it picks one at random.
2. **A hex touching only its own buildings** (no one else's). If several, it picks one at random.
3. **One of its own hexes** (one it has a building on) touching **the fewest human buildings**. Ties go to the hex touching the fewest humans' buildings in total, then at random.

**Stealing:**

- **It never steals from a human.**
- On an empty or own-only hex there is nobody to steal from, so nothing happens.
- On a tier-3 hex:
  - if another CPU is next to it with cards, it steals from that CPU;
  - otherwise **it doesn't steal at all**.
- **Rule exception:** base rules say the robber's mover must steal if they can. The engine will allow a **CPU** seat to decline (`noSteal`). Humans keep the normal rule. (**Q1**)

**The pirate (Seafarers):**

- When a 7 lets it move the robber **or** the pirate, it judges both by the same tiers, using **ships** next to sea hexes for the pirate.
- It takes the move in the best tier, preferring the robber on a tie.
- Pirate stealing follows the same rules: never from a human, from another CPU if one is there, otherwise no steal.

**Cities & Knights:**

- While the robber sleeps, there's nothing to do.
- **It never chases the robber with a knight, and never plays Bishop** (§6).

---

## 6. Cards and knights

### 6.1 Development cards (base and Seafarers)

| Card | What it does with it |
|---|---|
| Knight | Plays it at the start of its turn (before rolling) with a 1 in 2 chance. The robber goes where §5 says; it never steals from a human. |
| Road Building | Plays it when it has somewhere to build. |
| Year of Plenty | Plays it at once. It takes the two resources it holds fewest of. |
| Monopoly | **Never plays it** (it takes from humans). |
| Victory Point | Counted automatically, as for everyone. |

### 6.2 Progress cards (Cities & Knights)

It plays a card only if it can't hurt or take from a human.

| It plays (when it can) | It never plays |
|---|---|
| Crane (then buys an improvement if it can) | Alchemist (it could choose a 7, which hurts people) |
| Engineer | Inventor (moving numbers changes humans' income) |
| Irrigation | Bishop, Deserter, Diplomat, Intrigue, Saboteur, Spy, Wedding |
| Mining | Commercial Harbor (it's trading with players) |
| Medicine | Master Merchant, Resource Monopoly, Trade Monopoly |
| Road Building | Merchant, if a human holds the merchant now (taking it costs them a point) |
| Smith | |
| Warlord | |
| Merchant (when no human holds it) | |
| Merchant Fleet (on the card it holds most of) | |

Printer and Constitution are shown automatically, as for everyone.

**More than 4 progress cards on its turn:** it puts back a card it never plays (if it has one), otherwise a random one. Off-turn it does the same when it has 5.

### 6.3 Knights (Cities & Knights)

- **Each turn it builds a knight** (1 sheep, 1 ore) when it can afford one and has a spot. This doesn't use the "rarely" chance.
- **It activates every inactive knight it can pay wheat for.** It does this before anything else on its turn, so its knights help when the barbarians attack.
- **It promotes a knight** with the 1 in 4 chance, only to strong (it never builds a fortress on purpose).
- **It never moves a knight onto another player's knight** (no displacing anyone).
- **It never chases the robber.**
- **Moving knights:** it doesn't move them at all; they stay where it built them.

---

## 7. Choices it owes

| Choice | Its answer |
|---|---|
| Discard on a 7, Saboteur | The cards it holds most of, one at a time |
| Wedding (giving 2 cards) | Same: the cards it holds most of |
| Commercial Harbor (a human gives it a resource) | The commodity it holds most of |
| Lose a city to the barbarians | A random city that isn't a metropolis |
| Draw a progress card (tie against the barbarians) | A random deck with cards left |
| Too many progress cards | As in §6.2 |
| Aqueduct | The resource it holds fewest of |
| Displaced knight, Intrigue | A random legal corner |
| Deserter (remove one of its knights) | Its weakest knight |
| Metropolis city | A random eligible city |

---

## 8. Chat

- It posts a goofy line in the table chat now and then:
  - about **1 turn in 6**, after it rolls;
  - always when it wins;
  - sometimes when the barbarians attack, and when a 7 makes it discard.
- Lines are picked at random from a short list. Examples:
  - "I'm saving up for a sheep. Just one. A nice one."
  - "Is this the desert? It feels like the desert."
  - "Rolling with confidence and zero strategy."
  - "I put the robber somewhere nobody lives. You're welcome."
  - "My knights are mostly decorative."
  - "Barbarians! I'll hide behind Ann." (it uses a real player's nick)
  - "I've counted my cards. Twice. Still 3."
  - "Beep boop, I meant to do that."
  - "Ships are just roads that got wet."
  - "That 7 hurt my feelings and my wheat."
- Chat lines are server messages from the CPU's name. They aren't game moves and don't change the game.

---

## 9. Hidden information

- The CPU sees only its own view, so it can't use other players' hands or the decks. The tests check that its moves don't depend on hidden information (§11).
- The server never sends anyone anything new: CPU moves produce the same redacted events as human moves.

---

## 10. Weakness

It should lose most games. That comes from:

- building only 1 turn in 4 when it can;
- never trading with players;
- bank trades only at the end of its turn;
- random starting spots;
- never using Monopoly or the nasty progress cards.

We measure it in §11. If it wins too often, we lower its build chance.

---

## 11. Done means (tests)

1. **1,000 simulated games** with CPU seats, across every scenario and expansion:
   - classic, Heading for New Shores, C&K, C&K + Seafarers, with house rules mixed in;
   - 1 to 3 CPUs per game; the other seats are the existing test bot.

   Every CPU move must be accepted by the engine (no illegal moves, no stuck games), and all the usual invariants hold.
2. **Explicit checks on every CPU move in those games:**
   - **No player trading:** it never sends `offer` or `confirm`, and every `respond` it sends is a decline.
   - **Robber and pirate:**
     - when an empty hex existed, it chose one;
     - otherwise, when an own-only hex existed, it chose one;
     - otherwise, its own hex had the fewest human buildings available.
   - **No stealing from humans:** no `steal` event from a CPU move ever takes from a human seat.
   - **No cards against humans:**
     - it never plays Monopoly or any card in the "never" column of §6.2;
     - it never displaces a human's knight;
     - it never chases the robber.
   - **Hand limit:** at the end of each of its turns, it is over its hand limit only if no bank trade was possible.
   - **No hidden information:** for sampled CPU decisions, changing what it can't see (other hands, decks) doesn't change its move.
3. **It loses most games:**
   - In 3-player games of 1 CPU against 2 test bots, the CPU wins **under 20%** of games (a fair share would be 33%).
   - In 2-player games against one test bot, it wins **under 30%**.
4. **Server tests:**
   - adding, recolouring and removing a CPU in the lobby;
   - a full game with CPUs through the server, using a fast fake clock;
   - a restart in the middle of a CPU's turn.
5. **End to end:** a 3-browser test where two people and a CPU play a full game, the CPU moving on its own on the real server.
6. **`npm run check`** green, then deploy.

---

## 12. Questions

Answer "default" to any you're happy with.

1. **Q1 Declining to steal.** Base rules make the robber's mover steal when they can. To keep "never steals from a human" true even when the robber has to land near humans, the engine will let **CPU seats only** decline to steal.
   - **Default:** yes, that exception.
   - Alternative: let everyone decline to steal (a house rule).
2. **Q2 Stealing from other CPUs.** Default: allowed (it's only unkind to bots). Alternative: CPUs never steal at all.
3. **Q3 How bad.** Default: 1 in 4 chance to build when it can, one build per turn, random starting spots. Say if you want it weaker or stronger to start with.
4. **Q4 Bank trades only at end of turn.** You said bank trades are only to protect its hand, so it never trades to build. Default: as written. Alternative: it may also trade 4:1 toward a city.
5. **Q5 CPU-only rooms.** Default: at least one human must be seated to start (no bot-only games running on the server).
6. **Q6 Names and chat.** Default: the names and lines above, about 1 turn in 6. Send your own if you like.
