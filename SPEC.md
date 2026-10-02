# Settlers — Spec

A private web Catan-style game for three friends, replacing Catan Universe. **Reliability comes first.** No lost games, no desyncs, no rule bugs.

Status: **Milestones 1–9 done and live (deployed 2026-10-02). Milestone 10 built: Seafarers maps from the editor, the Fog Islands, regions and treasures.**

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
- **If the seat is open on another screen** (another tab, a page left open, a phone that dropped off without saying): your name can still be picked. One more tap ("Move my seat here") moves the seat to this screen, and the other screen is told and just watches. Changed on 2 October after a player got stuck: their own seat was held by a second copy of the page.
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
- It takes 1–3 seconds a move and never chats. Works with every expansion.

## Milestone 5: Stats, saved games and game-night extras

**Status: done and live (deployed 2026-10-01).** Your answers are in 5.15.

Reliability still comes first. In particular, every number on a stats screen is worked out from the saved move history, so it can always be rebuilt and always agrees with what happened.

### 5.1 Player profiles

- **What a profile is:** a name and a favourite colour. No passwords.
- **Joining a room:**
  - Pick your profile from a list, or create a new one.
  - The browser remembers your last pick, so it's usually one tap.
  - Your favourite colour is picked for you if it's free.
- **Names are unique,** ignoring capitals and extra spaces ("ann" is "Ann").
- **A profile someone is using** (connected in a room right now) shows as in use, and can't be picked at another table at the same time. At its own table it can: that's how you move your seat to another screen (4.6).
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

## Milestone 6: Custom maps, the generator and the pre-game table

**Status: done and live (deployed 2026-10-02).** One decision added while building: D7 in docs/maps.md (spot rules are soft, your note of 2 October).

The full design is in **[docs/maps.md](docs/maps.md)** (map format, editor, generator and its rules, with "touching" diagrams) and **[docs/pregame.md](docs/pregame.md)** (pre-game table and turn order, with the Joe/Alex/Sam example).

**Build order,** each part shown working before the next:

1. Map format and editor.
2. Generator.
3. Pre-game table.
4. Turn order.

## Milestone 7: Medium and Hard CPUs

**Status: done and live (deployed 2026-10-02, with 9.1, 9.2 and 9.6).** Also: custom CPUs and a page explaining the difficulties (docs/bot-medium-hard.md §5). Tournament targets as changed on 2 October (D2): Hard clearly above its fair share against Mediums, Medium at least 60% against Easys.

The full design is in **[docs/bot-medium-hard.md](docs/bot-medium-hard.md)**:

- Easy stays as it is.
- Medium plays a solid game.
- Hard counts cards, plans and times its moves, with no cheating, enforced by a test.
- Each CPU seat picks its difficulty.

## Milestone 8: Bank, gates, warnings, trading, helpers, keep playing, the log

**Status: done and live (deployed 2026-10-02).** Your answers are in 8.11. Decided while building:

- **The log's robber line** ("The robber blocked 1 Brick from Joe") is a note the server works out from the board after each roll, not a new game event, so every saved game replays exactly as saved and old games get the line too.
- **Laptops and desktops** (1180px wide and up at the display size): the game fits the window and the page never scrolls. The board shrinks a little to keep the prompt in view, the log fills the bottom of the left column, and a column with more than fits (four players in Knights on a 1366×768 screen) scrolls inside itself, keeping whoever's turn it is in view.

### 8.1 Bank supply

**One pre-game setting, "Bank cards: Limited / Unlimited":**

- It's shown with the other options on the pre-game screen, locked when the game starts, and saved with the game.
- **Limited** is the default, with the official supply: 19 of each resource and 12 each of paper, cloth and coin.
- **Unlimited:** the bank never runs out of anything.
- Development and progress decks are the same in both modes.

**Shortages (Limited):**

