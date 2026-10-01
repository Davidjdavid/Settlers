# Settlers — Spec

A private web Catan-style game for three friends, replacing Catan Universe. **Reliability comes first.** No lost games, no desyncs, no rule bugs.

Status: **Milestones 1–4 (base game, Seafarers, Cities & Knights, table polish) and the CPU player done and live. Milestone 5 (stats, saved games, game-night extras) agreed and being built.**

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

**Status: done and live (deployed 2026-10-01).**

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

## Milestone 5: Stats, saved games and game-night extras

**Status: agreed (your answers are in 5.15). Being implemented.**

Reliability still comes first. In particular, every number on a stats screen is worked out from the saved move history, so it can always be rebuilt and always agrees with what happened.

### 5.1 Player profiles

- **What a profile is:** a name and a favourite colour. No passwords.
- **Joining a room:**
  - Pick your profile from a list, or create a new one.
  - The browser remembers your last pick, so it's usually one tap.
  - Your favourite colour is picked for you if it's free.
- **Names are unique,** ignoring capitals and extra spaces ("ann" is "Ann").
- **A profile someone is using** (connected in a room right now) shows as in use, and can't be picked by a second person at the same time.
- **What hangs off a profile:**
  - your personal settings (moved over from your nickname);
  - your seat in every game, past and saved;
  - all your stats.
  - Rejoining a room or resuming a saved game matches seats by profile.
- **Merging two profiles** (e.g. a typo "Bbo" into "Bob"):
  - From the Stats page.
  - Two confirmations.
  - Everything of the merged profile moves to the kept one: games, stats, settings stay those of the kept one.
  - Refused if both profiles sat in the same game, since that game would have two seats for one person.
  - Recorded, so stats stay rebuildable.
- **Existing games:** a profile is created for every nickname already in the database, so your games so far count in the stats.

### 5.2 CPU records

- **CPUs aren't profiles.** Each CPU difficulty has its own record, e.g. "Easy CPU: 0 wins, 147 losses", shown on the Stats page.
- **Today's CPU is "Easy"** (**D1**).

### 5.3 Dice

**One dice function** on the server rolls every die in every game: people's rolls, CPU rolls, re-rolled 7s, and the event die.

- **How a roll works:**
  - Each die is its own number from 1 to 6, from Node's cryptographically secure generator (`crypto.randomInt`).
  - The total is the two dice added together. A total from 2 to 12 is never generated directly.
- **The event die** (Knights, Full game) is a separate roll of its own.
- **How the rolled dice reach the engine:**
  - The server puts the rolled dice into the roll move before the engine applies it, and saves them with the move.
  - Replays and stats use exactly those dice.
  - The engine stays pure: it never rolls anything itself for new games.
  - Players can't send dice; the server rejects a roll move that carries any.
  - Games saved before this milestone still replay with the old rolls (ENGINE_VERSION goes to 2; old games keep version 1 behaviour).
  - Other shuffles (the board, card decks, which card is stolen) stay as now, from the game's secret seed.
- **The Alchemist:** the dice land on the numbers the player chose.
- **"Balanced dice"** isn't part of this milestone. If it's ever added, it will be a house rule, off by default, and labelled as changing the odds on purpose.

**On screen:**

- **Next to the Roll dice button:** the two dice, each showing its own face. On your roll, the dice are clickable and work exactly like the button. They look clickable on hover, and do nothing when it isn't your roll.
- **The roll animation:**
  - Every roll tumbles for about half a second on every screen, then lands on the server's result.
  - For the roller, the tumble starts the moment they click.
  - The animation is only for show. It always ends on the real numbers.
  - With "reduced motion" on, a short fade replaces the tumble.
- **A dice sound** plays for everyone on every roll (game sounds switch, 5.9).

### 5.4 Dice statistics

**During a game,** in a "Dice" panel anyone can open:

