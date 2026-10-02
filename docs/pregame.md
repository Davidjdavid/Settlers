# The pre-game table and turn order

**Status: proposed. Waiting for your OK (open questions at the end).**

This covers Milestone 6's last two parts:

- **The pre-game table:** where the board is chosen, rerolled and edited together before a game.
- **Turn order:** seating and who goes first.

Maps and the generator are in [maps.md](maps.md).

## 1. The pre-game table

The room's lobby becomes the pre-game table. Above the seats is a big **board preview** that everyone sees the same, live.

### 1.1 What everyone sees

- **The board:** tiles, numbers and harbors, drawn exactly as they'll be in the game.
- **The heat map:** pip totals on every corner (maps.md 4.3), with a switch to hide it on your own screen.
- **The fairness summary:** maps.md 5.14.
- **Warnings** for any generator rule the board breaks (maps.md section 5). They're shown, never blocking.
- **The source and seed:** for example "Generated · Our rules · seed `k7Qp-3x`", or "Saved map · Ann's ring island", or "Standard board".
- **Who changed it last:** for example "Bob rerolled · just now".
- **The game options:** mode, points to win and house rules, as today.

### 1.2 Choosing the board

**Map source** offers three choices:

1. **A default map:** the standard board, or a Seafarers scenario such as Heading for New Shores. The game mode buttons pick this as they do today.
2. **A saved custom map:** from the map list (maps.md 4.4), if it suits the mode and player count.
3. **The generator** with a chosen preset (maps.md 5.18), on the mode's board shape.

**Reroll:**

- Rerolling generates a new board from the same source with a new seed. Unlocked parts only, for a saved map with blanks.
- There's no limit on rerolls.
- **Back** and **Forward** step through every board this table has had, rerolls and edits alike, like a browser's history. Each board in the history keeps its seed and its edits.

**Edit this board:**

- This opens the editor tools (maps.md 4.2) right on the table's board, including on a generated board: drag tiles, numbers and harbors, with live warnings.
- An edited generated board shows "Generated · Our rules · seed `k7Qp-3x` · edited by Bob".

### 1.3 Everyone together

- **Anyone seated** can change the source, reroll, step back or forward, or edit.
- Every change goes through the server, which keeps the one true board. Everyone sees each change at once. The line "Bob moved a 6" shows who made the last one.
- **Two people editing at once:** changes are applied in the order the server gets them. Each change is small (move this tile, set this number), so they don't clobber each other.
- **Watchers** see everything but can't change anything.
- The board survives a server restart and reconnects, like everything else in the room.

### 1.4 Ready and Start

- Each person has a **Ready** button. CPUs are always ready.
- Every seat shows a tick when ready.
- **Changing anything clears everyone's Ready:** the board, the options, the seating or the first player. That way nobody starts on a board they didn't see.
- **Start** is enabled when every person is Ready, and anyone seated can press it (Q1).
- **When the game starts:**
  - The board locks.
  - The game saves its own copy of the board, plus the source, preset and seed (maps.md 3.2).
  - The game starts on exactly that board.

## 2. Turn order

Set at the same table, under the board.

### 2.1 Seating

- **The circle:** seats are shown as a circle in seating order. Turns go around it clockwise.
- **Drag to reorder:** dragging a seat to another place in the circle moves it there.
- **Shuffle** puts the seats in a random order.
- A new room seats people in the order they sat down, as today.

### 2.2 Who goes first

There are three ways:

1. **Roll for it:**
   - Everyone rolls two dice, with the server's dice function (SPEC 5.3), and the highest total goes first.
   - **Ties:** only the players tied for the highest total roll again. Others keep their place and don't roll. This repeats until one player is highest.
   - **CPUs** roll on their own as soon as the roll-off starts.
   - Each person rolls with their own button, or anyone can press **Auto-roll everyone** to roll for every person who hasn't rolled yet.
   - Every roll and re-roll shows by each seat, and goes in the log ("Joe rolled 4 + 5 = 9").
2. **Random:** the server picks one seat at random (crypto, like the dice).
3. **Pick:** anyone seated taps a seat to make it first.

### 2.3 The turn order that follows

**How it works:**

- Play starts with the first player and goes around the circle.
- The **setup snake draft** follows the same circle: first player to last, then last back to first.

**Example.** Joe, Alex and Sam set the circle to **Sam → Alex → Joe**, and the roll picks **Alex**:

- **Turns:** Alex, Joe, Sam, Alex, Joe, Sam, … (from Alex, onward around the circle Sam → Alex → Joe → Sam).
- **Setup snake:** Alex, Joe, Sam, Sam, Joe, Alex.

**Before Start**, the table shows the final order clearly:

> **Turn order:** ① Alex → ② Joe → ③ Sam
>
> **Setup:** Alex, Joe, Sam, Sam, Joe, Alex

**During the game**, the players panel lists players in turn order, each with a small ①②③④.

### 2.4 How it's stored

- Today the engine shuffles the seats when a game starts. New games instead save the order chosen at the table (a new config field), and the engine uses it as given.
- Games saved before this milestone have no such field, so they keep their shuffled order and replay unchanged.
- **The roll-off is not a game move:**
  - It happens before the game exists.
  - The room records it, and the dice come from the same dice function.
  - The log shows it at the top of the game.

## 3. Tests ("done means")

1. **Turn order:**
   - The Joe/Alex/Sam example as an automated test: turn order and setup snake exactly as in 2.3.
   - Ties re-roll only the tied players, including three-way ties and a tie in the re-roll.
   - CPUs roll on their own, and Auto-roll rolls for everyone left.
   - Random and Pick.
   - The snake-draft order for 2, 3 and 4 players.
2. **Three browsers:**
   - All three see the same preview, the same rerolls, back/forward, and each other's edits live, with the "who changed it" line.
   - Ready clears on a change.
   - The game starts with **exactly** that board: the board in the game equals the preview, tile by tile, number by number, harbor by harbor.
3. **Full 3-player games:** one on a custom map, one on a generated map.

## 4. Open questions

1. **Q1 Start.** Must every person be Ready before Start (my suggestion), or can anyone start at any time, with Ready only as a signal?
2. **Q2 Who can edit.** Anyone seated, as you wrote. Watchers can't. OK?
3. **Q3 Seating for Seafarers scenarios.** Some scenarios fix where players start. The order still comes from the circle; only the board is fixed. OK?
