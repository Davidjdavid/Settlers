# Dice deck (house rules, 3 October)

**Status: asked for 3 October, built as written here.** Two house rules that replace the number dice with a deck of cards. Each is off by default and changes the odds on purpose (SPEC 5.3 "Balanced dice").

## 1. The deck

1. The deck has **36 cards**, one for each way two dice can land: (1, 1), (1, 2), … (6, 6). So a full deck holds exactly the numbers an average 36 rolls would: one 2, two 3s, three 4s, four 5s, five 6s, six 7s, five 8s, four 9s, three 10s, two 11s, one 12.
2. Each card shows both dice (the red and the yellow die in Knights), so everything that reads a single die (progress cards on the red die, the Alchemist) works as with dice.
3. **Rolling** draws the top card instead of rolling the two number dice. The event die (Knights) is still rolled.
4. When the deck is empty, it is shuffled back to 36 cards before the next draw. The log says so.

## 2. The two house rules

1. **Dice deck** (`diceDeck: 'full'`): all 36 cards are used. Every 36 rolls give exactly the average spread.
2. **Dice deck, some cards out** (`diceDeck: 'trimmed'`): each time the deck is shuffled, **5 cards are taken out at random, face down**, and the other 31 are drawn. Nobody knows which 5, so the end of the deck can't be counted exactly.
3. Only one of them can be on.

## 3. What still applies

- Rules that roll a 7 again (no 7s in the first round; Knights' re-roll 7s until the barbarians attack) draw the next card instead. The 7 card is used up, as a roll would be.
- The Alchemist: the dice land on the chosen numbers and no card is drawn.
- A rule change mid-game (SPEC 4.5) can switch the deck on or off. Switching it on starts a fresh deck; switching it off leaves the deck where it is in case it comes back on.

## 4. Fairness and secrecy

- Every draw is random from the server's secure generator (SPEC 5.3): each roll move carries random numbers from `crypto.randomInt`, saved with the move, and the engine draws the card they pick from the cards left (and, for the trimmed deck, the cards taken out at a shuffle). Old saved games and the simulator, which have no such numbers, use the game's own random numbers.
- Which cards are left is server-only. Players see how many cards are left and when the deck was shuffled. (With the full deck, anyone could work out the rest from the log; with the trimmed deck nobody can.)

## 5. Checks

- The simulator's invariant: drawn since the shuffle + left + taken out = 36, with 5 taken out for the trimmed deck and 0 for the full deck, and no card twice.
- Unit tests: 36 draws of the full deck give exactly the spread in §1.1; the trimmed deck draws 31 then shuffles; rerolled 7s draw again; the deck never leaves the server.