- When the bank can't pay everyone what a roll produces of one card type, **nobody gets that type** this roll.
- If only **one** player is owed it, they get what's left (official FAQ, as today).
- Cities & Knights says nothing about commodities running out, so they follow the same rule. This is written in docs/rules/cities-and-knights.md as **our ruling**.

**Every bank payout is capped by what the bank holds (Limited):**

- production, Seafarers gold fields included;
- bank and harbor trades;
- Year of Plenty, the Aqueduct, Irrigation, Mining and other progress cards that pay from the bank.

**On screen:**

- The bank's count of every resource and commodity in play (∞ when unlimited).
- When a shortage blocks a payout, the log says so: "The bank is out of Ore: nobody gets Ore this roll".

**Where it lives:**

- The setting lives in the rules engine, so the server, every screen, the CPUs and the stats agree.
- Games saved before this change keep their old behaviour: resources limited, commodities unlimited.

### 8.2 Metropolis gates

**The drawing:** a small **golden gate** on top of the city replaces today's up-arrow tower:

- an arch between two little towers;
- a banner in the track's colour (yellow Trade, blue Politics, green Science);
- a tiny mark of the track's commodity on the banner (cloth, coin, paper), so it doesn't rely on colour;
- the city underneath keeps its owner's colour.

It's checked in screenshots at the smallest and largest zoom and display size. No arrows are left anywhere.

### 8.3 Hover and press-and-hold info on the board

**How it works:**

- Hovering a piece, or **pressing and holding** on a phone or tablet, shows a short label.
- A normal tap does what it does now. Press and hold **only** shows info: it never places or picks anything.

**What the labels say:**

- **Metropolis:** "Science metropolis · Alex · worth 4 points (city 2 + metropolis 2) · can't be pillaged by barbarians · Alex is at Science level 4, so whoever reaches level 5 first takes it". Once the owner reaches 5: "… it's Alex's for good".
- **Knights:** owner, level, active or not.
- **City walls:** owner, "adds 2 to their hand limit".
- **Harbors:** the trade rate.
- **The merchant, the robber and the pirate:** what they do, and whose they are.

### 8.4 Hand-limit warning

**When it shows:**

- When a player holds more cards than their limit, their card count turns **red with a warning icon**, both on your own hand and in the players panel, so everyone sees who's exposed to a 7.
- Hover or press and hold explains it: "11 cards. If a 7 is rolled, you'll discard 5 (half, rounded down). Your limit is 9: 7, plus 2 for your city wall."

**What counts:**

- **The real limit:** 7, plus 2 per city wall (Knights, Full game).
- **Cards:** resources and commodities count; development and progress cards don't.
- **Before the first barbarian attack** (Knights, Full game) the warning still shows, because 7s still make players discard then. The exception is a house rule that turns those discards off (Q2).

**At the end of your turn:**

- If you end your turn over your limit, a small warning shows by End turn, and the end-turn confirmation mentions it.
- It never blocks you.

### 8.5 Points to win

- **Always on screen:** "First to 13" in the top bar, on every device and display size.
- **Every score** shows as "8 / 13".
- **The target lives in the game state:** set from the mode or scenario data at the start (never hard-coded), and raised by Keep playing (8.9).

### 8.6 Trade buttons

**Two buttons:** "**Trade with players**" and "**Trade with bank**", each with its own icon.

- They're bigger and bolder than today, in their own colour, so they're easy to tell from the build buttons.

**Trade with bank:**

- The button shows your best rate: "Bank · 2:1 Ore".
- The bank screen lists your rate for every card type, counting harbors, the Merchant, Merchant Fleet, and the level 3 Trade improvement (2:1 commodities).
- You can make several trades in a row without reopening it.
- The rates come from the rules engine, so the button and the screen always agree with what the engine will accept.

**Trade with players** shows a badge when offers are waiting on you.

**When trading isn't allowed** (before you roll, say), both buttons stay visible but grayed out, with the reason on hover.

### 8.7 Before-the-roll reminders