- **A bar chart of totals 2–12:** how often each has been rolled, next to how often it should have been with two real dice. For example, 7 is 6 in 36, 6 and 8 are 5 in 36, and 2 and 12 are 1 in 36.
- **Rolls per player,** and the number of 7s.
- **"Hasn't come up" callouts,** e.g. "no 8 in 20 rolls". One shows when a total has gone so long without coming up that the chance of a gap that long is under 10%. That's 16 rolls for a 6 or 8, 13 for a 7, and 82 for a 2 or 12.
- **The event die** (Knights, Full game): how often each face came up against 1 in 6 each (3 in 6 for the ship).

**All-time,** on the Stats page (finished games with two or more people, **D2**):

- **The same charts** across every game.
- **Each player's luck:** cards produced by the dice compared with what was expected.
  - Expected means: on each roll, the average production over all 36 outcomes, given that player's buildings, the robber and the bank at that moment.
  - Shown like "received 412, expected 389 (+6%)".

### 5.5 Per-game stats

Shown on the end screen, and for any past game from the Stats page, including games played before this milestone.

For each player:

- **Cards received** by type, split by source:
  - production;
  - trades with players;
  - trades with the bank;
  - steals;
  - cards (Year of Plenty, Monopoly, progress cards, gold, aqueduct and the like);
  - starting resources.
- **Cards lost** by type:
  - robbed;
  - discarded on 7s;
  - taken by Monopoly or progress cards;
  - lost in trades;
  - spent on building.
- **Robber:** times robbed and times they robbed someone, plus a who-robbed-whom table.
- **Cards and building:**
  - development or progress cards bought (drawn) and played, by type;
  - knights played (base);
  - knights built, promoted and activated (C&K);
  - buildings by type;
  - longest road reached;
  - trades with players and with the bank.
- **Points by source** (5.8).
- **A chart of every player's points over the game,** turn by turn.
- **Their most productive tile:** the tile, its number, and how many cards it gave them.

**Hidden information:** during a game, only the dice stats are shown. Everything else waits until the game is over, so stats can't give away a hand.

### 5.6 Stats page

Reached from the start screen. Pick a name (a profile, or a CPU difficulty) to see:

- **Results:** wins and losses, overall and by game mode, and win rate.
- **Points:** average points per game.
- **Head-to-head records** against each other player.
- **All-time totals:** resources received and lost by type, robberies done and suffered.
- **Dice luck** (5.4).
- **Streaks:** current and longest winning streak.
- **Past games:** date, mode, players, winner. Each opens that game's stats (5.5).

**What counts:**

- **Only finished games with two or more people** count (**D2**), for the dice charts too.

**How it's worked out:**

- A pure function in the engine replays a game's saved moves and adds up its events.
- The server caches the results, but can always throw the cache away and rebuild it.
- A test checks that the running totals kept during play equal a fresh rebuild.

### 5.7 Saved games

- **Saving is automatic,** after every move, as now.
- **"Save and quit"** (in the menu) ends tonight's session.
  - It asks everyone first, with the same warning as ending a game, but it loses nothing.
  - The room closes, and everyone goes back to the start screen.
- **The Saved Games list** on the start screen shows each unfinished game with:
  - its players and their colours;
  - the date it was last played;
  - the game mode;
  - the current scores (public points only);
  - a small map preview.
- **Resume:**
  - Opens a fresh room for that game.
  - Each person picks their profile and gets their own seat back.
  - The game carries on exactly where it stopped.
  - CPUs come back on their own.
  - Several saved games can exist at once.
- **Delete:** two confirmations. Removes the game from the list (**D2**).
- **Games already in progress in a room** show up in the list too.

### 5.8 Point breakdowns

Every player's score can show what it's made of, for example "5 = 3 settlements (3) + Longest Road (2)".

- **How to see it:** tap or hover a score. A personal setting shows breakdowns all the time.
- **Every source in every mode:**
  - settlements;
  - cities;
  - Longest Road (Longest Trade Route in Seafarers);
  - Largest Army;
  - victory point cards;
  - island bonuses (Seafarers);
  - metropolises, Defender of Catan, the merchant, and point-giving progress cards (Knights, Full game).
