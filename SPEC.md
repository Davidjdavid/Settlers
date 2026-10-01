# Settlers — Spec

A private web Catan-style game for three friends, replacing Catan Universe. **Reliability comes first.** No lost games, no desyncs, no rule bugs.

Status: **Milestones 1–3 (base game, Seafarers, Cities & Knights) and the CPU player done. Milestone 4 (table polish) agreed and being built.**

## Milestone 1: base game

### Access, rooms and seats
- The whole site sits behind one shared **site passphrase**. You enter it once and it's remembered in a cookie.
- **Create a room** to get a short code (4 letters, no look-alike characters, e.g. `KTQM`) and a shareable link.
- **Join with a nickname**, then pick a colour. No accounts.
- 2–4 players. Any seated player can start the game once at least 2 are seated.
- **Rejoin:** your browser keeps a secret seat token. A refresh, a dropped connection or a server restart puts you back in your seat, in the middle of your turn if it was your turn. No turn timers. The game waits for a disconnected player.
- Each seat shows whether that player is connected.
- **Lost seat token** (cleared browser, new device): open the room link. You'll be watching, with a button for each disconnected seat. Taking one needs two confirmations, everyone gets a warning saying whose seat was taken, and the old device's token stops working. A seat whose player is still connected can't be taken.
- **Starting a new game in the same room:** any one player can do it, but they have to confirm twice, and everyone gets a warning first. The old game stays saved in the history.

### Saving
- Every accepted move is saved before anyone sees its result.
- A server restart loses nothing. Games carry on where they left off.
- Each game keeps its full move history, so any game can be replayed exactly. That's for debugging, and later for a "replay this game" view.
- Nightly backup of the database (a local copy on the server to start; S3 later if wanted).

### Rules (matching the prototype)
- **Board:** 19 hexes, randomised each game.
  - Terrain: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert.
  - Number tokens 2–12 (no 7) with no adjacent 6/8 pairs and no adjacent equal numbers.
  - 9 ports: 4 generic 3:1 and one 2:1 port per resource.
  - The robber starts on the desert.
- **Bank:** 19 of each resource. **Pieces** per player: 15 roads, 5 settlements, 4 cities.
- **Turn order:** seats are shuffled at the start of the game.
- **Setup:** snake draft (1→N, then N→1). Each placement is a settlement plus an adjacent road. The second settlement pays out one of each adjacent resource.
- **Distance rule:** no settlement on a corner next to any other building.
- **Roll:** produce resources for every hex with that number, except the robber's hex. A settlement collects 1, a city 2.
  - **Bank shortage:** if the bank can't pay everyone a resource, nobody gets it. If only one player is owed it, they get whatever is left.
- **Seven:** everyone holding more than 7 cards discards half (rounded down), all at the same time. Then the roller moves the robber to a different hex and steals 1 random card from an adjacent player who has cards.
- **Building:**
  - Road (wood, brick): must connect to your road or building, and can't connect through an opponent's building.
  - Settlement (wood, brick, sheep, wheat): must touch your road and obey the distance rule.
  - City (2 wheat, 3 ore): upgrades your settlement, and the settlement piece goes back to your supply.
- **Development cards** (sheep, wheat, ore). The deck has 14 knight, 5 victory point, 2 road building, 2 year of plenty, 2 monopoly.
  - Play at most one per turn, before or after rolling.
  - A card bought this turn can't be played until your next turn.
  - Victory point cards count straight away and stay hidden until the game ends.
  - Knight: move the robber and steal. Road building: 2 free roads. Year of plenty: take any 2 from the bank. Monopoly: every player gives you all their cards of one resource.
- **Trading:**
  - With the bank at 4:1, 3:1 at a generic port, 2:1 at a matching port.
  - With players, only after the roll and only involving the player whose turn it is. The current player posts an offer, others accept or decline, and the current player confirms with one of those who accepted.
  - Other players may post offers to the current player.
  - You can't give and ask for the same resource.
  - Change from the prototype: offers can only be accepted or confirmed in the main phase, not while a knight's robber move or free roads are pending.
- **Longest road:** 5 or more segments, broken by opponent buildings. The current holder keeps it on a tie. If the holder loses it and the new longest is tied, nobody holds it. Worth 2 VP.
- **Largest army:** 3 or more knights played, and you must beat the current holder outright. Worth 2 VP.
- **Winning:** 10 VP, checked only for the player whose turn it is. That includes the start of a turn, so a player who reaches 10 on someone else's turn wins when their own turn begins.

