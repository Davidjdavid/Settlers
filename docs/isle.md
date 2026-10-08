# Isle: Settlers as if Nintendo made it

The design brief for a whole new game screen (8 October). The group asked for one new UI, made as if Nintendo were making their own Settlers, as a mock-up first. This is the plan the mock-up follows; the build follows the mock-up once the group likes it.

**Correction (10 October).** "Nintendo-style" means what Nintendo has always been praised for, from Ocarina of Time to Mario on the Switch: simple, clean, impossible to read two ways, everything in its place. It does not mean a toy look. The first build (sections 14–15) drifted into toys (a toy island, rounded heavy type, bubbly white panels, things bobbing and bouncing); it stays playable as the **Toy** screen in the menu, next to the standard one. The standard screen was praised for its efficiency (everything in its place, nothing to distract you), but to the people at the table who aren't programmers it looked like an engineer made it; that is what the group's notes asked us to fix. Section 9 now says what Nintendo-style means; the next looks start as image mock-ups (section 16), not code.

## 1. The job

Four friends on a voice call, on laptops and phones. Most of the time it's someone else's turn and you're half looking. The screen has to:

1. Show whose turn it is and what's happening, at a glance, without reading.
2. Never let a roll go by unseen, and always show the last few rolls.
3. When your turn comes, say what changed since your last one, and show the one thing to do next.
4. Make every press feel good, and show every result where it happens.
5. Keep the board the star.

The old screen fails 1–4: the roll is a small die in a corner, the log is the only record, and every button looks alike.

## 2. What we took from the research