**Alchemist:**

- If you hold an Alchemist when your turn starts, a **Play Alchemist** button shows next to Roll dice and the dice. It goes away once you roll.
- Playing it lets you choose both production dice; the event die is still rolled.
- With the card confirmation on, rolling while holding an Alchemist asks first: "Roll without using your Alchemist?"

**Knight (Base, Seafarers):** a **Play Knight** button shows there the same way, when you have a Knight you can play before rolling.

### 8.8 Smith

**The card:** it promotes up to 2 of your knights one level each, for free.

- **Normal promotion rules apply:** each knight once per turn; strong to mighty needs the Fortress.
- If no knight can be promoted, playing it warns you first.

**After you play it:**

- Every knight you can promote lights up. Ineligible knights can't be picked.
- **2 or fewer can be promoted:** one button upgrades them all at once: "Upgrade both knights", or "Upgrade knight".
- **More than 2 can be promoted:** you pick two. The game shows both picks with their new levels and an "**Upgrade these 2**" button.
- Nothing changes until you press it. **Cancel** keeps the card in your hand.

**Using only one of two possible upgrades** takes its own clearly separate button and a confirmation ("Use only 1 of your 2 upgrades?"), so a misclick never wastes one.

### 8.9 Keep playing after a win

**Asking:**

- The end screen gets **Keep playing** next to Rematch.
- Whoever presses it picks a new target: default 2 more than the current one, and always higher than everyone's current score.
- Every person must agree; CPUs agree on their own. One "no" ends the game normally.

**Playing on:**

- The first win always counts as a **normal win**.
- Play resumes exactly where it stopped, in the winner's turn, with the new target in the top bar. CPUs play toward it.
- Whoever reaches the new target first gets an **overtime win**: celebrated like a normal win, and the end screen offers Keep playing again.

**Stats:**

- Overtime wins get their own column on the Stats page and in each player's game history ("Overtime wins: 3"), listed with the target reached.
- They never change regular wins, win rate, head-to-head records or average points, which all use the game as it stood at the first win.
- Per-game stats cover the whole game, with a marker where the first win happened.

**Saving:** an overtime game saves and resumes like any other, still in overtime.

### 8.10 The game log

**Following:**

- The log opens at the newest entry and follows new entries.
- If you scroll up, it stops following and shows "**3 new ↓**". Tapping it, or scrolling back to the bottom, starts following again.
- New entries briefly highlight.

**Layout:**

- **On laptops and desktops** (down to 1366×768 at the default display size), the log is visible beside the board without scrolling the page. It has a fixed height, scrolls inside itself, and new entries never move the page.
- **On phones**, its tab or drawer works the same way.

**Content:**

- **Each turn starts with a divider:** the player in their colour and their roll (both dice and the total, plus the event die in Knights and Full game).
- **Colour-coded:**
  - player names in their piece colour;
  - every resource and commodity with its own colour, icon and amount;
  - one set of card colours everywhere: hand, bank, log, stats, tooltips;
  - 7s, the robber and the barbarians in a warning colour.
- **Who got what and how many,** for example:

  ```
  ── Alex · rolled 3 + 5 = 8 ──
  Alex got 2 Brick and 1 Ore
  Sam got 1 Wool
  The robber blocked 1 Brick from Joe
  Alex gave Sam 2 Brick for 1 Ore
  Joe traded 4 Wool to the bank for 1 Grain
  ```

  The same detail goes for builds, discards, steals, development and progress cards, Monopoly, the robber and pirate, the event die, barbarian moves and attacks, knights, metropolises gained or taken, Longest Road and Largest Army changes, and wins (overtime included).

**Hidden information is filtered on the server for each player:**

- Only the thief and the victim see which card was stolen.
- Only the buyer sees which development card they bought.
- Progress cards stay hidden until played; others see only which deck they came from.
- Everyone else sees "a card" or "2 cards".