### Hidden information
- You see your own resource cards and development cards.
- For other players you see card counts only: resources in hand, unplayed dev cards, played knights.
- Victory point cards are hidden until the game ends.
- Development deck: you see how many cards are left, not which.
- **Stolen cards:** only the thief and the victim see which resource was taken. Everyone else sees "took 1 card".
- **Bought dev cards:** only the buyer sees the type.
- The random seed and deck order never leave the server.
- Discards are public: everyone sees exactly which cards were discarded, and it goes in the log.

### Showing what's happening (no reading required)
The prototype made you read the log to follow the game. Milestone 1 adds **simple** animations driven by the engine's events. The point is to show who got what, so nobody has to ask before trading:
- **Dice:** the numbers flicker quickly, then stop on the roll. The hexes with that number are highlighted.
- **Cards:** small resource-card images pop up over the producing hexes, then slide to the receiving player's panel. Discards, trades, bank trades, monopoly and year of plenty use the same effect. Steals show a face-down card to onlookers.
- Nothing elaborate. Animations must never block input or delay the game state, and they're skipped when a client reconnects or catches up.
- A clear **"whose turn / what's happening now"** banner.
- The text log stays as a secondary history panel.
- Table chat.

### Deployment
- Runs at **https://betteronlinesettlers.com** (`www.` redirects to it) on one EC2 Ubuntu server: Node behind Caddy, with automatic HTTPS.
- One-command deploy that runs the tests, ships, restarts, checks health, and rolls back on failure.

### Done means
- Engine unit tests, plus a simulator playing 1,000+ random full games and checking these invariants:
  - Resources are conserved (bank plus all hands = 95).
  - Pieces are conserved.
  - Dev cards are conserved.
  - The distance rule holds.
  - The longest road and largest army holders are correct.
  - The win condition holds.
  - No hidden information appears in any other seat's view.
  - The same seed and moves replay to the same state.
- An end-to-end test with 3 browser clients playing a full game against the real server, including one client reconnecting mid-game and a server restart mid-game.
- Deployed over https, and a real game played on the live site.

## Milestone 2: Seafarers

The rules are written down, with your decisions, in **docs/rules/seafarers.md**.

- **Expansions are optional rule modules** that can be combined: base, Seafarers now, and later Cities & Knights, including C&K + Seafarers. Saved classic games replay exactly as before; a golden replay test proves it.
- **Maps and scenarios are data files** (JSON), in the format the map editor will use: sea, gold, fog, harbors, number tokens, starting areas, the win target and special points.
- **Room options**, set by any seated player in the lobby and shown to everyone:
  - **Game:** Classic, or Seafarers: Heading for New Shores (3–4 players).
  - **Points to win:** 5–30, defaulting to the scenario's target.
  - **House rules** (each off by default):
    - no 7s in the first round (a 7 is rolled again);
    - 3:1 bank trades for everyone;
    - move ships as often as you like (Seafarers).
- **Seafarers rules:** ships, moving ships, the pirate, gold fields (pick any resource), fog discovery, longest trade route, and 2 VP for each new island settled. Starting settlements may go on any island; islands you start on are home islands.
- **Done means:** 1,000+ random Seafarers games in the simulator with the new invariants, the base-game tests still passing, a 3-browser Seafarers end-to-end test, and it deployed.

## Milestone 3: Cities & Knights

The rules are written down, with your decisions, in **docs/rules/cities-and-knights.md**.

- **A rule module** that works alone (Classic, 13 points) and with Seafarers (Heading for New Shores, 17 points); 3–4 players. Turned on with a "Cities & Knights" box in the lobby.
- Commodities (unlimited), the three improvement tracks with their level-3 abilities and metropolises, the event die, 54 progress cards in three decks, the barbarians and their attacks, knights, city walls, the merchant, Defender of Catan points, and the robber asleep until the first attack.
- **House rules** (C&K only, each off by default): re-roll 7s, or no discards on a 7, until the barbarians have attacked; barbarians and progress cards wait N rounds.
- **Done means:** 1,000+ random C&K games and 1,000+ C&K + Seafarers games in the simulator with invariants for commodity and card conservation, deck counts, the barbarian track and knight limits; all earlier tests passing; a 3-browser C&K end-to-end test; deployed. The test bot plays it (badly).

## Milestone 4: Table polish

**Status: agreed (your answers are in 4.7). Being implemented.**

