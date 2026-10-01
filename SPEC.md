# Settlers — Spec

A private web Catan-style game for three friends, replacing Catan Universe. **Reliability comes first.** No lost games, no desyncs, no rule bugs.

Status: **Milestone 1 (base game) — agreed, in progress.**

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

## Later milestones (design for these now, don't build them)
- Map editor (custom boards, saved and shared).
- Seafarers (ships, sea hexes, variable boards).
- Cities & Knights (commodities, city improvements, barbarians, progress cards).
- A deliberately weak CPU player. It joins as a normal client and sees only its own view.
- Accounts and game history / stats.
- A replay viewer.

## Catan Universe complaints

_What bugs us about Catan Universe. Each one should become a requirement or a test._

-