**Structure:**

- Log entries are stored as structured data (who, what, how many), as the game's events already are.
- Each screen turns them into coloured text.
- Old saved games load with a readable log.

**Readability:**

- Every colour has at least **4.5:1 contrast** against the log's background, checked automatically.
- A player colour too dark or too light for text (black, white, gray) shows the name in normal text with a dot in their colour.
- Colour is never the only signal; the icons and words are always there.
- Player names in table talk are coloured too.

### 8.11 Decisions

1. **D1 Old Knights games** keep unlimited commodities and replay as played. New games default to Limited.
2. **D2 Hand-limit warning with "No discards before the first attack":**
   - No red warning until the first attack.
   - Instead, a calm note: "11 cards: a 7 would cost you 5, but nobody discards until the barbarians have attacked".
3. **D3 Overtime wins** count only in games that count for stats: finished, with 2 or more people.
4. **D4 Cards that wouldn't do anything** warn before being played and say why ("Smith: none of your knights can be promoted right now"), then let you play them anyway. This applies to **every** card, not just the Smith. Examples:
   - Monopoly when nobody holds that card;
   - a Knight with no robber spot that matters;
   - Road Building with no road or ship space;
   - Year of Plenty with an empty bank.
5. **D5 Bank button:**
   - It shows "Bank · 4:1", or 3:1 with that house rule, when no card has a better rate.
   - With the "3:1 bank trades for everyone" house rule on, the **3:1 harbors disappear from the board**. They'd give nothing extra, and someone might build there for a harbor they already have.
   - 2:1 harbors stay.
6. **D6 Card names:** keep Wood, Sheep and Wheat. **Cloth is renamed Linen** everywhere it's shown: hand, bank, log, stats, help. The rules engine's internal name doesn't change, so saved games still load.

### 8.12 Done means

1. **Bank:**
   - Rules tests for Limited mode: resource and commodity shortages, including the one-player case, and every bank payout capped by what the bank holds.
   - 500 simulated games per mode where the bank plus all hands always make 19 of each resource and 12 of each commodity (Limited).
   - Nothing ever refused for lack of cards (Unlimited).
   - The setting shows for everyone before the start, locks after, and survives save and resume.
2. **Gates:** screenshots of all three gates at the smallest and largest zoom and display size; no arrows anywhere.
3. **Hover labels** on a laptop and a phone; press and hold never places a piece.
4. **Hand-limit warning:** shown exactly when a player is over their limit, with the right discard number, walls and commodities included, checked across simulated games.
5. **Points to win:** visible and correct on a phone, a tablet and a laptop, in every mode and scenario, and after Keep playing raises it.
6. **Trade buttons:**
   - Each opens the right screen.
   - The bank button's rate matches the rules engine in every mode.
   - Both are easy to spot in phone and laptop screenshots.
7. **Play Alchemist:** appears only before your roll while you hold one, and goes once you roll. It sets the production dice exactly as chosen; the event die is still rolled.
8. **Smith:**
   - "Upgrade both knights" does both in one step.
   - A single upgrade only happens through its own button and confirmation.
   - Cancel keeps the card.
   - Ineligible knights are never selectable.
9. **Keep playing:**
   - A game past its first win records the first as a normal win and the second as an overtime win.
   - Regular stats stay exactly as at the first win.
   - Overtime survives save and resume.
10. **The log:**
    - On a 1366×768 laptop and a phone, it opens at the newest entry, follows a full game, stops following when scrolled up, shows the new-entries button, and never scrolls the page.
    - The contrast check passes for every player and card colour.
    - Full simulated games confirm no player's log ever shows another's stolen cards, bought development cards or unplayed progress cards.
    - An old saved game loads with a readable log.
11. **`npm run check` green, then deploy.**

## Milestone 9: Sounds, dice on screen, and the barbarians