- **Hidden points:** your own breakdown includes your hidden victory point cards, marked as hidden. Other players' breakdowns show only their public points.
- **How it's worked out:** the engine builds the breakdown itself, and a test checks it always adds up exactly to the score shown.
- **Points to win:** the screen shows the points the game needs, and how many each player still needs.

### 5.9 Turn alerts and sounds

- **The turn sound** plays only for the player who needs to act:
  - your turn starts;
  - a setup placement;
  - a discard;
  - a trade offered to you;
  - a choice you owe (gold, C&K choices);
  - someone asks for the dice back.
- **Personal settings,** remembered on your profile:

  | Setting | Default | What it does |
  |---|---|---|
  | Turn sound | on | The sound above. |
  | Game sounds | on | Dice, building, robber and the win fanfare. |
  | Browser notification | off | A notification when it's your move and the tab is in the background. Switching it on asks the browser's permission. |

- **No sound files:** the sounds are made in the browser (Web Audio), with no new dependencies.

### 5.10 Undo, with everyone's OK

- **Asking:** right after your own move, an "Undo" button lets you ask to take it back.
- **Who approves:** every other person at the table. CPUs approve automatically.
  - One "no" cancels the request.
  - Anyone who doesn't answer simply holds it open.
  - You can withdraw your request.
- **Which move:** only your most recent move, and only until anyone else acts or you make another move.
- **Moves that can be undone** (they reveal nothing hidden):
  - placing a road, ship, settlement, city, knight or wall;
  - a setup placement;
  - moving a ship or a knight;
  - promoting or activating a knight;
  - a city improvement;
  - a bank trade;
  - moving the robber or pirate when nobody was robbed.