- **Masahiro Sakurai** (Creating Games; Famitsu columns): a screen should make sense without words; an icon's size says how much it matters; every press needs an answer at once; a brief freeze gives a moment weight; on and off must never be confused; type and colour set a game's personality.
- **The Switch home menu team** (CEDEC 2018): every sound matches a motion, so you know what just happened; animations as short as they can be while still acknowledging you; buttons in one predictable row, so the next move is easy to guess; the cursor starts on the likely choice; few confirmations.
- **Shigeru Miyamoto**: teach by playing, not by text (World 1-1); "human engineering": fit the screen to the hand and the eye.
- **Don Norman**, *The Design of Everyday Things*: things you can press look pressable (signifiers); natural mapping (players sit around the island in turn order); feedback for everything; constraints (only legal spots light up).
- **Jakob Nielsen**, visibility of system status, as board-game UX writers apply it: you always know where you stand against the others, and what your last move changed.
- **Celia Hodent**, *The Gamer's Brain*: attention is scarce, so steer it with motion and sound at the moments that matter; people don't notice small changes; memory is rebuilt, so give recaps.
- **Reviews of digital board games** (Wingspan, Scythe): the other players' state belongs on the main screen, not in menus; a short public recap of their turns; their turns may run faster.
- **Animal Crossing**'s morning announcements: a friendly recap of what happened; but only when there's news (the filler was the complaint).
- **Game feel** (Steve Swink; Jesse Schell's lenses): every press answers at once, with easing; used sparingly, as Nintendo's menus do, and never slowing the game down.
- **Refactoring UI**, *Don't Make Me Think*: hierarchy by size, weight and colour; quieten the rest to make one thing loud; cut needless words.

## 3. The four questions

The screen always answers four questions, loudest first, without the log:

1. **Is it my turn?**
2. **What just happened?**
3. **Who's winning, and by how much?**
4. **What can I do right now?**

The UI matters more than the art: it could be plain boards and still work, if these four are right.

## 4. Is it my turn?

- **Your turn changes the whole screen**, not a label: a frame in your colour round the window, the big button bottom right (Roll, then End turn) gets the cursor, and "Your turn" shows across the middle with a jingle. In a background tab the title reads "● Your turn".
- **Not your turn** is calm: a thin frame in the current player's colour, and in place of the big button "Waiting for Joe" with their emblem and what they're doing ("building", "trading").
- **The players in turn order** down the left, the cursor on whoever's playing, and "You're next" when you are.
- **Anything waiting on you** (discard, a trade offer, gold) gets the same glow, smaller, with the one button you need.

## 5. Who's winning?

- **A race track across the top**, from 0 to the target: each player's emblem stands above their points, pointing down at the number, never covering it. Players on the same points crowd onto the one number (two stacked, three in a triangle, four in a square) with one pointer: side by side, they looked like different points. The leader wears a crown. Order and distance at a glance, without comparing numbers.
- Points scored: "+1" by the token. The last two spaces are red.
- Your token counts your hidden points; everyone else sees public points.

## 6. What just happened?

- **Every roll takes the middle for about 2½ seconds**: the dice tumble, the total pops huge in the roller's colour ("Joe rolled 8", "Joe rolled green 3"), cards fly from the tiles to whoever earned them, and a caption says it ("You got 1 Wheat · Alex got 2 Ore"; a 7: "The robber's coming!" in red). Clicks go through.
- **Things happen where they happen**: a city drops onto the board with a puff and "+1"; Longest Road glows along its route and the badge flies from the old owner to the new; the robber thuds down and its tile greys; a stolen card flies between the two seats; a trade swaps cards between them.
- **Each seat shows what they did since your last turn** on a small callout beside it, until their next turn (the group's pick over a separate list).
- **The last five rolls** sit by the dice, newest first, in the rollers' colours.

## 7. When your turn comes

- **What each player did since your last turn** stays on the callout beside their panel (section 6). (A separate "Since your last turn" list you had to OK was tried and dropped: it said the same thing twice.)
- **"Replay last round"**: everyone's turns again on the board at double speed, like a sports replay.

## 8. Doing things

- **The big button never moves** (muscle memory): Roll, then End turn.
- **Build** shows what you can afford lit up and what's missing on the rest; when you hold the cards for something good, its button glows ("You can build a city").
- **Placing**: legal spots pulse; tap one and the piece hovers there with a tick and a cross beside it.
- **Trade**: big give and get taps; friends answer live with a tick or a cross over their faces.
- **Cards you get** fly into your tray and bump the count.
- **On others' turns** their seat glows with what they're doing live; the board never moves by itself; you can still offer them a trade.

## 9. The look: Nintendo's menu language

What stays the same in Nintendo's screens from Ocarina of Time to the Switch, and what this screen takes from it:

1. **The game fills the screen; the HUD sits at the edges, each thing always in the same place.** The board in the middle on the sea; the status along the top; the players down the left; the rolls and the log on the right; your cards along the bottom; the one main button bottom right.
2. **Panels are plain and quiet**: dark and slightly see-through over the sea, a thin light edge, modestly rounded corners, white writing. One panel, one job, with a short title in small capitals.
3. **One clean typeface** (Figtree) in a few sizes; numbers bold, and the same width so they don't jump. No rounded, bubbly lettering.
4. **Few colours, each with one meaning**: the panels are neutral; a player's colour only marks that player (their emblem, a stripe); **cyan is the cursor**: what's active and what you can do; **gold** is first place and rewards; **red** only for danger (a 7, over the hand limit, about to win).
5. **The cursor**: whose turn it is and the button to press have a bright outline that breathes gently. Nothing else moves by itself.
6. **Messages come in a text box**, as in every Nintendo game: what happened, in plain words, with the name in that player's colour ("Dana rolled 8"). What you get shows like an item you've found: the cards, then "You got 2 Wheat and 1 Ore", then they go into your hand.
7. **Motion is short and has a purpose**: slide or fade in 150–250 ms; a small pop only for something you get; no bobbing, no wobble.
8. **Icons are flat and simple**, one style, always with a number or a word.
9. **Emblems, not letters**: everyone picks an emblem (anchor, wheat, crown…), kept on their profile and one per table like colours; their emblem in a disc of their colour marks them everywhere on this screen. Letters failed: people at the table share first letters.
- **Laptop**: the race track along the top; the other players at the edges; the board in the middle; your tray along the bottom; dice, last rolls and the big button bottom right; announcements in the middle.
- **Phone**: the race track on top doubles as the players list (tap a face for details); the board; your tray and the big button at the bottom.
- The log becomes a history drawer; detailed stats sit behind a tap.

## 10. Knights and Seafarers

- Barbarians: the ship moves one dot along its path when the event die shows it. When it lands, a short scene: strength against defence, who's the Defender, which cities fall.
- Event die: the third die, with a coloured gate and a picture (flask, coins, crown) as well as its colour.
- Improvements: three little buildings on your tray (Science, Trade, Politics) with their levels.
- Knights: helmets on the board with 1–3 stars; active ones shine.
- Ships, the pirate, gold and fog: as the board's art style draws them.

## 11. Sound and motion

Every motion has a sound: dice rattle and clack, tiles hop, cards swish, pieces thock down, points chime, your turn has its jingle, urgent things (a discard) their own. A press answers within a quarter of a second; announcements last 1½–2½ seconds; others' turns run a little quicker; nothing ever blocks you. Reduced motion: things fade instead of flying and tumbling, and nothing shakes.

## 12. Always

- A player's colour always comes with their emblem, never colour alone.
- Every number has its pips; 6 and 8 are red.
- Text at least 14px on a phone; numbers big.
- Everything is a tap; nothing only on hover.

## 13. The mock-up

An interactive page with made-up data from a real Full game (Knights + Seafarers, four players), built from the same pieces the real screen will use. It plays through: someone else's roll, a 7 and a steal from you, a city and Longest Road, your turn with its recap, your roll, building a city, a trade, ending the turn, the barbarians landing, and a win; on a laptop and on a phone. Not in the mock-up: the lobby, the map editor, the stats pages and settings; they follow in the same style.

## 14. What we missed at the table (9 October)

From the group, after playing on the standard screen:

- **The trade buttons are far from the cards.** You look at your cards, then hunt for the button that trades them.
- **How many progress cards does someone have?** Little coloured squares are hard to count at a glance.
- **One player didn't know they had progress cards**: their cards sat at the bottom of the screen, out of sight.
- **Things happened and nobody noticed.** Who has a golden gate (a metropolis)? Who took Longest Road first, and did they lose it?

What the reading says about each (the SixArm UI/UX Design Guide, Nielsen's heuristics, Norman's *Design of Everyday Things*, Lidwell's *Universal Principles of Design*, NN/g on change blindness, and Board Game Arena players' notes):

- **Proximity** (Gestalt): things used together sit together. Trading is about your cards, so the trade buttons sit right beside your hand, and the build buttons right beside them: cards → what they buy. **Fitts's law**: the actions you use every turn are big and close to where your eyes and pointer already are.
- **Recognition rather than recall** (Nielsen 6): you shouldn't have to remember or count. Progress cards show as card backs with a big number on each seat ("3"), coloured by the deck they came from, never as tiny squares to count.
- **Visibility of system status** (Nielsen 1) and **discoverability** (Norman): anything you hold or owe is in view without scrolling. Your progress cards sit in your tray in the middle of the bottom edge, never below the fold. A card you just drew flies in and its slot glows until you've seen it. A card you can play now is lit.
- **Change blindness** (NN/g): people miss changes outside where they're looking, even big ones. A short toast vanishes before it's read. So every important change gets two things: a **moment** (a callout in the middle of the screen, in the player's colour, with a sound) for the change itself, and a **lasting place** that shows the result (who holds it now). Things that matter less get a smaller cue on the seat that did them, and the log keeps everything.
- **Rank by the cost of missing it**: big for points, awards and metropolises changing hands, a 7, the robber on your tile, a steal from you, the barbarians; medium for builds and cards played (on the player's seat for a few seconds); small for trades and everything else (the log).
- **Information you've seen stays on screen** (Board Game Arena players): the last rolls stay; what each player did stays by their seat until their next turn; the awards shelf (below) never goes away.

So the new screen adds:

- **The awards shelf**, beside the race track: Longest Road (or Trade Route), Largest Army, and each metropolis (Science, Trade, Politics: the golden gates), each with the holder's colour and name, or "nobody yet". When one changes hands the moment says so ("Sam took Longest Road from Joe"), the award slides from the old holder's seat to the new one's, and the shelf keeps "from Joe" under it until the next turn. Hover or tap: who held it first, and since when.
- **Progress cards counted on every seat**: one card back per deck (green, yellow, blue) with how many, and the total, in big type.
- **Your hand is one strip**: your cards, then Trade with players and the bank right next to them, then build, then your development or progress cards, then the big button. Nothing of yours is ever below the fold.

## 15. The playable screen (laptops and monitors)

Built in the real game as an opt-in setting ("New screen", in the menu and My settings), using the current board and its art styles, so the group can try it in a real game. Phones and tablets keep the standard screen for now. Laptop first (1366×768), up to large monitors (1920×1080 and wider).

- **Picking it**: Screen · Standard / Toy in the room menu, saved on your profile; only your screen changes.
- **Top bar**: the menu (with the room code), the race track from 0 to the target with everyone's emblem, the awards shelf, the dice stats and music.
- **Left column**: everyone's seat in turn order, a marker on whoever is playing and "You're next" when you are. Each seat: name and colour, points, cards in hand (red over the limit), development or progress cards by deck, knights and road length, awards, and what they just did.
- **Middle**: the board. Over it: what to do now, and the moments.
- **Right column**: the last five rolls (who by emblem and name, both dice, the event die), newest first and biggest; then the log and table talk.
- **Bottom strip**: your hand (section 14), with the big button at the right end: Roll, then End turn; when it's not your turn, whose turn it is and what they're doing.
- **Your turn** puts a glowing frame in your colour round the whole screen and says "Your turn!" across the middle.
- **Beside each seat**, a callout with what they did since your last turn ("traded with the bank and built a road"), until their next turn; what someone does off their turn (a discard) shows there for a few seconds.
- **Cards you get from a roll** (on both screens): a bank deck appears over the board, your cards are dealt out of it face up and big over "You got 2 Wheat and 1 Ore", then each flies into its spot in your hand (`gainshow.tsx`). The roll announcement lists everyone else's.
- **Waiting**: when the game waits on someone (gold, a discard, a choice), their seat says so and, in place of the big button, "Waiting for Joe · picking gold".

## 16. Next: mock-ups of a Nintendo-style screen

Before any more code: a few image mock-ups of what the whole game screen could look like from scratch, as if made by someone who loves Nintendo for its design sense and was only told the rules of Catan, following section 9. The group picks a direction; then it's built as its own screen choice.