**Status: 9.1, 9.2 and 9.6 done and live (deployed 2026-10-02); 9.3–9.5 done and live (deployed 2026-10-02, later the same day).** One choice made while building: the pinned dice panel can also be moved by its ⤧ button (a corner at a time), as well as dragged, so it works without a mouse. Your answers are in 9.7. Your requests of 2 October.

**Order (D1):**

- 9.1 (the event die), 9.2 (losing a city) and 9.6 (track order) come **right after Milestone 6**, before the CPUs, because without them the game looks broken.
- 9.3–9.5 (sounds and pinned dice) come after Milestone 8.

### 9.1 The event die beside the big dice

- In Knights games, the **event die** (the barbarian ship, or a gate colour) shows next to the two number dice, the same size. **You always see all three: both number dice, then the event die.**
- It tumbles with them and lands on the server's face, like the number dice.
- It shows on every screen, and stays until the next roll.
- **A setting** also shows the dice in the top-right corner of the board (D5).

### 9.2 Losing a city to the barbarians

Today it's easy to miss, and afterwards things just stop working ("why can't I buy science?"). Instead:

- **A moment everyone sees:**
  - The barbarian ship lands on the board.
  - Each pillaged city visibly turns back into a settlement.
- **A banner for each player who lost a city:**
  - "The barbarians pillaged your city on the ore 6. It's a settlement now."
  - It stays until dismissed.
- **The bad-news tune** (9.3).
- **A red log line:** "Barbarians won (strength 7 against 5): Ann and Bob each lost a city."
- **Afterwards, every blocked action says why.** For example, the improvement buttons say "You need a city to buy city improvements" instead of just being greyed out.
- **Winning against the barbarians gets its own moment too:** Defender of Catan, or the progress cards handed out.

### 9.3 Bad-news music

- A short sad tune ("wah-wah-waaah") for each player whose city the barbarians take. Everyone else hears the barbarian horn (D3).
- It's made in the browser like the other sounds, with no files.

### 9.4 Sound effects for everything

**Each of these gets a sound:**

- dice rolled;
- cards dealt (production, a soft tick per card; on but quiet, with its own switch) (D4);
- card stolen;
- road, ship, settlement and city built;
- ship moved;
- robber or pirate moved;
- development or progress card bought, and played;
- trade done;
- discard;
- knight built, activated and promoted;
- barbarian ship moves, and barbarians attack (won / lost);
- Longest Road or Largest Army taken;
- your turn;
- chat message (on but quiet, with its own switch) (D4);
- win fanfare.

**A Sounds page in Settings:**

- A master volume.
- **For every sound:**
  - on/off;
  - its own volume;
  - a choice of a few styles;
  - a ▶ button to hear it.
- It's saved on your profile, so it follows you to any device. It only changes what **you** hear.
- **No sound files:** every sound is made in the browser (Web Audio), as today. Nothing to download, and it works offline.

### 9.5 Dice statistics pinned on screen

- The dice statistics sheet gets a **Pin** button. That puts a small panel in a corner of the board, which stays there all game:
  - the 2–12 bar chart (rolled vs expected);
  - the last roll;
  - the event die faces (Knights).
- It starts in the top-left corner (the top-right one is for the dice, 9.1). You can drag it to another corner, shrink it to a strip, or unpin it.
- It's a personal setting, remembered on your profile.
- On a phone, it's a thin strip above the hand.

### 9.6 Knights tracks in the same order as the cards

- The commodity cards show in your hand as **book, linen, coin** (science, trade, politics).
- The tracks are listed **trade, politics, science**.
- From now on, **Science, Trade, Politics** everywhere, matching the cards: the track list, the improvement buttons, the progress decks, the barbarian bar (D2).

### 9.7 Decisions