- **Moves that can never be undone:**
  - dice rolls;
  - steals;
  - drawing or buying a card;
  - playing a card (it shows what was in your hand);
  - discards;
  - trades with players (someone else acted);
  - discovering fog or a new island;
  - ending your turn (that's the dice hand-back, 4.4).
- **Undoing** restores the game exactly as it was before the move, like the hand-back.
- **How it's recorded:** asking, answering and the undo itself are recorded moves, so replays and stats stay exact.

### 5.11 Pieces

- **Ships:** already drawn as small boats (a hull and a sail) and roads as straight bars. That will be checked in screenshots at the smallest zoom and display size, and the boat made bigger or bolder if it isn't obvious.
- **Knights:**
  - Level shown by shape as well as pips: basic is a plain shield, strong has a helmet crest, mighty has a crown.
  - An active knight has a bright gold ring and is fully solid; an inactive one is dimmed with no ring.
- **City walls:** a thicker stone base with crenels.
- **Metropolises:** a taller tower in the track's colour.
- **Pieces left:**
  - Every player's panel shows how many pieces they have left, as small icons with numbers:
    - roads, settlements and cities, everywhere;
    - ships in Seafarers and Full game;
    - knights by level and city walls in Knights and Full game.
  - Everyone sees everyone's counts. A count at 0 turns red.
  - Your build buttons show yours, e.g. "Settlement · 2 left".
  - The engine provides the counts, and a test checks them against the rules.

### 5.12 Zoom and display size

- **Board zoom:**
  - Ways to zoom: + and − buttons, the mouse wheel, trackpad pinch, or two-finger pinch on phones and tablets.
  - Drag to move around while zoomed.
  - A "Fit board" button snaps back.
  - Zoom changes only your own view.
- **Display size:**
  - Small, Medium (today's size), Large or Extra large.
  - Scales text, cards, buttons and panels together.
  - Remembered per device, since a phone and a laptop want different sizes.
  - At every size the layout adapts: nothing overlaps, nothing is cut off, no sideways scrolling.
- **Taps land where you aim** at every zoom level, including on Confirm ghosts.

### 5.13 Win celebration

- **When someone wins:**
  - confetti in the winner's colour;
  - a winner banner;
  - a short fanfare (game sounds switch);
  - then the end screen with that game's stats and a **Rematch** button: same players, same mode, new board.
- **With reduced motion on:** the banner and end screen, with no confetti.

### 5.14 CPU chatter

This replaces bot.md D6 ("the CPU never talks").

- **What CPUs post** now and then in table talk, marked as a CPU:
  - what they're looking for ("anyone have brick?");
  - what they have too much of ("drowning in wheat");
  - what they're saving for;
  - reactions ("robbed AGAIN").
- **How often:** at most one message per CPU per turn, and not every turn (about 1 turn in 4).
- **Turning it off:** a room setting, on by default, changeable in the lobby or mid-game like other table rules.
- **Honesty:**
  - Easy (and Medium) say only what's true about their hand and plans.
  - Hard is cagey and may bluff.
  - Every level only knows what a person at the table would know, because chatter is made from the CPU's own view.
- **Saved and replayed:** chatter is saved like a normal chat line, so it doesn't change the game.

### 5.15 Decisions

1. **D1** Today's CPU is **Easy**. Records and chatter are built for Easy, Medium and Hard. Medium and Hard themselves come in the next milestone, with their rules agreed first in docs/bot.md.
2. **D2** **Stats history only holds finished games with two or more people.**
   - What counts: all-time totals, dice charts, luck, wins and losses, head-to-heads, streaks, CPU records, and the past-games list.
   - What doesn't count: unfinished games, and games with one person against CPUs.
   - Those games still show their own end-screen stats, and unfinished ones can still be saved and resumed.
   - Deleting a saved (unfinished) game removes it from the Saved Games list. It was never part of the history.
   - Finished games are history and can't be deleted.

### 5.16 Done means

1. **Dice:** a test of 1,000,000 rolls through the dice function.
   - Each die is even over 1–6.
   - The totals match two-dice odds within a tight tolerance: 2 about 2.8%, 6 about 13.9%, 7 about 16.7%. The tolerance is set from the expected spread, so a correct generator fails less than 1 time in 10,000.
   - The event die is checked the same way.
2. **Stats:**
   - Rebuilt from the move log, they match the live totals in a test over 500 simulated games.
   - Wins, losses and head-to-heads are checked against known games.
3. **Saved games:** a game is saved, the server restarted, and the game resumed identically, in seats matched by profile.
4. **Undo tests:** approved; denied; refused for hidden information (roll, steal, card draw and play, fog); refused after someone else acts.
5. **Turn sound:** it plays only for the player who needs to act, and only when their setting is on (browser test).
6. **Dice on screen:**
   - Clicking the dice rolls exactly like the button.
   - The animation lands on the server's result on every screen.
   - The dice sound plays for everyone and respects the switch.
7. **Pieces:**
   - Ships and roads are clearly different in screenshots at the smallest zoom and display size.
   - Pieces-left counts match the engine across 500 simulated games in every mode.
8. **Points:** every breakdown adds up exactly to the score shown, across 500 simulated games in every mode and scenario.
9. **Zoom and display size:**
   - tested on a phone, a tablet and a laptop screen at every display size;
   - nothing overlaps or is cut off;
   - placements land exactly where tapped when zoomed.
10. **CPU chatter:** respects its one-per-turn limit and the off switch, and Easy only says true things.
11. **A full 3-player game in browsers** ends with confetti and correct stats.
12. **`npm run check` green, then deploy.**

## Later milestones (design for these now, don't build them)
- Map editor (custom boards, saved and shared).
- More Seafarers scenarios: The Four Islands, The Fog Islands, Through the Desert, New World, then The Forgotten Tribe, Cloth for Catan, The Pirate Islands, The Wonders of Catan.
- Options for a more competent CPU player.
- A replay viewer.

## Catan Universe complaints

_What bugs us about Catan Universe. Each one should become a requirement or a test._

-