These come from years of misclicks in Catan Universe, so they are about feel. If one of them makes the game less reliable, reliability still wins.

### 4.1 Game mode picker

- Creating a room offers **four choices**, as big buttons, instead of the scenario buttons and the Cities & Knights box:

  | Choice | What it is | Players | Points |
  |---|---|---|---|
  | **Base game** | Classic board | 2–4 | 10 |
  | **Seafarers** | Heading for New Shores | 3–4 | 14 |
  | **Knights** | Cities & Knights on the classic board | 3–4 | 13 |
  | **Full game** | Seafarers + Cities & Knights | 3–4 | 17 |

- Each button says in one line what it is and how many players it needs.
- Points to win and house rules stay as now under the picker; only the house rules for the chosen mode are shown.
- Nothing changes for saved games or rooms: the room still stores the same options underneath.

### 4.2 Piece colours

- **8 colours for people**, plus **gray, which only CPU players can have** (it's their default; a CPU can be recoloured to any free colour, but no person can pick gray).
- **Every colour must be easy to tell apart:**
  - from every other colour, including for colorblind players (simulated protanopia, deuteranopia and tritanopia);
  - on every tile colour (forest, hills, pasture, fields, mountains, desert, gold, sea, fog) and on the water around the island.
- **How it's tested:**
  - **On the tiles:** each colour must contrast with each tile (pieces keep their outline).
  - **From each other:** each pair of colours must stay far enough apart (a colour-difference score) with normal vision and under each of the three colorblind simulations.
  - **By eye:** a screenshot of every colour's pieces on every tile type, sent to you.
  - Colours that fail are swapped. No extra colorblind marks on the pieces (**D3**).
- **No two players can have the same colour** (as now, enforced by the server).
- **Picking a colour shows a small preview** of that colour's road, settlement and city, in the lobby and when recolouring a CPU.

### 4.3 Misclick protection

**Placement preview:**

- **With a mouse:** pointing at a legal spot shows a **ghost** of the piece in your colour (half-transparent) on that spot.
  - This covers roads, ships, settlements, cities, knights, walls, the robber, the pirate and the merchant.
- **On phones and tablets** (no hover): **the first tap only shows the ghost**, with **Confirm** and **Cancel** buttons. Nothing is placed until you press Confirm. Tapping another spot moves the ghost there.

**Confirmation settings,** per person, each on by default:

| Setting | When on |
|---|---|
| Confirm before placing a piece (mouse) | Clicking a spot with a mouse shows the ghost with Confirm and Cancel instead of placing at once. |
| Confirm before placing a piece (touch screens) | On phones and tablets, the first tap shows the ghost with Confirm and Cancel. Off: a tap places at once, as with a mouse when the setting above is off (**D2**). |
| Confirm before ending my turn | "End turn" asks "End your turn?" first. |
| Confirm before playing a card | Development and progress cards ask "Play Knight?" (or whichever card) first. |
| Confirm before accepting a trade | Accepting an offer (or confirming a trade you offered) shows the trade and asks first. |

- They live in the menu, under **"My settings"**, as on/off switches.
- **Every switch, here and in the room options, has a "?" with a detailed explanation** of what it does: shown when you hover over it, or tap it on a phone.

### 4.4 Handing the dice back

**Asking:**

- **Who can ask:** after a player ends their turn, they (the previous player) can press **"Wait, give the dice back"**.
- **Who decides:** the player who now has the dice sees the request. They can **hand the dice back** or **say no**.
- **Without being asked:** the new player can also hand the dice back.
- **A "no" is final** for that turn: the previous player can't ask again (**D4**).

**When it's possible:**

- Only until the new player does **anything**: rolling, playing a card, or any other action. After that the dice can't go back, and the button disappears.
- Moves by other players, like answering a request, don't count.

**What handing back restores:**

- The previous player's turn **exactly as it was** when they pressed End turn:
  - the same roll;
  - the same cards;
  - cards bought that turn still not playable;
  - whether they'd already played a card;
  - ships built that turn still unable to move (Seafarers);
  - knights activated that turn still unable to act (Cities & Knights);
  - their trade offers (**D5**).
- **Only one step back,** to the player just before. Once handed back, that player's turn goes on normally. When they end it again, the next player can be asked again.
- **A CPU always hands the dice back** when asked.
- **During setup:** a starting settlement and road, once placed, stay placed. A game option (off by default) allows handing the dice back during the starting placements too (**D6**).

**How it fits the engine:**

- **Saved with the game:** a hand-back is a normal move. It is saved and replayed like any other.
- **Not visible to players:** the snapshot of the turn to restore stays on the server. The only public parts are that a hand-back is possible and whether one was asked for.
- **Earlier saved games** were recorded without this rule and keep replaying exactly as before; only games started after this ships get it.

### 4.5 Settings: per person and per game

**Per person** (your own preferences):

- **Which settings:** the four confirmation settings and the touch-screen one.
- **Saved under your nickname** on the server (**D1**). They follow you to any device and any room where you use the same nickname.
- **Changed any time** from "My settings" in the menu, during a game too.

**Per game** (the table's rules):

- **Which settings:**
  - points to win;
  - every house rule;
  - allow handing the dice back (on by default);
  - allow it during setup (off by default).
- **Set in the lobby** by any seated player, as now.
- **Changeable during the game:** **the player whose turn it is** can change them from the menu, so nobody needs to restart.
  - The change is a normal move. It is saved, replayed with the game, and announced in the log ("Ann turned on 3:1 bank trades").
  - Points to win can't be set at or below the highest score at the table.
- **The game mode itself** (Base, Seafarers, Knights, Full) can't change once the game has started.

### 4.6 Rejoining by name

- **How:** if you leave a game (or lose your device), open the room code and enter **the same nickname**. If that player's seat is disconnected, you get it straight back, with no takeover warning.
- **If the seat is in use:** when someone using that nickname is still connected, you're told the seat is in use.
- **The game simply waits** while someone is away, and carries on once they're back.
- **Taking over someone else's seat** keeps its two-step warning.

### 4.7 Decisions

1. **D1** Personal settings follow your nickname, and rejoining a room by nickname gets your seat back (4.6).
2. **D2** A separate setting can turn off tap-then-Confirm on touch screens. Every switch has a detailed hover (or tap) explanation.
3. **D3** No colorblind marks: 8 well-separated colours for people, and gray only for CPUs.
4. **D4** One ask per turn; a "no" is final. Everyone can switch their own settings on and off at any time.
5. **D5** Open trade offers come back with the hand-back.
6. **D6** No hand-back during setup by default; a game option turns it on.
7. **D7** Per-person settings can be changed any time. Game rules can be changed mid-game by the player whose turn it is, as a recorded move.

### 4.8 Done means

1. **Hand-back tests:**
   - allowed before the new player does anything;
   - refused after a roll, after playing a card, or after any other action;
   - refused for anyone but the player just before;
   - a "no" is final;
   - the turn is restored exactly (state compared field by field, including the hidden parts);
   - a CPU always hands back;
   - the simulator mixes hand-backs into random games with all the usual checks.
2. **A test for each confirmation setting,** on and off, and for settings following a nickname. A test for game rules changed mid-game (recorded, replayed, refused off-turn), and for rejoining by name.
3. **Every colour checked** for contrast against every tile, and against each other colour (with the colorblind simulations), plus the screenshot.
4. **A 3-player game in 3 browsers, start to finish,** using:
   - the mode picker;
   - the new colours with their previews;
   - placement ghosts with Confirm (mouse and a touch-screen browser);
   - the confirmation settings;
   - a hand-back.
5. **`npm run check` green, then deploy.**

## CPU player

The rules are written down, with your decisions, in **docs/bot.md**.

- Any seated player adds a CPU in the lobby; anyone in the lobby renames it, recolours it (gray by default) or removes it. At least one person must play.
- It plays legally but badly (builds on 1 turn in 4), and is never mean: no trading with players (it declines every offer), bank trades only for its hand limit and toward a city, the robber/pirate on an empty hex, else a hex only it uses, else its own hex shared with the fewest players, robbing a CPU before a person; no Monopoly or nasty progress cards; in C&K it builds and activates knights but never displaces or chases.
- It takes 1–2 seconds a move and never chats. Works with every expansion.

## Later milestones (design for these now, don't build them)
- Map editor (custom boards, saved and shared).
- More Seafarers scenarios: The Four Islands, The Fog Islands, Through the Desert, New World, then The Forgotten Tribe, Cloth for Catan, The Pirate Islands, The Wonders of Catan.
- Options for a more competent CPU player.
- Accounts and game history / stats.
- A replay viewer.

## Catan Universe complaints

_What bugs us about Catan Universe. Each one should become a requirement or a test._

-