1. **D1 Order:** the fixes that make the game look broken (9.1, 9.2, 9.6) come right after Milestone 6. Sounds and pinned dice come after Milestone 8, then Milestone 10.
2. **D2 Track order:** Science, Trade, Politics, the same as book, linen, coin.
3. **D3 Losing a city:** the sad tune plays for whoever lost a city; everyone else hears the barbarian horn.
4. **D4 Card ticks and chat:** on by default but quiet, each with its own switch.
5. **D5 The dice:**
   - You always see both number dice and then the event die.
   - A setting also shows them in the top-right corner of the board.

### 9.8 Done means

1. **The event die:** screenshots of all three dice after a Knights roll, on a laptop and a phone, and with the corner setting on.
2. **Losing a city:** a full Knights game in browsers where the barbarians win and take a city. The player who lost it gets the banner, the tune and the log line. A blocked improvement says why.
3. **Track order:** every place tracks are listed shows Science, Trade, Politics.
4. **Sounds:**
   - Every sound plays at its event.
   - Each one's switch and volume work, and are saved on the profile.
   - Turning a sound off on one screen doesn't change anyone else's.
5. **Pinned dice:** the panel stays put through a whole game, survives a reload, and works on a phone.
6. **`npm run check` green, then deploy.**

## Milestone 10: Seafarers maps you design, fog islands and treasures

**Status: built and tested (editor tests, rules tests for every treasure, 1,000 simulator games each on the Fog Islands and a treasure test map in Seafarers and Full game mode, e2e/m10.spec.ts). Treasure rules as agreed in docs/rules/treasures.md.** Your requests of 2 October.

### 10.1 Seafarers maps from the editor, "broken" ones too

The editor already has sea, gold and fog tiles with Seafarers on. To make maps like "build a lot of boats to cross the water to a gold island" playable, it gets the Seafarers scenario pieces:

- **Start area:** paint the hexes where starting settlements may go (as on Heading for New Shores).
- **Island bonus:** points for settling a new island, 0–3.
- **Pirate start:** a sea hex, or off the board.
- **Points to win** (already there).

**Unbalanced on purpose is fine:**

- Warnings never block saving or playing.
- The only hard checks are the ones a game can't do without: a valid file, and at least 2 starting spots per player in the start area.

**Playing it:** pick it at the pre-game table in Seafarers or Full game mode.

### 10.2 Fog island maps

- **Fog tiles in the editor**, with a fog stack: what can turn up under the fog (land, gold, sea, and numbers).
  - You can set the stack yourself, or leave it standard.
  - The rules for discovering fog are already in the engine (docs/rules/seafarers.md §11).
- **A built-in Fog Islands map** for Seafarers and Full game mode: a home island, with fog hiding islands and gold across the water.
  - The layout is our own.
  - The rules are the official fog rules, as already written in docs/rules/seafarers.md §11 (D2).

### 10.3 Treasures

Treasure spots, placed in the map maker (as in Catan Universe). The rules (D3):

- **Where:** a treasure sits on a **path**, where a road or ship can go.
- **Finding it:** the first player to **build a road or ship on it, or move a ship onto it**, finds it.
- **Face down:** the finder draws the top card of a shuffled **treasure deck**.
  - Everyone sees what it is.
  - It happens straight away, for the finder only.
- **The treasures:**
  - **Free roads and ships:** 2 placed straight away, in any mix (2 roads, 2 ships, or 1 of each), like a Road Building card played at once.
    - The normal building rules apply.
    - You can't go beyond your pieces in supply.
    - If there's no legal spot, the rest is lost.
  - **2 resources of your choice:** resources only, never commodities.
  - **1 sheep, 1 brick and 1 wheat.**
  - **A free development card:** in Knights games, a progress card from the deck you pick.
- **No other kinds** of treasure.

The exact rules, including what happens when the bank or a deck runs out, get written in docs/rules/treasures.md first, then agreed, as for the expansions.

### 10.4 Your layout, random tiles and numbers

