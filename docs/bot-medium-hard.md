# CPU players: Medium and Hard

**Status: agreed (your answers are in section 6). Being implemented.**

Today's CPU becomes **Easy** and stays exactly as it is ([bot.md](bot.md)). This adds **Medium** and **Hard**.

**Choosing a difficulty:** in the lobby, by a menu on each CPU seat: Easy, Medium or Hard. The CPU's name gets a small tag ("Turnip · Hard").

**Where they play:** all three play all four game modes: Base, Seafarers, Knights and Full game.

## 1. What every difficulty shares

### 1.1 It sees only its own screen (no cheating)

**What a CPU is given:**

- Exactly what a person in its seat would get: the per-seat view (`viewFor`, the same function that builds each human's screen) and the events redacted for that seat.
- It never gets the game state, other hands, the deck order, the dice to come, or the random seed.

**Its own memory** (Hard's card tracking, say) is built only from those views and events, kept between moves.

**This is enforced by design, not by care:**

- The CPU code lives in its own module that **can't import** the game state, `viewFor` or the random number generator's state. A test fails if it does.
- Its only input type is the view.

**The no-cheating test:**

- In simulated games, before every CPU move, the test makes a copy of the real game with every hidden thing scrambled. That means:
  - other players' hands;
  - unplayed development and progress cards;
  - deck order;
  - the dice to come.
- That copy still gives the CPU **exactly the same view**.
- The CPU must choose **exactly the same move** on both, with the same memory.
- If any hidden fact ever changed a decision, the test catches it: run for all difficulties, all modes, thousands of moves.

### 1.2 Pace, trading and chatter

- **Pace:** every CPU waits **1 to 3 seconds** per move, so people can follow along.
- **Trading with people** (Medium and Hard; Easy never trades with people, as now):
  - It answers offers made to it: accept or decline.
  - It makes **at most one offer per turn**, only fair ones, made to everyone like a person's offer.
  - Two room settings, both set at the pre-game table before the game starts (D4):
    - **"CPU trading"**, on by default. Off means CPUs neither offer nor accept; offers to them are declined.
    - **"One CPU offer per turn"**, on by default. Off lets a CPU make more than one offer in a turn (still only fair ones, and never the same offer twice).
- **Chatter:** as in SPEC 5.14. Medium only says true things; Hard can be cagey or bluff, still knowing only what its screen shows.

## 2. Medium: a normal, solid player

Medium plays the way a decent human plays without counting cards. It decides each move by **scoring the options** with simple rules and taking the best, with a little randomness to break ties.

### 2.1 Starting spots

Each corner is scored by:

- **Pips:** the total on the corner (maps.md 1.2), the main factor.
- **Variety:** a bonus for each different resource. More for brick and wood on the first pick (roads and settlements early), more for ore and wheat on the second (cities).
- **Harbor:** a small bonus for a 2:1 harbor whose resource it produces well, or a 3:1 harbor.
- **Scarcity:** a bonus for resources that are rare on this board.
- **Seafarers:** coast spots get a little extra, for ships to new islands.
- **Cities & Knights:** forest, pasture and mountains get a little extra, since cities there make commodities.

**The second pick** prefers resources the first doesn't give. **The starting road or ship** points toward the next-best free spot.

### 2.2 Building

- **Order of preference:**
  1. A city (when it has a settlement to upgrade).
  2. A settlement on a good open spot it can reach.
  3. A road or ship toward the best open spot.
  4. A development card (Base, Seafarers).
  5. City improvements, walls and knights (Knights mode, 2.5).
- **Saving up:** it saves for the next item rather than spending on something worse.
- **The bank:** it trades with the bank (best rate, harbors included) when that completes a build this turn. It also trades away cards when over the hand limit at the end of its turn.

### 2.3 Cards

- **Knight:**
  - before rolling, if the robber is on one of its producing hexes;
  - or when it would take or keep Largest Army.
- **Road Building:** when it has a spot worth reaching within two roads.
- **Year of Plenty:** when it completes a city or settlement.
- **Monopoly:** when it expects at least 4 cards. It guesses from what the others produce, using only the board and the rolls it saw.
- **Victory point cards** are revealed only to win.

### 2.4 The robber and stealing

- **When it attacks (D1):** only when someone is **close to winning**, within 3 points of the target on public points. Until then Medium places the robber like Easy: on a hex nobody uses, else one only it uses, and never against a person.
- **Who:** once someone is close, the robber goes against **whoever is ahead** on public points. Ties go to the player with more cards.
- **Where:** on that player's best hex (most pips × their buildings there) that doesn't touch Medium's own buildings.
- **The steal** is from that player.
- **Seafarers:** the pirate goes after the leader's ship routes when that hurts them more.

### 2.5 Knights mode and the full game

- **Improvements:** one track at a time, towards a metropolis. It picks the track whose commodity it makes most.
- **Knights:**
  - It builds and activates enough knights that the barbarians don't take its cities, using the barbarian track and everyone's public knight strength.
  - It promotes when it has the Fortress for mighty knights.
  - It chases the robber off its own hexes.
- **Progress cards:** it plays the helpful ones when they pay off (Crane, Engineer, Irrigation, Mining, Smith, and the like). It plays attacking cards (Spy, Saboteur, Warlord, Wedding…) against the leader.
- **Walls:** a wall goes up when it often holds many cards.

### 2.6 Trading with people

- **Accepting:** it accepts an offer when the cards it gets help its next build, it gives no more than it gets, and the other player isn't within 2 points of winning.
- **Offering:** it offers 1-for-1 or 2-for-1 (more of what it has plenty of, for what it needs), at most once per turn.

## 3. Hard: as well as it can, without cheating

Hard uses everything Medium does, plus three things a strong human does: **counting cards**, **planning**, and **timing**.

### 3.1 Tracking hands (public information only)

For every other player, Hard keeps a **likely hand**: for each card type, a range and a best guess. It updates this from what everyone can see:

- **Production:** who got what is shown on every screen.
- **Trades:** bank, harbor and player trades, with the cards shown.
- **Builds:** the known costs leave the hand.
- **Discards** on a 7, and Monopoly, Year of Plenty and progress-card effects.
- **Steals it didn't see:** the card is unknown, so it's a **probability** spread over the victim's likely hand, in proportion to what they probably had.
- **A check every turn:** each player's public card count must equal the guess's total; the guess is corrected if not.

### 3.2 Guessing development and progress cards

- **What's left to draw:** the deck's contents minus every card already played, minus Hard's own.
- **Each player's unplayed cards:** from how many they drew and that pool. For example, "Ann holds 2 unplayed cards; with what's left, each is a Knight with about 55% chance".
- **Knights mode:** progress cards per track, from the decks' contents and the cards played.
- **What it's used for:**
  - Expected army size (Largest Army threats).
  - Monopoly risk: holding fewer of a card someone is likely to monopolise.
  - Possible hidden victory points (how close someone really is to winning).

### 3.3 Planning the way to win

Hard keeps an estimate of **how many turns** each way to the target would take, given its production and the board. The ways are:

- settlements and cities;
- Longest Road / Trade Route;
- Largest Army;
- victory point cards (Base, Seafarers);
- island bonuses (Seafarers);
- metropolises and Defender of Catan (Knights).

**Choosing a plan:**

- It picks the fastest mix, for example "two cities + Largest Army".
- It replans every turn, when someone takes a bonus it wanted, a spot is lost, or the robber moves in.
- It also estimates **every opponent's** turns to win, so it knows who is the real threat. That isn't always whoever has the most visible points: hidden VP cards and production count too.

**Within a turn:**

- It searches the sequences of moves it can make: trades, builds, cards, in different orders.
- It takes the one that leaves it best placed for its plan.
- **Thinking time (D3):** the same 1–3 second pace as every CPU. Hard does its search during that pause, so it never looks slower; it just uses the time better.

### 3.4 Timing and combinations

- **Cards are held until they're worth most.** Examples:
  - a Knight played to take Largest Army at the right moment, or to free a key hex;
  - Monopoly right after others' big production;
  - Road Building to snatch Longest Road in one turn;
  - Year of Plenty to finish a city in the same turn as another build.
- **Combinations:**
  - Merchant + Merchant Fleet + bank trades.
  - Alchemist when one roll would pay well and avoid a 7.
  - Crane before an improvement.
  - Engineer + wall.
  - Deserter before the barbarians land.
- **Winning:** it reveals victory points only to win, and wins in one turn when it can (it counts its own exact path to the target).

### 3.5 Blocking

- **The robber, the pirate and attacking cards** go against the **real leader**: the one closest to winning by its estimate, not just public points.
- **Trades:** it **refuses trades that help the leader**, and never gives anyone the card they need to finish a winning build.
- **Monopoly** where it also hurts the leader most.
- **Spots:** it takes or blocks key settlement spots on the leader's path, and Longest Road extensions.

### 3.6 Trading with people

- **Fairness:** it trades only when the trade is at least fair for it by its own valuation (what each card is worth to its plan right now).
- **Never with the leader.** It never accepts from, or offers to, someone it judges to be the leader.
- **One offer per turn at most.** It uses its estimate of others' hands to offer something they probably can and want to accept.

## 4. Tests ("done means")

1. **No illegal moves:** at least 1,000 simulated games per difficulty and mode (3 × 4 combinations), every CPU move legal, plus every existing simulator check (rules, invariants, replay, leaks).
2. **No cheating:** the test in 1.1 for every difficulty and mode, plus the import check.
3. **Tournaments** (Easy is the baseline):
   - **Hard vs Medium:** 4-player games, 1 Hard + 3 Medium, every mode, 1,000 games each. Hard should win **well above 25%** (the share by chance). Target: at least 40%.
   - **Medium vs Easy:** 1 Medium + 3 Easy. Target: Medium wins at least 60%.
   - Also 2 Hard + 2 Medium, and other mixes, reported for interest.
   - **The win rates are reported to you,** per mode, with how many games.
4. **Trading with people:** CPUs accept only trades that pass their rules, offer at most once per turn, and stop completely when "CPU trading" is off.
5. **Pace:** every CPU move waits 1–3 seconds (tested on the fake clock).

## 5. Custom CPUs and the CPU page

### 5.1 The CPU page

A page on the site (from the start screen and the CPU seat menu) explains in plain words how Easy, Medium, Hard and your custom CPUs play. It's the same differences as this document, shown side by side:

- where they start;
- what they build;
- when and whom they rob;
- how they trade;
- how they use cards.

### 5.2 Custom CPUs

You can make your own CPU personalities, saved for everyone like maps and presets.

**What a custom CPU is:** a name, plus a base level (Medium or Hard), with sliders:

| Slider | Range |
|---|---|
| Robber | Gentle (Easy's rule) · Only near the end (Medium) · Always the leader |
| Trading | Never · Fair only · Generous · Shrewd |
| Building style | Cities first · Settlements and roads · Development/progress cards · Balanced |
| Longest Road / Army / metropolis focus | Ignore · Normal · Chase hard |
| Card timing | Play as soon as useful (Medium) · Hold for the best moment (Hard) |
| Chatter | Off · Quiet · Chatty |

**Rules for custom CPUs:**

- A custom CPU can be picked for any CPU seat, like a difficulty.
- It plays in all four modes.
- It's held to the same no-cheating rule and tests as every CPU.
- Its stats record is under its own name.

## 6. Decisions

1. **D1 The robber:**
   - Easy never robs a person.
   - Medium robs whoever is ahead, only once someone is within 3 points of winning; before that it robs like Easy.
   - Hard always goes for the real leader, people included.
2. **D2 Tournament targets:** Hard wins at least 40% against three Mediums, and Medium at least 60% against three Easys.
3. **D3 Hard's thinking time:** the same 1–3 seconds per move as every CPU; its search runs inside that pause.
4. **D4 CPU offers:** made to everyone. "One CPU offer per turn" and "CPU trading" are both switches set before the game starts.
5. **D5 Default difficulty:** Easy.
6. **D6 Custom CPUs and the CPU page:** section 5.
