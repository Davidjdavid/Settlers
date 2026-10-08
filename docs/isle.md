# Isle: Settlers as if Nintendo made it

The design brief for a whole new game screen (8 October). The group asked for one new UI, made as if Nintendo were making their own Settlers, as a mock-up first. This is the plan the mock-up follows; the build follows the mock-up once the group likes it.

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
- **Game feel** (Steve Swink; Jonasson and Purho's "Juice it or lose it"; Jesse Schell's lenses): squash and stretch, easing, particles, a little shake, all tuned to the game and never slowing it down.
- **Refactoring UI**, *Don't Make Me Think*: hierarchy by size, weight and colour; quieten the rest to make one thing loud; cut needless words.

## 3. The four questions

The screen always answers four questions, loudest first, without the log:

1. **Is it my turn?**
2. **What just happened?**
3. **Who's winning, and by how much?**
4. **What can I do right now?**

The UI matters more than the art: it could be plain boards and still work, if these four are right. The art (a toy island, section 9) comes second.

## 4. Is it my turn?

- **Your turn changes the whole screen**, not a label: a thick glowing frame in your colour round the window, your tray slides up, the big button bottom right (Roll, then End turn) appears and bobs, and "Your turn!" sweeps across with a jingle. In a background tab the title reads "● Your turn".
- **Not your turn** is calm: a thin frame in the current player's colour, your tray lower, and in place of the big button "Joe is playing" with his face and what he's doing ("building", "trading").
- **A turn order strip**: everyone's faces in order with a marker sliding to whoever's playing, and "You're next" when you are.
- **Anything waiting on you** (discard, a trade offer, gold) gets the same glow, smaller, with the one button you need.

## 5. Who's winning?

- **A race track across the top**, from 0 to the target: each player's face is a token at their points. The leader wears a crown; ties sit side by side; the gaps show. Order and distance at a glance, without comparing numbers.
- Points scored: the token hops forward with "+1" and a chime. The last two spaces glow red: "Sam is 2 from winning!".
- Your token counts your hidden points; everyone else sees public points.

## 6. What just happened?

- **Every roll takes the middle for about 2½ seconds**: the dice tumble, the total pops huge in the roller's colour ("Joe rolled 8", "Joe rolled green 3"), cards fly from the tiles to whoever earned them, and a caption says it ("You got 1 Wheat · Alex got 2 Ore"; a 7: "The robber's coming!" in red). Clicks go through.
- **Things happen where they happen**: a city drops onto the board with a puff and "+1"; Longest Road glows along its route and the badge flies from the old owner to the new; the robber thuds down and its tile greys; a stolen card flies between the two seats; a trade swaps cards between them.
- **Each seat shows its last action** ("built a city") for a few seconds.
- **The last five rolls** sit by the dice, newest first, in the rollers' colours.

## 7. When your turn comes

- **"Since your last turn"**: a line per player's turn: their roll, what you got from it, what they did (built, played, traded, stole from you). Nothing happened, no card.
- **"Replay last round"**: everyone's turns again on the board at double speed, like a sports replay.

## 8. Doing things

- **The big button never moves** (muscle memory): Roll, then End turn.
- **Build** shows what you can afford lit up and what's missing on the rest; when you hold the cards for something good, its button glows ("You can build a city").
- **Placing**: legal spots pulse; tap one and the piece hovers there with a tick and a cross beside it.
- **Trade**: big give and get taps; friends answer live with a tick or a cross over their faces.
- **Cards you get** fly into your tray and bump the count.
- **On others' turns** their seat glows with what they're doing live; the board never moves by itself; you can still offer them a trade.

## 9. The look

- A toy island in a bright sea: thick hex tiles with little scenes (trees, sheep, fields, clay pits, peaks, a desert, gold in dark rock); no icons pasted on tiles.
- Players sit around the island in turn order: you at the bottom, the next player on your left.
- Rounded heavy type (Baloo 2 for numbers and headlines, M PLUS Rounded 1c for the rest), white rounded panels that look pressable, each player's colour on their seat, face and pieces.
- **Laptop**: the race track along the top; the other players at the edges; the board in the middle; your tray along the bottom; dice, last rolls and the big button bottom right; announcements and the recap in the middle.
- **Phone**: the race track on top doubles as the players list (tap a face for details); the board; your tray and the big button at the bottom.
- The log becomes a history drawer; detailed stats sit behind a tap.

## 10. Knights and Seafarers

- Barbarians: the ship moves one dot along its path when the event die shows it. When it lands, a short scene: strength against defence, who's the Defender, which cities fall.
- Event die: the third die, with a coloured gate and a picture (flask, coins, crown) as well as its colour.
- Improvements: three little buildings on your tray (Science, Trade, Politics) with their levels.
- Knights: helmets on the board with 1–3 stars; active ones shine.
- Ships: toy sailboats; the pirate: a dark ship; gold fields glitter; fog: soft clouds with a "?".

## 11. Sound and motion

Every motion has a sound: dice rattle and clack, tiles hop, cards swish, pieces thock down, points chime, your turn has its jingle, urgent things (a discard) their own. A press answers within a quarter of a second; announcements last 1½–2½ seconds; others' turns run a little quicker; nothing ever blocks you. Reduced motion: things fade instead of flying and tumbling, and nothing shakes.

## 12. Always

- A player's colour always comes with their avatar and initial, never colour alone.
- Every number has its pips; 6 and 8 are red.
- Text at least 14px on a phone; numbers big.
- Everything is a tap; nothing only on hover.

## 13. The mock-up

An interactive page with made-up data from a real Full game (Knights + Seafarers, four players), built from the same pieces the real screen will use. It plays through: someone else's roll, a 7 and a steal from you, a city and Longest Road, your turn with its recap, your roll, building a city, a trade, ending the turn, the barbarians landing, and a win; on a laptop and on a phone. Not in the mock-up: the lobby, the map editor, the stats pages and settings; they follow in the same style.