- **Blank tiles already do this.** In the editor, any tile or number left blank is drawn when the board is made at the pre-game table, and every reroll draws again. Anything you place or lock stays.
- **New: regions.** Tiles can be grouped into regions, each with its own tile set, shuffled only within that region. For example:
  - the home island gets the standard tiles;
  - the far islands get gold and the rest.
- This works for **every mode**, not only Seafarers: a base-game map can have blanks too (D5).

### 10.5 Tests ("done means")

1. **Rules tests** for every treasure:
   - finding one by building a road, building a ship, and moving a ship;
   - piece limits and no legal spot for free roads and ships;
   - the bank or a deck running out.
2. **The simulator**, 1,000 games each in Seafarers and Full game mode:
   - on the Fog Islands;
   - on a test map with treasures.
   - **New invariants:** the treasure deck plus the treasures found always make the whole deck, and no treasure is found twice.
3. **Editor tests:** the start area, island bonus, pirate start, fog stack, treasure spots and regions, each with undo and redo.
4. **A full 3-player game in browsers** on a custom Seafarers map with fog and treasures, with a gold island across the water.
5. **`npm run check` green, then deploy.**

### 10.6 Decisions

1. **D1 Start area:** one shared start area per map, as on Heading for New Shores.
2. **D2 Fog Islands:** our own layout, played with the official fog rules.
3. **D3 Treasures:** as in 10.3.
4. **D4 Free roads and ships from a treasure:** placed right away, with normal rules and piece limits; any mix of two.
5. **D5 Regions:** in every mode.

## Milestone 11: Your own screen layout

**Status: written down from your request of 2 October; to build after treasures (Milestone 10). The choices below are my defaults: change any you don't like.** You asked to move the boxes around, hide them, and pin them to the top, bottom, left, right or centre.

### 11.1 What you can change

- **Edit layout** in the game menu turns the game screen into a layout editor. Every box gets a handle and buttons:
  - the players, table talk and the log, your hand and building costs, the barbarians and progress (Knights), the dice and the prompt bar, the pinned dice, and the trade buttons.
- **Where a box goes:**
  - **docked** to the left, right, top or bottom edge, in the order you drag it to (several boxes can share an edge);
  - or **floating** anywhere over the board, at the size you drag it to.
- **Hide** any box. A hidden box leaves a small tab on its edge ("Log", "Players"), so it's one tap to peek and tap again to put away.
- **The board** fills whatever space is left and can't be hidden.
- **Presets:** Standard (today's layout), Big board (everything docked small or hidden behind tabs), Left-handed (left and right swapped), and Reset.
- **Done** saves it.

### 11.2 Rules that keep it reliable

- **Nothing you need to act on can be lost:** the prompt bar (with Roll, Confirm and End turn) and every sheet that needs an answer (discard, gold, trade offers, owed choices) always show, even if their box is hidden or floating off screen. A box dragged off the screen snaps back inside.
- **Saved on your profile, per kind of screen** (laptop, tablet, phone), since a layout for a wide screen won't fit a phone. It follows you to a new device, and nobody else's screen changes.
- **Phones:** boxes can be reordered and hidden, not floated (there's no room).
- A layout from an older version (or a box added later) falls back to its default place, never to an error.

### 11.3 Tests ("done means")

1. Unit tests: every move, dock, float, hide and preset; a saved layout that's broken or from an older version loads as a sensible one.
2. A browser test on a laptop, a tablet and a phone: boxes moved, docked to each edge, floated, hidden and peeked; the prompt and a discard still appear with everything hidden; the layout survives a reload and a new device; Reset.
3. `npm run check` green, then deploy.

## Later milestones (design for these now, don't build them)
- More Seafarers scenarios: The Four Islands, Through the Desert, New World, then The Forgotten Tribe, Cloth for Catan, The Pirate Islands, The Wonders of Catan (The Fog Islands is Milestone 10).
- Options for a more competent CPU player.
- A replay viewer.

## Catan Universe complaints

_What bugs us about Catan Universe. Each one should become a requirement or a test._

-
